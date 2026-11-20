import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Store } from "../../src/infrastructure/sqlite-store.js";
import { Workspace } from "../../src/core/workspace.js";
import { mount } from "../../src/adapters/dsh/host.js";
import { nativeControls } from "../../src/adapters/dsh/controls.js";
import { humanAction, cardAction, restoreView } from "../../src/adapters/dsh/actions.js";
import { turnCardSelector, viewReference } from "../../src/adapters/dsh/card-model.js";
import { rememberPage, rememberedPage } from "../../src/adapters/dsh/workbench-state.js";
import { Tasks } from "../../src/core/tasks.js";
import { batchView, reviewView, workspaceView } from "../../src/adapters/dsh/views.js";
import { WorkspaceOverview } from "../../src/adapters/dsh/WorkspaceOverview.js";
import { ApplicationHistory } from "../../src/adapters/dsh/ApplicationHistory.js";
import { JobMailCompose } from "../../src/adapters/dsh/JobMailCompose.js";
import { SearchGoals } from "../../src/adapters/dsh/SearchGoals.js";
import { operations } from "../../src/core/operations.js";
import { ResumeProfiles } from "../../src/core/resume-profiles.js";
import {
  activeCapabilities,
  NativeConfig,
} from "../../src/adapters/dsh/config.js";

async function setup(t: any) {
  const home = await mkdtemp(join(tmpdir(), "resume-dsh-test-")),
    store = new Store(home);
  let sends = 0;
  const workspace = new Workspace(store, async (mail) => {
    sends++;
    return {
      accepted: [mail.recipient],
      response: "250 test",
      messageId: mail.messageId,
      acceptedAt: Date.now(),
    };
  });
  t.after(async () => {
    store.close();
    if (
      dirname(home) === tmpdir() &&
      basename(home).startsWith("resume-dsh-test-")
    )
      await rm(home, { recursive: true, force: true, maxRetries: 5 });
  });
  const file = join(home, "demo.txt");
  await writeFile(file, "演示用户\n项目经历\n- 负责 Go API 开发与测试。");
  const resume = await workspace.importResume(file),
    job = workspace.addJob({
      company: "演示公司",
      role: "Go",
      jd: "演示公司招聘 Go，负责 Go API 开发与测试。",
      sourceUrl: "https://example.com/jobs/demo",
      recipient: "hr@example.com",
    });
  const context = workspace.reviewContext(resume.id, job.id),
    section = context.sections.find((s) =>
      s.lines.some((l) => l.includes("Go")),
    )!;
  const plan = {
    company: "演示公司",
    role: "Go",
    sectionOrder: context.sections.map((s) => s.id),
    changes: [
      {
        sectionId: section.id,
        lineIndex: section.lines.findIndex((l) => l.includes("Go")),
        after: "- 参与 Go API 开发与测试。",
        requirement: "Go API 开发与测试",
        reason: "写清参与范围。",
      },
    ],
    highlights: [],
    gaps: [],
  };
  const proposal = workspace.propose(resume.id, job.id, plan);
  return { workspace, store, resume, job, proposal, sends: () => sends };
}

test("工作台按会话和页面恢复记录引用，返回时读取最新数据", async (t) => {
  const entries = new Map<string, string>();
  const original = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => entries.set(key, value),
      removeItem: (key: string) => entries.delete(key),
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "sessionStorage", original);
    else Reflect.deleteProperty(globalThis, "sessionStorage");
  });

  const { workspace, resume, job, sends } = await setup(t);
  const opened = await humanAction(workspace, { action: "resume", id: resume.id });
  rememberPage("session-a", "resumes", viewReference(opened));
  rememberPage("session-a", "jobs", { action: "review", resumeId: resume.id, jobId: job.id });
  assert.equal(rememberedPage("session-b", "resumes"), null);
  assert.equal(sends(), 0);

  await humanAction(workspace, { action: "rename-resume", id: resume.id, name: "新的文件名" });
  const reopened = await restoreView(workspace, rememberedPage("session-a", "resumes"));
  assert.equal(reopened?.kind === "resume" && reopened.resume.name, "新的文件名");

  rememberPage("session-a", "resumes");
  assert.equal(rememberedPage("session-a", "resumes"), null);
  const review = await restoreView(workspace, rememberedPage("session-a", "jobs"));
  assert.equal(review?.kind === "review" && review.jobId, job.id);
  assert.equal(sends(), 0);
});

