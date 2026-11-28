import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { Store } from "../../src/infrastructure/sqlite-store.js";
import { Workspace } from "../../src/core/workspace.js";
import { Tasks } from "../../src/core/tasks.js";
import { BossGroups, type BossGroup } from "../../src/core/boss-groups.js";
import { operations } from "../../src/core/operations.js";
import { withTrace } from "../../src/shared/telemetry.js";

async function setup(t: any) {
  const home = await mkdtemp(join(tmpdir(), "resume-audit-test-"));
  const store = new Store(home);
  const workspace = new Workspace(store);
  t.after(async () => {
    store.close();
    if (
      dirname(home) === tmpdir() &&
      basename(home).startsWith("resume-audit-test-")
    )
      await rm(home, { recursive: true, force: true, maxRetries: 5 });
  });
  return { home, store, workspace };
}

test("Tool 审计拦截器透传 Trace、记录错误码且绝不泄露隐私正文或邮箱", async (t) => {
  const { store, workspace } = await setup(t);
  const ops = new Map(operations(workspace).map((op) => [op.name, op]));

  const added = (await withTrace(
    "mcp",
    () =>
      ops.get("add_job")!.run({
        company: "示例公司",
        role: "Go 后端",
        jd: "绝密岗位正文-不可进入审计表",
        sourceUrl: "https://careers.example.com/jobs/1",
        recipient: "secret-hr@example.com",
      }),
    "trace-custom-001",
  )) as { id: string };
  assert.ok(added.id);

  await assert.rejects(async () => {
    withTrace(
      "dsh-model",
      () => ops.get("preview_application")!.run({ id: "leak@example.com" }),
      "trace-custom-002",
    );
  });

  const audits = store.listToolAudits(10);
  assert.equal(audits.length, 2);
  const [failed, ok] = audits;
  assert.equal(failed.traceId, "trace-custom-002");
  assert.equal(failed.caller, "dsh-model");
  assert.equal(failed.toolName, "preview_application");
  assert.equal(failed.status, "error");
  assert.equal(failed.errorCode, "NOT_FOUND");
  assert.equal(failed.summary.id, "<redacted>");

  assert.equal(ok.traceId, "trace-custom-001");
  assert.equal(ok.caller, "mcp");
  assert.equal(ok.toolName, "add_job");
  assert.equal(ok.status, "ok");
  assert.equal(ok.summary.host, "careers.example.com");
  const serialized = JSON.stringify(ok.summary);
  assert.ok(!serialized.includes("绝密岗位正文"));
  assert.ok(!serialized.includes("secret-hr@example.com"));
});

