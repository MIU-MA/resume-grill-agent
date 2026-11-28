import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { Store } from "../../src/infrastructure/sqlite-store.js";
import { Workspace } from "../../src/core/workspace.js";
import { Tasks } from "../../src/core/tasks.js";
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

  assert.throws(
    () =>
      withTrace(
        "dsh-model",
        () => ops.get("preview_application")!.run({ id: "missing-app-id" }),
        "trace-custom-002",
      ),
  );

  const audits = store.listToolAudits(10);
  assert.equal(audits.length, 2);
  const [failed, ok] = audits;
  assert.equal(failed.traceId, "trace-custom-002");
  assert.equal(failed.caller, "dsh-model");
  assert.equal(failed.toolName, "preview_application");
  assert.equal(failed.status, "error");
  assert.equal(failed.errorCode, "NOT_FOUND");

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
  const batch = await tasks.prepareBatch(goal.id, choices);
  assert.deepEqual(
    batch.items.map((item) => item.jobId),
    jobs.map((job) => job.id),
  );
  assert.deepEqual(
    batch.items.map((item) => item.status),
    ["prepared", "prepared", "blocked", "prepared", "prepared"],
  );

  // 模拟一个已过期租约但 ownerPid 指向存活进程的“僵尸” preparing 批次（如 PID 复用）
  const saved = store.list<Record<string, unknown>>("batch")[0];
  store.put("batch", {
    ...saved,
    status: "preparing",
    ownerPid: process.pid,
    ownerInstance: "dead-instance-uuid",
    leaseExpiresAt: Date.now() - 10_000,
    items: (saved.items as unknown[]).slice(0, 1),
  });
  const recovered = await new Tasks(workspace).prepareBatch(goal.id, choices);
  assert.equal(recovered.id, batch.id);
  assert.equal(recovered.items.length, 5);
  assert.equal(recovered.items[4].status, "prepared");
});