test("邮箱投递只需收件人与简历，冻结附件后沿用邮件确认流程", async (t) => {
  const { workspace: fixture, store, resume, job, sends } = await setup(t);
  const workspace = new Workspace(store, fixture.send, () => true);
  assert.equal(workspaceView(workspace).sendingEnabled, true);
  assert.equal(workspaceView(new Workspace(store)).sendingEnabled, false);
  const request = { action: "prepare-direct-mail", resumeId: resume.id, recipient: "hr@example.com" };
  const preview = await humanAction(workspace, request);
  assert.equal(preview.kind, "application");
  assert.equal(preview.application.jobId, undefined);
  assert.equal(preview.application.status, "prepared");
  assert.equal(preview.application.recipient, request.recipient);
  assert.match((await readFile(preview.application.attachment)).toString("ascii", 0, 8), /^%PDF-/);
  assert.deepEqual(workspaceView(workspace).jobs.map((item) => item.id), [job.id]);
  await assert.rejects(restoreView(workspace, request), /只能查询记录/);
  assert.equal(sends(), 0);

  const revised = await humanAction(workspace, {
    action: "revise", id: preview.application.id, digest: preview.application.digest,
    recipient: request.recipient, subject: "应聘开发实习生", body: "您好，附件是简历。",
  });
  assert.equal(revised.kind, "application");
  assert.equal(revised.application.attachmentHash, preview.application.attachmentHash);
  const repeated = await humanAction(workspace, request);
  assert.equal(repeated.kind === "application" && repeated.application.id, revised.application.id);

  const sent = await humanAction(workspace, {
    action: "send", id: revised.application.id, digest: revised.application.digest,
    acknowledged: true, confirmation: "发送",
  });
  assert.equal(sent.kind === "application" && sent.application.status, "sent");
  assert.equal(sends(), 1);
});

test("旧宿主的工作台快照缺少 BOSS 字段时，总览仍能渲染", async (t) => {
  const { workspace, resume } = await setup(t);
  const data = workspaceView(workspace);
  const { bossDeliveries, capabilities, ...previousHost } = data;
  const render = (snapshot: typeof previousHost) =>
    renderToStaticMarkup(
      createElement(WorkspaceOverview, {
        data: snapshot,
        busy: false,
        navigate: () => {},
        open: () => {},
      }),
    );
  const overview = render(previousHost);
  assert.match(overview, /求职总览/);
  assert.ok(overview.includes(resume.name));
  assert.doesNotMatch(overview, /BOSS 已核验/);
  assert.match(render(data), /BOSS 已核验/);
});

test("三种投递共用跟进记录，官网手动记录可重复点击，跟进不改变回执", async (t) => {
  const f = await setup(t);
  const record = (jobId: string) => humanAction(f.workspace, {
    action: "record-website-submission", resumeId: f.resume.id, jobId,
  });
  const first = await record(f.job.id);
  const { id: originalJobId, ...jobFields } = f.job;
  const editedJob = f.workspace.addJob({ ...jobFields, jd: `${f.job.jd} · 新要求` });
  assert.notEqual(editedJob.id, originalJobId);
  const repeated = await record(editedJob.id);
  assert.equal(first.kind === "review" && first.websiteSubmissionAt, repeated.kind === "review" && repeated.websiteSubmissionAt);
  const websiteId = workspaceView(f.workspace).websiteSubmissions![0].id;
  assert.equal(workspaceView(f.workspace).websiteSubmissions?.length, 1);
  const save = (channel: string, applicationId: string, revision = 0, stage = "interview", dueDate = "2025-03-10") =>
    humanAction(f.workspace, { action: "save-application-followup", channel, applicationId, revision,
      data: { stage, dueDate, note: "面试前复习项目" },
    });
  await save("website", websiteId);
  await assert.rejects(save("website", websiteId), /已被更新/);
  await assert.rejects(save("website", websiteId, 1, "interview", "2025-02-30"));
  const draft = await humanAction(f.workspace, { action: "prepare", resumeId: f.resume.id,
    jobId: f.job.id, proposalId: f.proposal.id, accepted: [],
  });
  assert.equal(draft.kind, "application");
  await assert.rejects(save("mail", draft.application.id), /还在准备/);
  f.store.put("application", { ...draft.application, status: "sent" });
  await save("mail", draft.application.id);
  const bossJob = f.workspace.addJob({ company: "BOSS 公司", role: "Go", jd: "开发 Go", sourceUrl: "https://www.zhipin.com/job_detail/demo.html" });
  await assert.rejects(record(bossJob.id), /BOSS 投递/);
  const bossId = randomUUID();
  f.store.put("boss-delivery", { id: bossId, company: bossJob.company, role: bossJob.role,
    resumeName: f.resume.name, status: "finished", createdAt: Date.now() });
  await save("boss", bossId);
  await save("website", websiteId, 1, "closed");
  const snapshot = workspaceView(f.workspace);
  assert.equal(snapshot.applications[0].status, "sent");
  assert.equal(snapshot.bossDeliveries?.[0].status, "finished");
  assert.equal(snapshot.applicationFollowups.length, 3);
  assert.equal(snapshot.applicationFollowups.find((item) => item.channel === "website")?.dueDate, "");
  const html = renderToStaticMarkup(createElement(ApplicationHistory, { data: snapshot, pending: false,
    busy: false, open: () => {}, save: async () => true,
  }));
  assert.match(html, /到期跟进 2/);
  assert.match(html, /手动记录已提交/);
  assert.match(html, /SMTP 已接受/);
  assert.match(html, /已投递并核验/);
  assert.equal(f.sends(), 0);
});

