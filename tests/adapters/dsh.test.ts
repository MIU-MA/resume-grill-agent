import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../../src/infrastructure/sqlite-store.js";
import { Workspace } from "../../src/core/workspace.js";
import { mount } from "../../src/adapters/dsh/host.js";
import { humanAction, cardAction } from "../../src/adapters/dsh/actions.js";
import { turnCardSelector } from "../../src/adapters/dsh/card-model.js";
import { Tasks } from "../../src/core/tasks.js";
import { batchView } from "../../src/adapters/dsh/views.js";

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
  assert.equal((view as any).goalId, goal.id);
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
  assert.equal(tools.size, 17);
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
    rawInput: JSON.stringify({action: "prepare", resumeId: f.resume.id, jobId: f.job.id, proposalId: result.id, accepted: []}),
    agent: {id: "session-command", inject: (message: unknown) => notices.push(message)},
    signal: new AbortController().signal,
  });
  assert.equal(prepared.kind, "success");
  assert.equal(notices.length, 1);
  assert.equal(notices[0].source.kind, "resume-grill");
  assert.equal(notices[0].source.plugin, undefined, "DSH v4 不接受旧 plugin 来源包装");
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
