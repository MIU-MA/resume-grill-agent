import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Boss } from "../../src/core/boss.js";
import { BossGateway } from "../../src/infrastructure/boss-gateway.js";
import { Store } from "../../src/infrastructure/sqlite-store.js";
import { Workspace } from "../../src/core/workspace.js";
import { operations } from "../../src/core/operations.js";
import { humanAction, cardAction } from "../../src/adapters/dsh/actions.js";
import { BossDeliveries } from "../../src/core/boss-deliveries.js";
import { resumeImages } from "../../src/infrastructure/resume-images.js";
import { PDFDocument } from "pdf-lib";
import { BossGroups } from "../../src/core/boss-groups.js";
import { BossShortlists } from "../../src/core/boss-shortlists.js";
import { Tasks } from "../../src/core/tasks.js";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BossWorkbench } from "../../src/adapters/dsh/BossWorkbench.js";
import { bossView } from "../../src/adapters/dsh/views.js";

export async function fixture(t: any) {
  const home = await mkdtemp(join(tmpdir(), "boss-agent-test-")),
    store = new Store(home),
    workspace = new Workspace(store),
    requests: string[] = [];
  const url = "https://www.zhipin.com/job_detail/test.html",
    id = "10000000-0000-4000-8000-000000000001";
  const state: any = {
    detail: {
      kind: "detail",
      url,
      title: "Go开发",
      company: "演示",
      description: "开发 Go 服务",
      truncated: false,
      matched: true,
      blockers: [],
    },
    run: {
      id,
      mode: "boss",
      state: "finished",
      createdAt: 1,
      updatedAt: 2,
      tasks: [],
    },
  };
  const server = createServer(async (req, res) => {
    requests.push(req.url!);
    let body = "";
    for await (const c of req) body += c;
    if (req.headers.authorization !== `Bearer ${"a".repeat(48)}`) {
      res.writeHead(401);
      res.end("{}");
      return;
    }
    let result: any = {};
    if (req.url === "/status")
      result = { ready: true, phase: "connected", backend: "ego" };
    if (req.url === "/jobs")
      result = {
        readId: "snapshot",
        jobs: state.rows ?? [{ url, title: "Go开发", company: "演示" }],
        needsLogin: false,
        needsVerification: false,
      };
    if (req.url === "/inspect-job")
      result = state.details?.[JSON.parse(body).url] ?? state.detail;
    if (
      req.url === `/boss-batch/${id}` ||
      (state.preview && req.url === `/boss-batch/${state.preview.id}`)
    )
      result = state.run;
    if (req.url === "/boss-batches") result = [];
    if (req.url === "/boss-batch/preview") {
      state.preview = JSON.parse(body);
      result = {
        id: "preview",
        batchId: state.preview.id,
        expiresAt: Date.now() + 120000,
        greetingMode: "platform",
        jobs: state.preview.jobs,
        images: state.preview.images.map(({ base64, ...i }: any) => i),
        skipped: [],
      };
      await state.onPreview?.();
    }
    if (req.url === "/boss-batch/confirm") {
      state.confirmations = (state.confirmations ?? 0) + 1;
      result = {
        ...state.run,
        id: state.preview.id,
        state: "running",
        tasks: state.preview.jobs.map((j: any) => ({
          ...j,
          state: "queued",
          steps: [],
        })),
      };
      state.run = result;
      if (state.finish) {
        result.state = "finished";
        result.tasks[0].state = "verified";
        result.tasks[0].steps = [
          {
            id: "contact",
            kind: "contact",
            value: result.tasks[0].url,
            state: "verified",
            receipt: "contact",
          },
          {
            id: "text",
            kind: "greeting",
            value: "默认招呼",
            source: "platform",
            state: "verified",
            receipt: "msg",
          },
          ...state.preview.images.map((i: any, n: number) => ({
            id: `image-${n}`,
            kind: "image",
            value: state.badReceipt ? "wrong" : i.sha256,
            state: "verified",
            receipt: `image-${n}`,
          })),
        ];
      }
      await state.onConfirm?.();
      if (state.dropConfirmation) {
        res.destroy();
        return;
      }
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(result));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as any).port;
  const link = `http://localhost:3000/boss#boss-origin=${encodeURIComponent(`http://127.0.0.1:${port}`)}&boss-token=${"a".repeat(48)}`;
  t.after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
    await rm(home, { recursive: true, force: true });
  });
  return {
    home,
    store,
    workspace,
    boss: new Boss(workspace),
    link,
    requests,
    state,
    url,
    id,
  };
}
test("BOSS 接口限制本机来源，凭据仅在内存，读取真实快照核对身份", async (t) => {
  const f = await fixture(t);
  for (const origin of [
    "https://example.com",
    "http://127.0.0.1.evil:4327",
    "http://user:pass@127.0.0.1:4327",
  ]) {
    assert.throws(() =>
      BossGateway.fromLink(
        `http://localhost/#boss-origin=${encodeURIComponent(origin)}&boss-token=${"a".repeat(48)}`,
      ),
    );
  }
  await assert.rejects(f.boss.status(), /先在/);
  await humanAction(f.workspace, { action: "boss-link", link: f.link });
  assert.equal((await f.boss.status()).ready, true);
  const scan = await f.boss.read(),
    job = await f.boss.detail(scan.id, f.url);
  assert.equal(job.jd, "开发 Go 服务");
  f.state.detail.company = "其他公司";
  await assert.rejects(f.boss.detail(scan.id, f.url), /未核对/);
  assert.equal(
    JSON.stringify(f.store.list("boss-scan")).includes("a".repeat(48)),
    false,
  );
  const restored = await cardAction(f.workspace, "session", "card", {
    action: "restore",
    reference: { action: "boss" },
  });
  assert.equal(restored?.kind, "boss");
  assert.ok(
    !operations(f.workspace).some((o) =>
      /boss.*confirm|boss.*connect/.test(o.name),
    ),
  );
  f.boss.disconnect();
  await assert.rejects(f.boss.status(), /先在/);
});
test("逐岗位绑定 PDF 版本和实际图片，拒绝跨 JD、图片篡改及模型批准", async (t) => {
  const f = await fixture(t);
  f.boss.connect(f.link);
  const scan = await f.boss.read(),
    job = await f.boss.detail(scan.id, f.url);
  const main = await f.workspace.createResume(
      "主简历.pdf",
      "演示用户\n项目经历\n负责 Go 服务开发。",
    ),
    version = await f.workspace.saveEditedResume(
      main.id,
      "演示用户\n项目经历\n负责 Go 接口开发与测试。",
      job.id,
    ),
    deliveries = new BossDeliveries(f.workspace);
  const a = await deliveries.prepare(main.id, job.id),
    b = await deliveries.prepare(version.id, job.id);
  assert.notEqual(a.images[0].sha256, b.images[0].sha256);
  assert.notEqual(a.digest, b.digest);
  assert.equal((await deliveries.prepare(version.id, job.id)).id, b.id);
  assert.equal(f.state.confirmations, undefined);
  assert.equal(f.state.preview.jobs.length, 1);
  assert.equal(f.state.preview.images[0].sha256, b.images[0].sha256);
  const other = f.workspace.addJob({
    company: "其他",
    role: "开发",
    sourceUrl: "https://www.zhipin.com/job_detail/other.html",
    jd: "其他JD",
  });
  await assert.rejects(deliveries.prepare(version.id, other.id), /属于其他/);
  await assert.rejects(deliveries.confirm(b.id, "wrong"), /已过期或已执行/);
  await writeFile(b.images[0].path, "corrupted");
  await assert.rejects(deliveries.confirm(b.id, b.digest), /图片已变化/);
  assert.equal(f.state.confirmations, undefined);
  assert.equal(
    operations(f.workspace)
      .filter((o) => /boss/.test(o.name))
      .some((o) => /confirm|execute|send/.test(o.name)),
    false,
  );
});
test("人工确认只执行一次，缺失回执不记成功，恢复不重发", async (t) => {
  const f = await fixture(t);
  f.boss.connect(f.link);
  const scan = await f.boss.read(),
    job = await f.boss.detail(scan.id, f.url),
    resume = await f.workspace.createResume(
      "简历.pdf",
      "演示用户\n项目经历\n负责 Go 服务开发。",
    );
  const deliveries = new BossDeliveries(f.workspace),
    d = await deliveries.prepare(resume.id, job.id);
  await Promise.allSettled([
    deliveries.confirm(d.id, d.digest),
    deliveries.confirm(d.id, d.digest),
  ]);
  assert.equal(f.state.confirmations, 1);
  f.state.run.state = "finished";
  f.state.run.tasks[0].state = "verified";
  await assert.rejects(deliveries.refresh(d.id), /缺少匹配/);
  assert.equal(deliveries.get(d.id).status, "uncertain");
  const steps = [
    {
      id: "contact",
      kind: "contact",
      value: d.url,
      state: "verified",
      receipt: "contact",
    },
    {
      id: "text",
      kind: "greeting",
      value: "账号默认招呼",
      source: "platform",
      state: "verified",
      receipt: "message",
    },
    ...d.images.map((i, n) => ({
      id: `image-${n}`,
      kind: "image",
      value: i.sha256,
      state: "verified",
      receipt: `uploaded-${n}`,
    })),
  ];
  f.state.run.tasks[0].steps = steps;
  await deliveries.refresh(d.id);
  assert.equal(deliveries.get(d.id).status, "finished");
  await assert.rejects(deliveries.confirm(d.id, d.digest));
  await cardAction(f.workspace, "s", "c", {
    action: "restore",
    reference: { action: "boss" },
  });
  assert.equal(f.state.confirmations, 1);
  const reopened = new Store(f.home);
  assert.equal(reopened.get<any>("boss-delivery", d.id).status, "finished");
  reopened.close();
});
test("BOSS 查询待确认批次只读本地，暂停使用执行器批次号", async (t) => {
  const f = await fixture(t);
  f.boss.connect(f.link);
  const scan = await f.boss.read();
  const job = await f.boss.detail(scan.id, f.url);
  const resume = await f.workspace.createResume(
    "测试简历",
    "负责 Go 服务开发。",
  );
  const delivery = await new BossDeliveries(f.workspace).prepare(
    resume.id,
    job.id,
  );
  const tools = operations(f.workspace);
  const status = tools.find((tool) => tool.name === "boss_delivery_status")!;
  const pause = tools.find((tool) => tool.name === "boss_pause_delivery")!;
  const prepared = await status.run({ id: delivery.id });
  assert.equal((prepared as { status: string }).status, "prepared");
  assert.equal(Object.hasOwn(prepared as object, "previewId"), false);
  await assert.rejects(async () => pause.run({ id: delivery.id }), /等待确认/);
  assert.equal(
    f.requests.some((url) => url.includes(delivery.remoteId)),
    false,
  );

  f.store.put("boss-delivery", { ...delivery, status: "running" });
  assert.deepEqual(await pause.run({ id: delivery.id }), {
    id: delivery.id,
    requested: true,
    message: "已请求完成当前步骤后暂停；请重新读取状态。",
  });
  assert.equal(f.requests.at(-1), `/boss-batch/${delivery.remoteId}/stop`);
  assert.equal(f.state.confirmations, undefined);
});
test("确认响应丢失不重试，PDF 超三页不截断", async (t) => {
  const f = await fixture(t);
  f.boss.connect(f.link);
  const scan = await f.boss.read(),
    job = await f.boss.detail(scan.id, f.url),
    resume = await f.workspace.createResume(
      "简历.pdf",
      "演示用户\n项目经历\n负责 Go 服务开发。",
    ),
    deliveries = new BossDeliveries(f.workspace),
    d = await deliveries.prepare(resume.id, job.id);
  f.state.dropConfirmation = true;
  await deliveries.confirm(d.id, d.digest);
  assert.equal(deliveries.get(d.id).status, "uncertain");
  await assert.rejects(deliveries.confirm(d.id, d.digest));
  assert.equal(f.state.confirmations, 1);
  const pdf = await PDFDocument.create();
  for (let n = 0; n < 4; n++) pdf.addPage();
  const path = join(f.home, "four-pages.pdf");
  await writeFile(path, await pdf.save());
  await assert.rejects(resumeImages(path), /最多 3 页/);
});
test("恢复和暂停只读回执，不重新确认或发送", async (t) => {
  const f = await fixture(t);
  f.boss.connect(f.link);
  await f.boss.refresh(f.id);
  await f.boss.pause(f.id);
  assert.equal(f.store.list("boss-run").length, 1);
  assert.equal(f.requests.includes("/boss-batch/confirm"), false);
  await assert.rejects(f.boss.gateway().request("/fill-draft", {}), /不支持/);
});