test("官网代填遇到旧版宿主时提示重启或更新插件，普通填写错误原样保留", async () => {
  const legacyError = JSON.stringify([{
    code: "invalid_union", discriminator: "action", path: ["action"],
    message: "Invalid discriminator value. Expected 'workspace' | 'review'",
  }]);
  const request = { action: "website-fill", resumeId: "resume", jobId: "job" };
  for (const response of [
    { ok: true, value: { result: { kind: "error", text: legacyError } } },
    { ok: false, error: { message: legacyError } },
  ]) {
    const controls = nativeControls({ remote: { commands: { execute: async () => response } } }, "session");
    await assert.rejects(controls.act(request), /Resume Grill 后端还不支持官网代填.*完全退出 DSH.*更新插件/);
    await assert.rejects(controls.act({ action: "review" }), { message: legacyError });
  }
  for (const message of ["请先核对并确认简历资料。", '{"code":"invalid_union","discriminator":"type"}']) {
    const controls = nativeControls({ remote: { commands: { execute: async () => ({
      ok: true, value: { result: { kind: "error", text: message } },
    }) } } }, "session");
    await assert.rejects(controls.act(request), { message });
  }
});

test("BOSS 分享链接与招聘官网分别进入自己的流程", async (t) => {
  const f = await setup(t);
  const sourceUrl = "https://m.zhipin.com/job_detail/demo.html?from=share";
  const job = f.workspace.addJob({ company: "演示", role: "Go", jd: "开发", sourceUrl });
  const profiles = new ResumeProfiles(f.workspace);
  const draft = profiles.draft(f.resume.id);
  profiles.confirm(draft.id, draft.data);
  const view = reviewView(f.workspace, f.resume.id, job.id);
  assert.equal(view.channel, "boss");
  assert.equal(view.profile, undefined);
  assert.equal(reviewView(f.workspace, f.resume.id, f.job.id).channel, "website");
  assert.deepEqual(workspaceView(f.workspace).jobs.map((item) => item.id), [f.job.id]);
  await assert.rejects(humanAction(f.workspace, { action: "read-job", url: sourceUrl }), /BOSS 投递/);

  let command: any;
  mount({
    tools: { register: () => () => {}, resolve: async () => assert.fail("BOSS 不应检查官网浏览器工具") },
    commands: { register: (entry) => { command = entry; return () => {}; } },
    systemPrompt: { section: () => () => {} },
    effect: (fn) => fn(),
  }, f.workspace);
  const blocked = await command.handler({
    rawInput: JSON.stringify({ action: "browser-check", resumeId: f.resume.id, jobId: job.id }),
    agent: { id: "session" },
    signal: new AbortController().signal,
  });
  assert.equal(blocked.kind, "error");
  assert.match(blocked.text, /BOSS 投递/);
});