test("批量准备支持受控并行保序，且租约过期可安全接管（防止 PID 复用死锁）", async (t) => {
  const { home, store, workspace } = await setup(t);
  const path = join(home, "resume.txt");
  await writeFile(path, "测试用户\n项目经历\n- 负责 Go API 开发与测试。");
  const resume = await workspace.importResume(path);
  const tasks = new Tasks(workspace);
  const goal = tasks.saveGoal({ resumeId: resume.id, directions: ["Go"] });
  const jobs = [0, 1, 2, 3, 4].map((i) =>
    workspace.addJob({
      company: `公司-${i}`,
      role: "Go 后端",
      jd: "负责 Go API 开发与测试。",
      sourceUrl: `https://example.com/jobs/${i}`,
      ...(i === 2 ? {} : { recipient: `hr${i}@example.com` }),
    }),
  );
  const choices = jobs.map((job) => ({ jobId: job.id, keepOriginal: true }));
  // 观察每次落盘的中间批次快照：并发乱序完成槽位绝不可产生 null 空洞，且 batchSnapshot() 始终可读
  const originalPut = store.put.bind(store);
  const snapshots: Array<{ id: string; items: unknown[] }> = [];
  store.put = ((kind: string, value: { id: string; items?: unknown[] }) => {
    originalPut(kind, value);
    if (kind === "batch" && Array.isArray(value.items)) {
      snapshots.push({
        id: value.id,
        items: JSON.parse(JSON.stringify(value.items)),
      });
    }
  }) as typeof store.put;
  let batch;
  try {
    batch = await tasks.prepareBatch(goal.id, choices);
  } finally {
    store.put = originalPut;
  }
  assert.ok(snapshots.length >= 2);
  for (const snap of snapshots) {
    assert.equal(snap.items.length, jobs.length);
    assert.ok(
      snap.items.every(
        (entry) =>
          entry !== null &&
          typeof entry === "object" &&
          typeof (entry as { jobId?: unknown }).jobId === "string",
      ),
    );
  }
  assert.equal(tasks.batchSnapshot(batch.id).items.length, jobs.length);
  assert.deepEqual(
    batch.items.map((item) => item.jobId),
    jobs.map((job) => job.id),
  );
  assert.deepEqual(
    batch.items.map((item) => item.status),
    ["prepared", "prepared", "blocked", "prepared", "prepared"],
  );

  // 1. 未过期租约且 ownerPid 存活（含同 PID 不同实例或父进程）必须阻塞抢占，返回原 preparing 批次
  const saved = store.list<Record<string, unknown>>("batch")[0];
  store.put("batch", {
    ...saved,
    status: "preparing",
    ownerPid: process.ppid || process.pid,
    ownerInstance: "other-live-instance-uuid",
    leaseExpiresAt: Date.now() + 60_000,
    items: (saved.items as unknown[]).slice(0, 1),
  });
  const blocked = await new Tasks(workspace).prepareBatch(goal.id, choices);
  assert.equal(blocked.status, "preparing");
  assert.equal(blocked.items.length, 1);

  // 2. 租约过期后，即使 ownerPid 仍然存活（如 OS PID 复用），也能安全接管完成准备
  store.put("batch", {
    ...saved,
    status: "preparing",
    ownerPid: process.ppid || process.pid,
    ownerInstance: "dead-instance-uuid",
    leaseExpiresAt: Date.now() - 10_000,
    items: (saved.items as unknown[]).slice(0, 1),
  });
  const recovered = await new Tasks(workspace).prepareBatch(goal.id, choices);
  assert.equal(recovered.id, batch.id);
  assert.equal(recovered.items.length, 5);
  assert.equal(recovered.items[4].status, "prepared");

  // 3. 两个不同批次并发包含同一新岗位时，版本创建防重只生成一个 Resume 与一条 Application
  const sharedJob = workspace.addJob({
    company: "并发重叠公司",
    role: "Go 后端",
    jd: "负责 Go API 开发与测试。",
    sourceUrl: "https://example.com/jobs/shared-overlap",
    recipient: "overlap@example.com",
  });
  const extraJob = workspace.addJob({
    company: "独立公司",
    role: "Go 后端",
    jd: "负责 Go API 开发与测试。",
    sourceUrl: "https://example.com/jobs/extra-only",
    recipient: "extra@example.com",
  });
  await Promise.all([
    tasks.prepareBatch(goal.id, [{ jobId: sharedJob.id, keepOriginal: true }]),
    new Tasks(workspace).prepareBatch(goal.id, [
      { jobId: sharedJob.id, keepOriginal: true },
      { jobId: extraJob.id, keepOriginal: true },
    ]),
  ]);
  const sharedApps = workspace
    .history()
    .filter((app) => app.jobId === sharedJob.id);
  assert.equal(sharedApps.length, 1);
});

test("BossGroups 租约保护跨进程存活批次，租约过期后事务化暂停并清空所有权", async (t) => {
  const { store, workspace } = await setup(t);
  const groups = new BossGroups(workspace);
  const now = Date.now();
  const baseGroup: BossGroup = {
    id: "11111111-1111-4111-8111-111111111111",
    digest: "digest-live-lease",
    createdAt: now,
    updatedAt: now,
    status: "running",
    expiresAt: now + 15 * 60 * 1000,
    ownerPid: process.ppid || process.pid,
    ownerInstance: "other-live-boss-instance",
    leaseExpiresAt: now + 60_000,
    items: [],
  };
  store.put("boss-group", baseGroup);

  // 1. ownerPid 存活且租约未过期时，list() 绝不可误暂停其他进程的活跃批次
  const active = groups.list().find((g) => g.id === baseGroup.id)!;
  assert.equal(active.status, "running");
  assert.equal(active.ownerInstance, "other-live-boss-instance");

  // 2. 租约过期后，即使 ownerPid 仍存在（例如 PID 复用），也必须事务化暂停并清空所有权字段
  store.put("boss-group", {
    ...baseGroup,
    leaseExpiresAt: now - 10_000,
  });
  const recovered = groups.list().find((g) => g.id === baseGroup.id)!;
  assert.equal(recovered.status, "paused");
  assert.equal(recovered.ownerPid, undefined);
  assert.equal(recovered.ownerInstance, undefined);
  assert.equal(recovered.leaseExpiresAt, undefined);
  assert.ok(recovered.error?.includes("宿主曾退出"));
});