async function twoDeliveries(t: any) {
  const f = await fixture(t);
  f.boss.connect(f.link);
  const scan = await f.boss.read(),
    job = await f.boss.detail(scan.id, f.url),
    resume = await f.workspace.createResume(
      "主简历.pdf",
      "演示用户\n项目经历\n负责 Go 服务开发。",
    );
  const deliveries = new BossDeliveries(f.workspace),
    a = await deliveries.prepare(resume.id, job.id);
  const secondUrl = "https://www.zhipin.com/job_detail/second.html";
  f.state.rows = [{ url: secondUrl, title: "Go开发", company: "第二公司" }];
  f.state.detail = { ...f.state.detail, url: secondUrl, company: "第二公司" };
  const otherScan = await f.boss.read(),
    otherJob = await f.boss.detail(otherScan.id, secondUrl),
    b = await deliveries.prepare(resume.id, otherJob.id);
  return { ...f, deliveries, a, b, resume, job };
}
test("整批一次人工确认，顺序发送各自图片；重复开始与重复岗位被拒绝", async (t) => {
  const f = await twoDeliveries(t),
    groups = new BossGroups(f.workspace, 1, 3),
    g = await groups.prepare([f.a.id, f.b.id]);
  f.state.finish = true;
  assert.equal(f.state.confirmations, undefined);
  await groups.start(g.id, g.digest);
  const result = await groups.wait(g.id);
  assert.equal(result.status, "finished");
  assert.equal(result.items.filter((i) => i.state === "finished").length, 2);
  assert.equal(f.state.confirmations, 2);
  assert.equal(f.deliveries.get(f.a.id).status, "finished");
  assert.equal(f.deliveries.get(f.b.id).status, "finished");
  await assert.rejects(groups.start(g.id, g.digest));
  assert.equal(f.state.confirmations, 2);
});
test("整批缺回执停在第一项，不发送后续；重启记录不自动执行", async (t) => {
  const f = await twoDeliveries(t),
    groups = new BossGroups(f.workspace, 1, 2),
    g = await groups.prepare([f.a.id, f.b.id]);
  f.state.finish = true;
  f.state.badReceipt = true;
  await groups.start(g.id, g.digest);
  const result = await groups.wait(g.id);
  assert.equal(result.status, "paused");
  assert.equal(result.items[0].state, "needs_review");
  assert.equal(result.items[1].state, "queued");
  assert.equal(f.state.confirmations, 1);
  const remaining = await groups.remaining(g.id);
  assert.deepEqual(
    remaining.items.map((i) => i.deliveryId),
    [f.b.id],
  );
  assert.equal(f.state.confirmations, 1);
  const orphan = {
    ...remaining,
    id: "20000000-0000-4000-8000-000000000001",
    status: "running",
    ownerPid: undefined,
  };
  f.store.put("boss-group", orphan);
  assert.equal(groups.get(orphan.id).status, "paused");
  assert.equal(f.state.confirmations, 1);
});
test("整批暂停只完成当前项，附件变化在发送前被阻止", async (t) => {
  const f = await twoDeliveries(t),
    groups = new BossGroups(f.workspace, 1, 2),
    g = await groups.prepare([f.a.id, f.b.id]);
  f.state.finish = true;
  f.state.onConfirm = () => groups.pause(g.id);
  await groups.start(g.id, g.digest);
  const result = await groups.wait(g.id);
  assert.equal(result.status, "paused");
  assert.equal(result.items[0].state, "finished");
  assert.equal(result.items[1].state, "queued");
  assert.equal(f.state.confirmations, 1);
  const remaining = await groups.remaining(g.id);
  await writeFile(f.b.images[0].path, "changed");
  await assert.rejects(
    groups.start(remaining.id, remaining.digest),
    /图片已变化/,
  );
  assert.equal(f.state.confirmations, 1);
});
test("筛选复用目标、原文和职业别名，遵守读取预算且不发送", async (t) => {
  const f = await fixture(t);
  f.boss.connect(f.link);
  const resume = await f.workspace.createResume(
      "简历.pdf",
      "演示用户\n负责 Go 服务开发。",
    ),
    goal = new Tasks(f.workspace).saveGoal({
      resumeId: resume.id,
      directions: ["Go"],
      cities: ["上海"],
      exclude: ["外包"],
      limit: 2,
    });
  const rows = [
    { url: f.url, title: "Go开发", company: "演示" },
    {
      url: "https://www.zhipin.com/job_detail/outsource.html",
      title: "Go开发",
      company: "外包公司",
    },
    {
      url: "https://www.zhipin.com/job_detail/sales.html",
      title: "销售",
      company: "销售公司",
    },
    {
      url: "https://www.zhipin.com/job_detail/extra.html",
      title: "Go开发",
      company: "其他公司",
    },
  ];
  f.state.rows = rows;
  const scan = await f.boss.read(),
    result = await new BossShortlists(f.workspace).collect(goal.id, scan.id, 1);
  assert.equal(result.detailsRead, 1);
  assert.equal(result.items[0].status, "needs_review");
  assert.deepEqual(result.items[0].evidence, ["负责 Go 服务开发。"]);
  assert.equal(result.items[1].status, "excluded");
  assert.equal(result.items[2].status, "excluded");
  assert.equal(result.items[3].status, "not_read");
  assert.equal(f.state.confirmations, undefined);
  f.state.detail.kind = "verification";
  const blocked = await new BossShortlists(f.workspace).collect(
    goal.id,
    scan.id,
    2,
  );
  assert.equal(blocked.detailsRead, 1);
  assert.equal(blocked.items[3].status, "not_read");
});
test("BOSS 核对界面展示实际岗位与附件，恢复不创建确认", async (t) => {
  const f = await twoDeliveries(t),
    groups = new BossGroups(f.workspace);
  await groups.prepare([f.a.id, f.b.id]);
  const html = renderToStaticMarkup(
    createElement(BossWorkbench, {
      view: bossView(f.workspace),
      busy: false,
      run: async () => {},
      openFile: () => {},
    }),
  );
  assert.match(html, /第二公司/);
  assert.match(html, /整批核对/);
  assert.match(html, /查看该岗位 PDF/);
  assert.match(html, /查看第/);
  assert.match(html, /账号默认招呼/);
  assert.equal(f.state.confirmations, undefined);
  assert.equal(
    JSON.stringify(bossView(f.workspace)).includes("a".repeat(48)),
    false,
  );
});
test("并发刷新旧预览不能覆盖已确认的执行结果", async (t) => {
  const f = await fixture(t);
  f.boss.connect(f.link);
  const scan = await f.boss.read(),
    job = await f.boss.detail(scan.id, f.url),
    resume = await f.workspace.createResume(
      "简历.pdf",
      "演示用户\n负责 Go 服务开发。",
    ),
    deliveries = new BossDeliveries(f.workspace),
    d = await deliveries.prepare(resume.id, job.id);
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>((r) => (entered = r)),
    barrier = new Promise<void>((r) => (release = r));
  f.state.onPreview = () => {
    entered();
    return barrier;
  };
  const pending = deliveries.preview(deliveries.get(d.id));
  await ready;
  f.state.finish = true;
  try {
    await deliveries.confirm(d.id, d.digest);
  } finally {
    release();
  }
  await assert.rejects(pending, /状态已变化/);
  assert.equal(deliveries.get(d.id).status, "finished");
  assert.equal(f.state.confirmations, 1);
});