test("BOSS 单独启用时只注册对应工具，旧邮件卡和官网命令不能执行", async (t) => {
  const f = await setup(t);
  const config = NativeConfig({ disabledCapabilities: ["mail", "website"] });
  const workspace = new Workspace(
    f.store,
    undefined,
    undefined,
    activeCapabilities(config.disabledCapabilities),
  );
  const tools = new Set<string>(),
    prompts = new Set<string>();
  let command: any;
  mount(
    {
      tools: {
        register: ({ name }) => {
          tools.add(name);
          return () => tools.delete(name);
        },
      },
      commands: {
        register: (entry) => {
          command = entry;
          return () => {};
        },
      },
      systemPrompt: {
        section: ({ name }) => {
          prompts.add(name);
          return () => prompts.delete(name);
        },
      },
      effect: (fn) => fn(),
    },
    workspace,
  );
  assert.ok(tools.has("resume_grill_boss_read_jobs"));
  assert.ok(tools.has("resume_grill_review_context"));
  assert.ok(!tools.has("resume_grill_prepare_application"));
  assert.ok(!tools.has("resume_grill_start_form_run"));
  assert.deepEqual(prompts, new Set(["resume-grill", "resume-grill-boss"]));
  const snapshot = operations(workspace)
    .find((op) => op.name === "list_workspace")!
    .run({}) as object;
  assert.ok("bossScans" in snapshot);
  assert.ok(!("formRuns" in snapshot || "batches" in snapshot));

  const old = await humanAction(f.workspace, {
    action: "prepare",
    resumeId: f.resume.id,
    jobId: f.job.id,
    proposalId: f.proposal.id,
    accepted: [],
  });
  assert.equal(old.kind, "application");
  if (old.kind !== "application") return;
  assert.equal(workspaceView(workspace).applications.length, 0);
  await assert.rejects(
    cardAction(workspace, "session", "old-card", {
      action: "restore",
      reference: { action: "application", id: old.application.id },
    }),
    /邮件投递模块未启用/,
  );
  const checked = await command.handler({
    rawInput: JSON.stringify({
      action: "browser-check",
      resumeId: f.resume.id,
    }),
    agent: { id: "session" },
    signal: new AbortController().signal,
  });
  assert.equal(checked.kind, "error");
  assert.match(checked.text, /官网填写模块未启用/);
  const status = await command.handler({
    rawInput: JSON.stringify({ action: "capability-status" }),
    agent: { id: "session" },
    signal: new AbortController().signal,
  });
  assert.equal(status.kind, "success");
  assert.deepEqual(JSON.parse(status.text), { capabilities: ["boss"] });
  assert.equal(workspaceView(f.workspace).applications.length, 1);
  assert.equal(f.sends(), 0);

  const baseOnly = new Workspace(f.store, undefined, undefined, []);
  assert.deepEqual(workspaceView(baseOnly).capabilities, []);
  assert.equal(workspaceView(baseOnly).bossDeliveries, undefined);
  await assert.rejects(
    humanAction(baseOnly, { action: "boss" }),
    /BOSS 投递模块未启用/,
  );
});

test("从岗位清单进入核对后仍保留城市与排除条件，不另建宽松目标", async (t) => {
  const f = await setup(t),
    tasks = new Tasks(f.workspace);
  const goal = tasks.saveGoal({
    resumeId: f.resume.id,
    directions: ["Go"],
    cities: ["杭州"],
    exclude: ["外包"],
  });
  const view = await humanAction(f.workspace, {
    action: "review",
    resumeId: f.resume.id,
    jobId: f.job.id,
    goalId: goal.id,
  });
  assert.equal(view.kind === "review" && view.goalId, goal.id);
  const profile = await humanAction(f.workspace, {
    action: "profile", resumeId: f.resume.id, jobId: f.job.id, goalId: goal.id,
  });
  assert.equal(profile.kind === "profile" && profile.goalId, goal.id);
  assert.deepEqual(viewReference(profile), {
    action: "profile", resumeId: f.resume.id, jobId: f.job.id, goalId: goal.id,
  });
  const updated = await humanAction(f.workspace, {
    action: "update-jd", id: f.job.id, resumeId: f.resume.id, jd: "招聘 Go 开发。", goalId: goal.id,
  });
  assert.equal(updated.kind === "review" && updated.goalId, goal.id);
  await assert.rejects(
    humanAction(f.workspace, {
      action: "prepare",
      resumeId: f.resume.id,
      jobId: f.job.id,
      proposalId: f.proposal.id,
      accepted: [],
      goalId: goal.id,
    }),
    /城市/,
  );
  assert.equal(f.store.list("goal").length, 1);
  assert.equal(f.workspace.history().length, 0);
  const excluded = tasks.saveGoal({
    resumeId: f.resume.id,
    directions: ["Go"],
    exclude: ["演示公司"],
  });
  await assert.rejects(
    humanAction(f.workspace, {
      action: "prepare",
      resumeId: f.resume.id,
      jobId: f.job.id,
      proposalId: f.proposal.id,
      accepted: [],
      goalId: excluded.id,
    }),
    /排除/,
  );
});

