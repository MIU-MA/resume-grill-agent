import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { EventEmitter } from "node:events";
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
import { BossDeliveryPanel } from "../../src/adapters/dsh/BossDeliveryPanel.js";
import { bossQueueStatus } from "../../src/adapters/dsh/boss-task-view.js";
import { nativeControls } from "../../src/adapters/dsh/controls.js";
import { bossView } from "../../src/adapters/dsh/views.js";
import { BossExecutor } from "../../src/infrastructure/boss-executor/index.js";
import type { BossBrowserReader } from "../../src/infrastructure/boss-executor/boss-reader.js";

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
      result = state.readResult ?? {
        readId: "snapshot",
        jobs: state.rows ?? [{ url, title: "Go开发", company: "演示" }],
        needsLogin: false,
        needsVerification: false,
      };
    if (req.url === "/search") {
      state.searched = JSON.parse(body).query;
      result = {
        state: "ready",
        query: state.searched,
        readId: "snapshot",
        jobs: state.searchRows ?? [{ url, title: state.searched, company: "演示" }],
      };
      if (state.searchResult) result = state.searchResult;
    }
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
test("选简历找 BOSS 岗位只发送岗位方向，未知方向先询问", async (t) => {
  const f = await fixture(t);
  const clear = await f.workspace.createResume(
    "简历",
    "求职意向：数据分析实习\n邮箱：private@example.com\n教育经历\n统计学本科",
  );
  const unclear = await f.workspace.createResume("简历", "教育经历\n统计学本科");
  f.boss.connect(f.link);

  const waiting = await humanAction(f.workspace, {
    action: "boss-find", resumeId: unclear.id,
  });
  assert.equal(waiting.kind === "boss" && waiting.directionNeededFor, unclear.id);
  assert.deepEqual(f.requests, [], "未知方向不启动搜索");

  const found = await humanAction(f.workspace, { action: "boss-find", resumeId: clear.id });
  assert.equal(found.kind === "boss" && found.scans[0]?.resumeId, clear.id);
  assert.equal(found.kind === "boss" && found.scans[0]?.jobs[0].title, "数据分析实习");
  assert.equal(f.state.searched, "数据分析实习");
  assert.deepEqual(f.requests, ["/search"]);

  const manual = await humanAction(f.workspace, {
    action: "boss-find", resumeId: unclear.id, query: "审计助理",
  });
  assert.equal(manual.kind === "boss" && manual.scans[0]?.resumeId, unclear.id);
  assert.equal(f.state.searched, "审计助理");
  assert.deepEqual(f.requests, ["/search", "/search"]);
});
test("DSH 没有 ego 时可从内置执行器改用 Chrome，继续读取和准备投递", async (t) => {
  const f = await fixture(t);
  const launches: string[] = [];
  let closed = false;
  let address = "https://www.zhipin.com/web/geek/jobs";
  let state = "login",
    query = "",
    navigations = 0,
    loadingReads = 0,
    holdInitialLoad = false;
  const page = Object.assign(new EventEmitter(), {
    url: () => address,
    isClosed: () => closed,
    searchJobs: async (next: string) => {
      navigations++;
      assert.equal(next, "Go");
      address = "https://www.zhipin.com/web/passport/zp/security.html";
      state = "verification";
      query = "";
    },
    evaluate: async () => {
      if (state === "loading" && !holdInitialLoad && loadingReads++ >= 1)
        state = "unsupported";
      return {
        address,
        state,
        query,
        jobs:
          state === "ready"
            ? [{ url: f.url, title: "Go开发", company: "演示", salary: "" }]
            : [],
      };
    },
  });
  const reader = {
    isConnected: () => !closed,
    openBossPage: async () => page,
    withJobPage: async (
      _url: string,
      _page: unknown,
      read: (target: unknown) => Promise<unknown>,
    ) => read({ evaluate: async () => f.state.detail }),
    close: async () => {
      closed = true;
    },
  } as unknown as BossBrowserReader;
  const executor = new BossExecutor(
    join(f.home, "boss-executor"),
    async (backend) => {
      launches.push(backend);
      if (backend !== "chrome") throw new Error("浏览器不可用");
      return reader;
    },
  );
  f.boss.useExecutor(executor);
  assert.equal((await f.boss.status()).ready, false);
  assert.deepEqual(launches, [], "被动查看状态不能启动浏览器");
  f.store.put("boss-browser", { id: "boss-browser:preferred", backend: "ego" });
  const searchResume = await f.workspace.createResume("简历", "求职意向：Go");
  const connected = await humanAction(f.workspace, {
    action: "boss-find",
    resumeId: searchResume.id,
  });
  assert.equal(connected.kind === "boss" && connected.connected, true);
  assert.equal(connected.kind === "boss" && connected.scans[0]?.state, "login");
  assert.deepEqual(launches, ["ego", "edge", "chrome"]);
  assert.equal(connected.kind === "boss" && connected.browserPreference, "chrome");
  assert.equal((await f.boss.status()).backend, "chrome");
  assert.match((await f.boss.read()).blocked ?? "", /登录/);
  assert.equal((await f.boss.search("Go")).state, "login");
  assert.equal(navigations, 0);

  state = "loading";
  holdInitialLoad = true;
  const deferred = await f.boss.search("Go", searchResume.id);
  assert.equal(deferred.state, "loading");
  assert.equal(deferred.searchDeferred, true);
  assert.equal(deferred.requestedQuery, "Go");
  assert.equal(navigations, 0);

  holdInitialLoad = false;
  assert.equal((await f.boss.search("Go", searchResume.id)).state, "verification");
  assert.equal(loadingReads, 2, "首屏加载结束后应发起搜索");
  assert.equal((await f.boss.search("Go")).state, "verification");
  assert.equal((await f.boss.read()).state, "verification");
  assert.equal(navigations, 1, "read/retry must not interrupt verification");

  address = "https://www.zhipin.com/web/geek/jobs?city=100010000&query=Go";
  state = "ready";
  query = "Go";
  const scan = await f.boss.search("Go");
  assert.equal(scan.state, "ready");
  assert.equal(navigations, 1, "same search reuses the page");
  const job = await f.boss.detail(scan.id, f.url);
  assert.equal(job.jd, "开发 Go 服务");
  const resume = await f.workspace.createResume(
    "演示简历",
    "负责 Go 服务开发。",
  );
  const delivery = await new BossDeliveries(f.workspace).prepare(
    resume.id,
    job.id,
  );
  assert.equal(delivery.status, "prepared");
  assert.equal(delivery.images.length, 1);
  assert.deepEqual(await f.boss.recent(), []);
  assert.equal(f.requests.length, 0);
  const view = await humanAction(f.workspace, { action: "boss-unlink" });
  assert.equal(view.kind === "boss" && view.connected, false);
  assert.equal(new Boss(new Workspace(f.store)).browserPreference, "chrome");
  assert.equal(closed, true);
  await assert.rejects(
    f.boss.browserConnect("edge"),
    /无法启动 Microsoft Edge/,
  );
  assert.deepEqual(launches, ["ego", "edge", "chrome", "edge"]);
  await executor.close();
});

