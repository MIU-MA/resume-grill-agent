import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/store.js";
import { Workspace } from "../src/service.js";
import { mount } from "../src/dsh/host.js";
import { humanAction, cardAction } from "../src/dsh/actions.js";
import { turnCardSelector } from "../src/dsh/card-model.js";

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
  assert.equal(tools.size, 14);
  assert.equal(commands.size, 1);
  assert.ok(prompt.text.includes("核对卡"));
  assert.equal(
    [...tools.keys()].some((k) => k.includes("approve") || k.includes("send_")),
    false,
  );
  const review = tools.get("resume_grill_propose_resume_changes");
  const args = {
    resumeId: f.resume.id,
    jobId: f.job.id,
    plan: f.proposal.plan,
  };
  const result = await review.execute(args, {
    signal: new AbortController().signal,
  });
  const meta = review.output.presentationMeta(args, result).resumeGrill;
  assert.equal(meta.kind, "review");
  assert.equal(meta.proposal.id, result.id);
  assert.equal(meta.sourceText, f.resume.text);
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