test("岗位可手填收件邮箱准备预览，邮件批次可从工作台重新打开", async (t) => {
  const f = await setup(t);
  const job = f.workspace.addJob({
    company: "另一家公司",
    role: "Go 开发",
    jd: "负责 Go 后端开发。",
    sourceUrl: "https://example.com/jobs/go",
  });
  const html = renderToStaticMarkup(createElement(JobMailCompose, {
    view: reviewView(f.workspace, f.resume.id, job.id),
    accepted: [], busy: false, run: async () => true,
  }));
  assert.match(html, /收件邮箱/);
  assert.match(html, /用当前简历正文准备邮件/);
  const view = await humanAction(f.workspace, {
    action: "prepare", resumeId: f.resume.id, jobId: job.id,
    recipient: "recruiting@example.com", keepOriginal: true, accepted: [],
  });
  assert.equal(view.kind, "application");
  assert.equal(view.application.recipient, "recruiting@example.com");
  assert.equal(view.application.jobId, job.id);
  assert.equal(f.store.get<typeof job>("job", job.id).recipient, undefined);

  const [batch] = workspaceView(f.workspace).mailBatches;
  const reopened = await restoreView(f.workspace, { action: "batch-view", id: batch.id });
  assert.equal(reopened?.kind === "batch" && reopened.batch.items[0].applicationId, view.application.id);
  assert.equal(f.sends(), 0);
});

test("侧栏查找直接产生岗位清单，空结果保留读取失败原因", async (t) => {
  const f = await setup(t);
  const tasks = new Tasks(f.workspace, async (url) => ({
    url,
    company: "检索公司",
    role: "数据分析师",
    jobDescription: "招聘数据分析师，工作地点杭州，使用 SQL 分析数据。",
    emails: [],
    links: [],
  }));
  const view = await humanAction(
    f.workspace,
    {
      action: "discover",
      goal: {
        resumeId: f.resume.id,
        directions: ["数据分析"],
        cities: ["杭州"],
        sources: ["https://example.com/jobs"],
      },
    },
    tasks,
  );
  assert.equal(view.kind, "goal");
  if (view.kind !== "goal") throw new Error("没有岗位清单");
  assert.equal(view.candidates.length, 1);
  assert.equal(view.candidates[0].job.role, "数据分析师");
  assert.equal(view.search?.status, "complete");
  const html = renderToStaticMarkup(createElement(SearchGoals, {
    data: workspaceView(f.workspace), resumeId: f.resume.id, busy: false, open: async () => true,
  }));
  assert.match(html, /查找匹配岗位/);
  assert.match(html, /打开目标/);
  assert.match(html, /数据分析/);
  const failed = await humanAction(
    f.workspace,
    {
      action: "discover",
      goal: {
        resumeId: f.resume.id,
        directions: ["设计师"],
        sources: ["https://example.com/jobs"],
      },
    },
    new Tasks(f.workspace, async () => {
      throw new Error("页面需要登录");
    }),
  );
  if (failed.kind !== "goal") throw new Error("没有读取结果");
  assert.equal(failed.candidates.length, 0);
  assert.match(failed.search!.sources[0].error!, /需要登录/);
  assert.equal(f.sends(), 0);
});

test("上传简历可读取正文，无邮箱可独立保存岗位版，更新 JD 不复用旧建议", async (t) => {
  const f = await setup(t);
  f.store.put("job", { ...f.job, recipient: undefined });
  const original = await humanAction(f.workspace, {
    action: "resume",
    id: f.resume.id,
  });
  assert.equal(original.kind, "resume");
  if (original.kind !== "resume") throw new Error("简历不可查看");
  assert.equal(original.resume.text, f.resume.text);
  assert.equal(original.resume.original, f.resume.original);
  const saved = await humanAction(f.workspace, {
    action: "save-version",
    resumeId: f.resume.id,
    jobId: f.job.id,
    proposalId: f.proposal.id,
    accepted: [],
  });
  if (saved.kind !== "resume") throw new Error("没有岗位版");
  assert.ok(saved.resume.pdf);
  assert.equal(saved.resume.parentId, f.resume.id);
  assert.equal(f.workspace.history().length, 0);
  const changed = await humanAction(f.workspace, {
    action: "update-jd",
    id: f.job.id,
    resumeId: f.resume.id,
    jd: "Go API 开发，额外负责自动化测试。",
  });
  if (changed.kind !== "review") throw new Error("没有新岗位上下文");
  assert.notEqual(changed.jobId, f.job.id);
  assert.equal(changed.proposal, undefined);
  await assert.rejects(
    humanAction(f.workspace, {
      action: "save-version",
      resumeId: f.resume.id,
      jobId: changed.jobId,
      proposalId: f.proposal.id,
      accepted: [],
    }),
    /不一致/,
  );
  const manual = await humanAction(f.workspace, {
    action: "save-resume",
    resumeId: f.resume.id,
    jobId: changed.jobId,
    text: f.resume.text + "\n参与接口联调。",
  });
  if (manual.kind !== "resume") throw new Error("未保存修改稿");
  assert.equal(manual.resume.jobId, changed.jobId);
  assert.equal(
    f.workspace.store.get<any>("resume", f.resume.id).text,
    f.resume.text,
  );
  assert.equal(f.sends(), 0);
});