test("手动切换浏览器后在新会话搜索，启动失败时保留当前连接", async (t) => {
  const f = await fixture(t);
  const launches: string[] = [];
  const searches: string[] = [];
  const closed: string[] = [];
  const executor = new BossExecutor(join(f.home, "boss-executor"), async (backend) => {
    launches.push(backend);
    if (backend === "ego") throw new Error("浏览器不可用");
    let keyword = "";
    let connected = true;
    const address = "https://www.zhipin.com/web/geek/jobs";
    const page = Object.assign(new EventEmitter(), {
      url: () => address,
      isClosed: () => !connected,
      searchJobs: async (query: string) => {
        searches.push(`${backend}:${query}`);
        keyword = query;
      },
      evaluate: async () => ({
        address,
        query: keyword,
        state: backend === "edge" ? "verification" : keyword ? "ready" : "unsupported",
        jobs: keyword ? [{ url: f.url, title: keyword, company: "演示" }] : [],
      }),
    });
    return {
      isConnected: () => connected,
      openBossPage: async () => page,
      close: async () => {
        connected = false;
        closed.push(backend);
      },
    } as unknown as BossBrowserReader;
  });
  t.after(() => executor.close());
  f.boss.useExecutor(executor);

  const html = renderToStaticMarkup(createElement(BossWorkbench, {
    view: bossView(f.workspace), busy: false, run: async () => {},
  }));
  for (const choice of ["auto", "ego", "edge", "chrome"])
    assert.match(html, new RegExp(`<option value="${choice}"`));

  const path = join(f.home, "简历.txt");
  await writeFile(path, "教育经历\n统计学本科");
  const resume = await f.workspace.importResume(path);
  const edge = await humanAction(f.workspace, { action: "boss-connect", backend: "edge" });
  assert.equal(edge.kind === "boss" && edge.browserState?.backend, "edge");
  const search = { action: "boss-auto-prepare", resumeId: resume.id };
  const verifying = await humanAction(f.workspace, { ...search, backend: "edge", query: "Go开发" });
  assert.equal(verifying.kind === "boss" && verifying.scans[0]?.state, "verification");
  assert.deepEqual(searches, []);

  const chrome = await humanAction(f.workspace, { ...search, backend: "chrome", readCurrent: true });
  assert.equal(chrome.kind === "boss" && chrome.browserState?.backend, "chrome");
  assert.equal(chrome.kind === "boss" && chrome.scans.length, 1);
  assert.equal(chrome.kind === "boss" && chrome.scans[0]?.jobs[0]?.title, "Go开发");
  assert.deepEqual(searches, ["chrome:Go开发"]);
  assert.deepEqual(closed, ["edge"]);

  await assert.rejects(
    humanAction(f.workspace, { action: "boss-connect", backend: "ego" }),
    /无法启动 ego/,
  );
  assert.equal((await f.boss.status()).backend, "chrome");
  assert.equal(f.boss.browserPreference, "chrome");
  assert.deepEqual(closed, ["edge"]);

  const switchedBack = await humanAction(f.workspace, { action: "boss-connect", backend: "edge" });
  assert.equal(switchedBack.kind === "boss" && switchedBack.scans.length, 0);
  assert.deepEqual(launches, ["edge", "chrome", "ego", "edge"]);
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
test("一次搜索自动核对匹配 JD 并冻结投递，移出岗位后旧批次不可确认", async (t) => {
  const f = await fixture(t);
  f.boss.connect(f.link);
  const resume = await f.workspace.createResume("主简历", "求职意向：Go开发\n负责 Go 服务开发。");
  const secondUrl = "https://www.zhipin.com/job_detail/second.html";
  f.state.searchRows = [
    { url: f.url, title: "Go开发", company: "演示" },
    { url: secondUrl, title: "Go开发", company: "第二公司" },
    { url: "https://www.zhipin.com/job_detail/unrelated.html", title: "财务", company: "第三公司" },
  ];
  f.state.details = { [secondUrl]: { ...f.state.detail, url: secondUrl, company: "第二公司" } };
  const input = { action: "boss-auto-prepare", resumeId: resume.id };
  f.state.searchResult = { state: "verification", jobs: [], message: "请完成安全验证" };
  const blocked = await humanAction(f.workspace, input);
  assert.equal(blocked.kind === "boss" && blocked.scans[0]?.state, "verification");
  assert.deepEqual(f.requests, ["/search"]);

  delete f.state.searchResult;
  const view = await humanAction(f.workspace, input);
  assert.equal(view.kind, "boss");
  const group = view.groups.find((g) => g.id === view.groupFocus)!;
  assert.equal(group.status, "prepared");
  assert.equal(group.items.length, 2);
  assert.ok(view.deliveries.every((d) => d.resumeId === resume.id && d.images.length > 0));
  assert.deepEqual(f.requests.slice(1), [
    "/search", "/inspect-job", "/inspect-job", "/boss-batch/preview", "/boss-batch/preview",
  ]);
  const updated = await humanAction(f.workspace, {
    action: "boss-group-remove",
    id: group.id,
    deliveryId: group.items[1].deliveryId,
  });
  assert.equal(updated.kind === "boss" && updated.groups.find((g) => g.id === updated.groupFocus)?.items.length, 1);
  await assert.rejects(humanAction(f.workspace, {
    action: "boss-group-confirm",
    id: group.id,
    digest: group.digest,
    acknowledged: true,
    confirmation: "投递",
  }), /过期/);
  assert.equal(f.state.confirmations, undefined);
});
test("自动准备从当前页生成 10 个匹配岗位的待确认批次", async (t) => {
  const f = await fixture(t);
  f.boss.connect(f.link);
  const resume = await f.workspace.createResume("主简历", "求职意向：Go开发");
  const jobs = Array.from({ length: 11 }, (_, index) => ({
    url: `https://www.zhipin.com/job_detail/limit-${index}.html`,
    title: "Go开发",
    company: `演示公司 ${index + 1}`,
  }));
  f.state.searchRows = jobs;
  f.state.details = Object.fromEntries(jobs.map((job) => [
    job.url, { ...f.state.detail, ...job },
  ]));

  const view = await humanAction(f.workspace, { action: "boss-auto-prepare", resumeId: resume.id });
  assert.equal(view.kind, "boss");
  const group = view.groups.find((item) => item.id === view.groupFocus);
  assert.equal(group?.status, "prepared");
  assert.equal(group?.items.length, 10);
  assert.equal(view.deliveries.length, 10);
  assert.equal(view.shortlists[0].detailsRead, 10);
  assert.equal(view.shortlists[0].items[10].status, "not_read");
  assert.equal(f.requests.filter((path) => path === "/boss-batch/preview").length, 10);
  assert.equal(f.requests.includes("/boss-batch/confirm"), false);
});

test("上传文本简历仍能找岗位，但明确说明没有可用于 BOSS 的 PDF", async (t) => {
  const f = await fixture(t);
  f.boss.connect(f.link);
  const path = join(f.home, "主简历.txt");
  await writeFile(path, "求职意向：Go开发");
  const resume = await f.workspace.importResume(path);
  const view = await humanAction(f.workspace, {
    action: "boss-auto-prepare",
    resumeId: resume.id,
  });
  assert.equal(view.kind, "boss");
  assert.equal(view.scans[0]?.jobs.length, 1);
  assert.match(view.note ?? "", /不是 PDF/);
  assert.equal(view.groupFocus, undefined);
  assert.deepEqual(f.requests, ["/search"]);
});
test("搜索等待中的旧关键词不能替换本轮关键词或准备附件", async (t) => {
  const f = await fixture(t);
  f.boss.connect(f.link);
  const resume = await f.workspace.createResume("主简历", "求职意向：Go开发");
  const input = { action: "boss-auto-prepare", resumeId: resume.id };
  f.state.searchResult = {
    state: "loading", query: "财务", jobs: [], message: "加载中",
  };
  const loading = await humanAction(f.workspace, input);
  assert.equal(loading.kind === "boss" && loading.scans[0]?.requestedQuery, "Go开发");
  f.state.readResult = {
    state: "ready", query: "", readId: "stale",
    jobs: [{ url: f.url, title: "财务", company: "演示" }],
  };
  const old = await humanAction(f.workspace, { ...input, readCurrent: true });
  assert.equal(old.kind === "boss" && old.scans[0]?.requestedQuery, "Go开发");
  assert.equal(old.kind === "boss" && old.scans[0]?.jobs.length, 0);
  assert.match(old.kind === "boss" ? old.scans[0]?.blocked ?? "" : "", /不是这次搜索的结果/);
  assert.deepEqual(f.requests, ["/search", "/jobs"]);

  f.state.readResult = {
    ...f.state.readResult, query: "Go开发", readId: "snapshot",
    jobs: [{ url: f.url, title: "Go开发", company: "演示" }],
  };
  const current = await humanAction(f.workspace, { ...input, readCurrent: true });
  assert.ok(current.kind === "boss" && current.groupFocus);
  assert.deepEqual(f.requests.slice(2), ["/jobs", "/inspect-job", "/boss-batch/preview"]);
  assert.equal(f.state.confirmations, undefined);
});

test("核对附件期间移出岗位，正在等待的旧确认不能开始投递", async (t) => {
  const f = await twoDeliveries(t);
  const groups = new BossGroups(f.workspace);
  const group = await groups.prepare([f.a.id, f.b.id]);
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((done) => { enter = done; });
  const ready = new Promise<void>((done) => { release = done; });
  const validate = BossDeliveries.prototype.validate;
  t.mock.method(BossDeliveries.prototype, "validate", async function (this: BossDeliveries, item: typeof f.a) {
    if (item.id === f.a.id && this.workspace === f.workspace) {
      enter();
      await ready;
    }
    await validate.call(this, item);
  });
  const pending = assert.rejects(groups.start(group.id, group.digest), /过期/);
  try {
    await entered;
    await groups.removeItem(group.id, f.a.id);
  } finally {
    release();
  }
  await pending;
  assert.equal(f.state.confirmations, undefined);
  assert.equal(groups.get(group.id).expiresAt, 0);
});
test("归档单条和整批后可查询恢复，旧确认不能投递且成员不会露回当前列表", async (t) => {
  const f = await twoDeliveries(t);
  const groups = new BossGroups(f.workspace);
  const archive = (kind: "delivery" | "group", id: string, archived: boolean) =>
    humanAction(f.workspace, { action: "boss-archive-task", kind, id, archived });
  const render = (view: ReturnType<typeof bossView>, archivedOnly = false) =>
    renderToStaticMarkup(createElement(BossDeliveryPanel, {
      view, busy: false, run: async () => undefined,
      archiveFilter: { archivedOnly, setArchivedOnly: () => {} },
    }));
  const requestCount = f.requests.length;

  await archive("delivery", f.a.id, true);
  const view = bossView(f.workspace);
  assert.equal((render(view).match(/查看投递/g) ?? []).length, 1);
  assert.match(render(view, true), /查看投递.*恢复/);
  await assert.rejects(f.deliveries.confirm(f.a.id, f.a.digest), /已归档/);
  await assert.rejects(groups.prepare([f.a.id]), /已归档/);
  assert.equal(f.deliveries.get(f.a.id).digest, f.a.digest);
  await archive("delivery", f.a.id, false);

  const group = await groups.prepare([f.a.id, f.b.id]);
  await archive("group", group.id, true);
  const reopened = new Store(f.store.home);
  try {
    const snapshot = bossView(new Workspace(reopened));
    assert.deepEqual(snapshot.archivedTaskIds, [group.id]);
    assert.doesNotMatch(render(snapshot), /查看批次|查看投递/);
    assert.match(render(snapshot, true), /查看批次.*恢复/);
    assert.doesNotMatch(render({ ...snapshot, groupFocus: group.id }), /确认投递/);
  } finally {
    reopened.close();
  }
  await assert.rejects(groups.start(group.id, group.digest), /已归档/);
  await assert.rejects(f.deliveries.confirm(f.a.id, f.a.digest), /批次已归档/);
  await archive("group", group.id, false);
  assert.equal(groups.get(group.id).digest, group.digest);
  assert.match(render(bossView(f.workspace)), /查看批次.*归档/);

  f.store.put("boss-delivery", { ...f.a, status: "submitting" });
  await assert.rejects(archive("group", group.id, true), /仍在执行/);
  await assert.rejects(archive("delivery", f.a.id, true), /仍在执行/);
  assert.equal(f.requests.length, requestCount, "归档和恢复必须只读写本地数据");
});
test("待投清单可追加、调序、换 PDF 和移出，旧核对及旧附件不可确认", async (t) => {
  const f = await fixture(t);
  f.boss.connect(f.link);
  const secondUrl = "https://www.zhipin.com/job_detail/second.html";
  f.state.rows = [
    { url: f.url, title: "Go开发", company: "演示" },
    { url: secondUrl, title: "Go开发", company: "第二公司" },
  ];
  f.state.details = { [secondUrl]: { ...f.state.detail, url: secondUrl, company: "第二公司" } };
  const scan = await f.boss.read();
  const original = await f.workspace.createResume("主简历", "负责 Go API 开发。"),
    replacement = await f.workspace.createResume("备用简历", "负责 Go API 测试。");
  const run = async (input: unknown) => {
    const view = await humanAction(f.workspace, input);
    assert.equal(view.kind, "boss");
    return view;
  };
  const add = (url: string, groupId?: string) => run({ action: "boss-queue-add", scanId: scan.id, url,
    resumeId: original.id, ...(groupId ? { groupId } : {}),
  });
  const groups = new BossGroups(f.workspace);
  await add(f.url);
  const first = groups.list()[0];
  const item = first.items[0];
  await assert.rejects(add(f.url, first.id), /重复联系|已有待投/);
  const joined = await add(secondUrl, first.id);
  assert.equal(bossQueueStatus(joined, f.url), "已加入");
  const pair = groups.list()[0];
  assert.equal(pair.items.length, 2);
  await assert.rejects(groups.start(first.id, first.digest), /过期/);

  const ordered = await run({ action: "boss-queue-move", id: pair.id, deliveryId: item.deliveryId, step: 1 });
  const moved = groups.get(ordered.groupFocus!);
  assert.equal(moved.items[1].deliveryId, item.deliveryId);
  const updated = await run({ action: "boss-queue-resume", groupId: moved.id, deliveryId: item.deliveryId, resumeId: replacement.id });
  const reviewed = groups.get(updated.groupFocus!);
  const newItem = reviewed.items[1];
  const deliveries = new BossDeliveries(f.workspace);
  assert.equal(deliveries.get(newItem.deliveryId).resumeId, replacement.id);
  assert.notEqual(newItem.digest, item.digest);
  assert.ok(deliveries.get(item.deliveryId).withdrawnAt);
  await assert.rejects(deliveries.confirm(item.deliveryId, item.digest), /过期|重新核对/);
  await assert.rejects(groups.start(moved.id, moved.digest), /过期/);

  const remaining = await run({ action: "boss-group-remove", id: reviewed.id, deliveryId: newItem.deliveryId });
  assert.equal(bossQueueStatus(remaining, f.url), undefined);
  const last = groups.get(remaining.groupFocus!);
  const empty = await run({ action: "boss-group-remove", id: last.id, deliveryId: last.items[0].deliveryId });
  assert.equal(bossQueueStatus(empty, secondUrl), undefined);
  assert.equal(empty.groups.filter((group) => group.expiresAt !== 0).length, 0);
  await add(f.url);
  assert.equal(groups.list()[0].items.length, 1);
  assert.ok(f.requests.every((route) => !route.startsWith("/boss-batch/")), "编辑待投不调用投递执行器");
});
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
  const group = await groups.prepare([f.a.id, f.b.id]);
  const html = renderToStaticMarkup(
    createElement(BossWorkbench, {
      view: bossView(f.workspace, { groupFocus: group.id }),
      busy: false,
      run: async () => {},
    }),
  );
  assert.match(html, /第二公司/);
  assert.match(html, /确认投递 2 个岗位/);
  assert.doesNotMatch(html, /找岗位并准备投递|输入.*投递.*确认本批/);
  assert.equal(html.match(/>查看简历<\/button>/g)?.length, 2);
  assert.doesNotMatch(html, /查看该岗位 PDF|查看第/);
  assert.match(html, /账号默认招呼/);
  const list = renderToStaticMarkup(
    createElement(BossWorkbench, {
      view: bossView(f.workspace),
      busy: false,
      run: async () => {},
    }),
  );
  assert.match(list, /查看批次/);
  assert.doesNotMatch(list, /确认投递 2 个岗位|<details|更多选项/);
  assert.doesNotMatch(list, /确认并投递此岗位|选择要一起投递的岗位/);
  const fromHistory = await humanAction(f.workspace, { action: "boss", deliveryFocus: f.a.id });
  assert.equal(fromHistory.kind === "boss" && fromHistory.groupFocus, group.id);
  assert.equal(f.state.confirmations, undefined);
  assert.equal(
    JSON.stringify(bossView(f.workspace)).includes("a".repeat(48)),
    false,
  );
});
test("未知 BOSS 命令不会进入通用动作校验，旧宿主错误提示重开 DSH", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    humanAction(f.workspace, { action: "boss-future-action" }),
    /不支持这个 BOSS 操作/,
  );
  const { act } = nativeControls({
    remote: { commands: { execute: async () => ({
      ok: true,
      value: { result: { kind: "error", text: '[{"code":"invalid_union","path":["action"]}]' } },
    }) } },
  }, "test");
  await assert.rejects(act({ action: "boss-group-prepare" }), /完全退出 DSH/);
  assert.deepEqual(f.requests, []);
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