test("批次展示读取当前投递状态，不能把已发或待核对邮件标成未发送", async (t) => {
  const f = await setup(t),
    tasks = new Tasks(f.workspace),
    goal = tasks.saveGoal({ resumeId: f.resume.id, directions: ["Go"] });
  const batch = await tasks.prepareBatch(goal.id, [
    { jobId: f.job.id, keepOriginal: true },
  ]);
  const application = f.workspace.preview(batch.items[0].applicationId!);
  for (const status of ["sent", "sending", "uncertain"] as const) {
    f.store.put("application", { ...application, status });
    assert.equal(
      (batchView(f.workspace, batch.id).batch.items[0] as any)
        .applicationStatus,
      status,
    );
  }
  assert.equal(f.sends(), 0);
});

test("首次恢复预览卡也读取当前状态，回退引用只允许查询", async (t) => {
  const f = await setup(t);
  const prepared = await humanAction(f.workspace, {
    action: "prepare",
    resumeId: f.resume.id,
    jobId: f.job.id,
    proposalId: f.proposal.id,
    accepted: [],
  });
  if (prepared.kind !== "application") throw new Error("未生成邮件");
  await f.workspace.execute(prepared.application.id, true);
  const view = await cardAction(f.workspace, "session-new", "preview-tool", {
    action: "restore",
    reference: { action: "application", id: prepared.application.id },
  });
  assert.equal(view?.kind, "application");
  if (view?.kind === "application")
    assert.equal(view.application.status, "simulated");
  await assert.rejects(
    cardAction(f.workspace, "session-new", "bad-reference", {
      action: "restore",
      reference: {
        action: "send",
        id: prepared.application.id,
        digest: prepared.application.digest,
        acknowledged: true,
        confirmation: "发送",
      },
    }),
    /查询/,
  );
  assert.equal(f.workspace.history().length, 1);
  assert.equal(f.sends(), 0);
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) AS n FROM approvals").get()!.n,
    0,
  );
});
test("卡片编辑后恢复新邮件，批次打开最新预览，且不创建发送确认", async (t) => {
  const f = await setup(t),
    tasks = new Tasks(f.workspace);
  const goal = tasks.saveGoal({ resumeId: f.resume.id, directions: ["Go"] });
  const batch = await tasks.prepareBatch(goal.id, [
    { jobId: f.job.id, keepOriginal: true },
  ]);
  const original = f.workspace.preview(batch.items[0].applicationId!);
  const view = await cardAction(f.workspace, "edit-session", "edit-card", {
    action: "revise",
    id: original.id,
    digest: original.digest,
    recipient: "edited@example.com",
    subject: "新主题",
    body: "新正文。",
  });
  assert.equal(view?.kind, "application");
  if (view?.kind !== "application") throw new Error("未返回新邮件");
  const restored = await cardAction(f.workspace, "edit-session", "edit-card", {
    action: "restore",
    reference: { action: "application", id: original.id },
  });
  if (restored?.kind !== "application") throw new Error("无法恢复新邮件");
  assert.equal(restored.application.id, view.application.id);
  assert.equal(restored.application.recipient, "edited@example.com");
  const snapshot = batchView(f.workspace, batch.id).batch.items[0];
  assert.equal(snapshot.applicationId, view.application.id);
  assert.equal(snapshot.applicationStatus, "prepared");
  assert.equal(f.sends(), 0);
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) AS n FROM approvals").get()!.n,
    0,
  );
  await assert.rejects(
    cardAction(f.workspace, "edit-session", "edit-card", {
      action: "revise",
      id: original.id,
      digest: original.digest,
      recipient: "stale@example.com",
      subject: "旧卡片",
      body: "不应生效。",
    }),
    /改变/,
  );
  const unchanged = await cardAction(f.workspace, "edit-session", "edit-card", {
    action: "restore",
  });
  assert.equal(
    unchanged?.kind === "application" && unchanged.application.id,
    view.application.id,
  );
});

test("DSH 原生工具与人类命令分离，输出核对 metadata；无发信权限时不能绕过", async (t) => {
  const f = await setup(t),
    tools = new Map<string, any>(),
    commands = new Map<string, any>(),
    disposers: Array<() => void> = [];
  let prompt: any;
  mount(
    {
      tools: {
        register: (d) => {
          tools.set(d.name, d);
          return () => tools.delete(d.name);
        },
      },
      commands: {
        register: (d) => {
          commands.set(d.name, d);
          return () => commands.delete(d.name);
        },
      },
      systemPrompt: {
        section: (d) => {
          prompt = d;
          return () => {};
        },
      },
      effect: (fn) => disposers.push(fn()),
    },
    f.workspace,
  );
  assert.equal(tools.size, 32);
  assert.equal(commands.size, 1);
  assert.ok(prompt.text.includes("核对卡"));
  assert.equal(
    [...tools.keys()].some((k) => k.includes("approve") || k.includes("send_")),
    false,
  );
  const review = tools.get("resume_grill_propose_resume_changes");
  const goal = new Tasks(f.workspace).saveGoal({
    resumeId: f.resume.id,
    directions: ["Go"],
  });
  const args = {
    resumeId: f.resume.id,
    jobId: f.job.id,
    plan: f.proposal.plan,
    goalId: goal.id,
  };
  const result = await review.execute(args, {
    signal: new AbortController().signal,
  });
  const meta = review.output.presentationMeta(args, result).resumeGrill;
  assert.equal(meta.kind, "review");
  assert.deepEqual(
    JSON.parse(JSON.stringify(meta)),
    meta,
    "卡片 metadata 必须能无损 JSON 序列化",
  );
  assert.equal(meta.proposal.id, result.id);
  assert.equal(meta.sourceText, f.resume.text);
  assert.equal(meta.goalId, goal.id);
  await assert.rejects(
    tools
      .get("resume_grill_execute_application")
      .execute(
        { id: "x", dryRun: false },
        { signal: new AbortController().signal },
      ),
    /不能代为批准/,
  );
  assert.equal(f.sends(), 0);
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) AS n FROM approvals").get()!.n,
    0,
  );
  const notices: any[] = [];
  const prepared = await commands.get("resume-grill").handler({
    rawInput: JSON.stringify({
      action: "prepare",
      resumeId: f.resume.id,
      jobId: f.job.id,
      proposalId: result.id,
      accepted: [],
    }),
    agent: {
      id: "session-command",
      inject: (message: unknown) => notices.push(message),
    },
    signal: new AbortController().signal,
  });
  assert.equal(prepared.kind, "success");
  assert.equal(notices.length, 1);
  assert.equal(notices[0].source.kind, "resume-grill");
  assert.equal(
    notices[0].source.plugin,
    undefined,
    "DSH v4 不接受旧 plugin 来源包装",
  );
  const invoke = (input: unknown) =>
    commands.get("resume-grill").handler({
      rawInput: JSON.stringify(input),
      agent: {
        id: "session-command",
        inject: (message: unknown) => notices.push(message),
      },
      signal: new AbortController().signal,
    });
  const id = JSON.parse(prepared.text).application.id;
  const restored = await invoke({
    surface: "workbench",
    action: "restore",
    reference: { action: "application", id },
  });
  assert.equal(restored.kind, "success");
  assert.equal(JSON.parse(restored.text).application.id, id);
  assert.equal((await invoke({ action: "application", id })).kind, "success");
  assert.equal(notices.length, 1, "读取邮件不向对话添加操作结果");
  const invalid = await invoke({
    surface: "workbench",
    action: "restore",
    reference: { action: "check", id },
  });
  assert.equal(invalid.kind, "error");
  assert.match(invalid.text, /恢复引用只能查询记录/);
  assert.equal(f.workspace.preview(id).status, "prepared");
  for (const dispose of disposers.reverse()) dispose();
  assert.equal(tools.size, 0);
  assert.equal(commands.size, 0);
});

test("对话卡片恢复真实记录，隔离会话，恢复不会创建审批或新投递", async (t) => {
  const f = await setup(t);
  const prepared = await cardAction(f.workspace, "session-a", "call-a", {
    action: "prepare",
    resumeId: f.resume.id,
    jobId: f.job.id,
    proposalId: f.proposal.id,
    accepted: [],
  });
  assert.equal(prepared?.kind, "application");
  if (prepared?.kind !== "application") return;
  const profileReference = {
    action: "profile",
    resumeId: f.resume.id,
  };
  await assert.rejects(
    cardAction(f.workspace, "session-a", "profile", {
      action: "restore",
      reference: profileReference,
    }),
    /重新解析/,
  );
  assert.equal(f.store.list("resume-profile").length, 0);
  const profile = await humanAction(f.workspace, profileReference);
  assert.deepEqual(
    await cardAction(f.workspace, "session-a", "profile", {
      action: "restore",
      reference: profileReference,
    }),
    profile,
  );
  const second = new Store(f.store.home);
  try {
    const resumed = await cardAction(
      new Workspace(second),
      "session-a",
      "call-a",
      { action: "restore" },
    );
    assert.equal(resumed?.kind, "application");
    if (resumed?.kind === "application")
      assert.equal(resumed.application.id, prepared.application.id);
    assert.equal(
      await cardAction(new Workspace(second), "session-b", "call-a", {
        action: "restore",
      }),
      null,
    );
    assert.equal(f.workspace.history().length, 1);
    assert.equal(f.sends(), 0);
    assert.equal(
      second.db.prepare("SELECT COUNT(*) AS n FROM approvals").get()!.n,
      0,
    );
  } finally {
    second.close();
  }
});

test("对话卡片按轮次与业务目标取最新建议，选择器不因其他事件重复发布", () => {
  const root = (callId: string, jobId: string) => ({
    callId,
    meta: { resumeGrill: { v: 1, kind: "review", resumeId: "resume", jobId } },
  });
  const old = root("old", "job-a"),
    latest = root("new", "job-a"),
    other = root("other", "job-b");
  const nodes = new Map<string, any>([
    ["a", { kind: "tool-call", data: { root: old } }],
    ["b", { kind: "tool-call", data: { root: latest } }],
    ["c", { kind: "tool-call", data: { root: other } }],
    ["d", { kind: "command" }],
  ]);
  const snapshot = {
    locations: {
      getTurn: (turn: number) => (turn === 1 ? ["a", "b", "c", "d"] : []),
    },
    nodes,
  };
  const select = turnCardSelector(1),
    first = select(snapshot);
  assert.deepEqual(first, [latest, other]);
  assert.equal(select(snapshot), first);
  assert.deepEqual(turnCardSelector(2)(snapshot), []);
});
test("DSH 卡片选择绑定建议，准备、附件检查、拒绝及确认发送共用服务", async (t) => {
  const f = await setup(t);
  const keys = [
    "RESUME_ALLOW_SEND",
    "RESUME_SMTP_ADDRESS",
    "RESUME_SMTP_CODE",
    "RESUME_SMTP_PROVIDER",
  ];
  const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const key of keys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  });
  process.env.RESUME_SMTP_ADDRESS = "test@example.com";
  process.env.RESUME_SMTP_CODE = "fake-test-code";
  process.env.RESUME_SMTP_PROVIDER = "qq";
  const prepared = await humanAction(f.workspace, {
    action: "prepare",
    resumeId: f.resume.id,
    jobId: f.job.id,
    proposalId: f.proposal.id,
    accepted: [
      `${f.proposal.plan.changes[0].sectionId}:${f.proposal.plan.changes[0].lineIndex}`,
    ],
  });
  assert.equal(prepared.kind, "application");
  if (prepared.kind !== "application") return;
  const again = await humanAction(f.workspace, {
    action: "prepare",
    resumeId: f.resume.id,
    jobId: f.job.id,
    proposalId: f.proposal.id,
    accepted: [
      `${f.proposal.plan.changes[0].sectionId}:${f.proposal.plan.changes[0].lineIndex}`,
    ],
  });
  assert.equal(f.workspace.history().length, 1);
  assert.equal(f.store.list("goal").length, 1);
  const a = prepared.application;
  await humanAction(f.workspace, { action: "check", id: a.id });
  assert.equal(f.sends(), 0);
  const send = {
    action: "send",
    id: a.id,
    digest: a.digest,
    acknowledged: true,
    confirmation: "发送",
  };
  process.env.RESUME_ALLOW_SEND = "0";
  await assert.rejects(humanAction(f.workspace, send), /未启用/);
  process.env.RESUME_ALLOW_SEND = "1";
  await assert.rejects(
    humanAction(f.workspace, { ...send, digest: "wrong" }),
    /内容或状态/,
  );
  await assert.rejects(
    humanAction(f.workspace, { ...send, acknowledged: false }),
  );
  assert.equal(f.sends(), 0);
  const sent = await humanAction(f.workspace, send);
  assert.equal(sent.kind, "application");
  if (sent.kind === "application")
    assert.equal(sent.application.status, "sent");
  assert.equal(f.sends(), 1);
  await assert.rejects(humanAction(f.workspace, send), /内容或状态/);
  assert.equal(f.sends(), 1);
  const replacement = f.workspace.propose(
    f.resume.id,
    f.job.id,
    f.proposal.plan,
  );
  await assert.rejects(
    humanAction(f.workspace, {
      action: "prepare",
      resumeId: f.resume.id,
      jobId: f.job.id,
      proposalId: f.proposal.id,
      accepted: [],
    }),
    /建议已更新/,
  );
});
