import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { Store } from "../../src/infrastructure/sqlite-store.js";
import { Workspace } from "../../src/core/workspace.js";
import { renderPdf, readResume } from "../../src/infrastructure/documents.js";

test("SMTP 回执随投递记录持久化，重开存储仍可查询", async (t) => {
  const receipt = {
    accepted: ["hr@example.com"],
    response: "250 queued test-receipt",
    messageId: "<test@example.com>",
    acceptedAt: Date.now(),
  };
  const f = await fixture(t, async () => receipt);
  const previous = process.env.RESUME_ALLOW_SEND;
  process.env.RESUME_ALLOW_SEND = "1";
  try {
    f.workspace.approve(f.application.id, f.application.digest);
    assert.deepEqual(
      (await f.workspace.execute(f.application.id, false)).receipt,
      receipt,
    );
    const second = new Store(f.home);
    try {
      assert.deepEqual(new Workspace(second).history()[0].receipt, receipt);
    } finally {
      second.close();
    }
  } finally {
    if (previous === undefined) delete process.env.RESUME_ALLOW_SEND;
    else process.env.RESUME_ALLOW_SEND = previous;
  }
});

test("并行准备相同内容只生成一条投递记录", async (t) => {
  const f = await fixture(t);
  const results = await Promise.all(
    Array.from({ length: 3 }, () =>
      f.workspace.prepare(
        f.job.id,
        f.version.id,
        "hr@example.com",
        "新主题",
        "相同正文",
      ),
    ),
  );
  assert.equal(new Set(results.map((item) => item.id)).size, 1);
  assert.equal(
    f.workspace.history().filter((item) => item.subject === "新主题").length,
    1,
  );
});

test("修改邮件冻结新预览，沿用原附件，旧确认及旧预览不能发送", async (t) => {
  let sent = 0;
  const f = await fixture(t, async () => {
    sent++;
  });
  const original = f.application,
    bytes = await readFile(original.attachment);
  f.workspace.approve(original.id, original.digest);
  // The source PDF can change after preparation; editing must use the frozen copy.
  await writeFile(f.version.pdf!, "changed source");
  const revised = await f.workspace.reviseApplication(
    original.id,
    original.digest,
    {
      recipient: "recruit@example.com",
      subject: "修改后的主题",
      body: "修改后的正文。",
    },
  );
  assert.notEqual(revised.id, original.id);
  assert.notEqual(revised.digest, original.digest);
  assert.equal(revised.revisedFrom, original.id);
  assert.equal(revised.attachmentHash, original.attachmentHash);
  assert.deepEqual(await readFile(revised.attachment), bytes);
  assert.equal(f.workspace.preview(original.id).body, original.body);
  assert.equal(f.workspace.preview(original.id).status, "superseded");
  assert.equal(f.workspace.latestApplication(original.id).id, revised.id);
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) AS n FROM approvals").get()!.n,
    0,
  );
  assert.throws(
    () => f.workspace.approve(original.id, original.digest),
    /改变/,
  );
  await assert.rejects(f.workspace.execute(original.id, false), /重复发送/);
  const previous = process.env.RESUME_ALLOW_SEND;
  process.env.RESUME_ALLOW_SEND = "1";
  try {
    await assert.rejects(f.workspace.execute(revised.id, false), /确认/);
    assert.equal(sent, 0);
    f.workspace.approve(revised.id, revised.digest);
    assert.equal((await f.workspace.execute(revised.id, false)).status, "sent");
    assert.equal(sent, 1);
  } finally {
    if (previous === undefined) delete process.env.RESUME_ALLOW_SEND;
    else process.env.RESUME_ALLOW_SEND = previous;
  }
});

test("保存未改邮件不创建记录，错误摘要、空正文、换行主题及已执行邮件被拒绝", async (t) => {
  const f = await fixture(t),
    original = f.application;
  const mail = {
    recipient: original.recipient,
    subject: original.subject,
    body: original.body,
  };
  assert.equal(
    (await f.workspace.reviseApplication(original.id, original.digest, mail))
      .id,
    original.id,
  );
  await assert.rejects(
    f.workspace.reviseApplication(original.id, "stale", mail),
    /改变/,
  );
  for (const change of [
    { body: "   " },
    { subject: "Hi\r\nBcc: bad@example.com" },
    { recipient: "not an email" },
  ])
    await assert.rejects(
      f.workspace.reviseApplication(original.id, original.digest, {
        ...mail,
        ...change,
      }),
    );
  for (const status of ["sending", "sent", "uncertain"] as const) {
    f.store.put("application", { ...original, status });
    await assert.rejects(
      f.workspace.reviseApplication(original.id, original.digest, {
        ...mail,
        body: "新正文",
      }),
      /改变/,
    );
  }
  assert.equal(f.workspace.history().length, 1);
});

test("并发编辑只有一个结果生效，回改原文也生成可追溯的新预览", async (t) => {
  const f = await fixture(t),
    original = f.application;
  const mail = {
    recipient: original.recipient,
    subject: original.subject,
    body: "新的正文",
  };
  const results = await Promise.allSettled([
    f.workspace.reviseApplication(original.id, original.digest, mail),
    f.workspace.reviseApplication(original.id, original.digest, {
      ...mail,
      body: "另一个正文",
    }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  const winner = f.workspace.latestApplication(original.id);
  const reverted = await f.workspace.reviseApplication(
    winner.id,
    winner.digest,
    {
      recipient: original.recipient,
      subject: original.subject,
      body: original.body,
    },
  );
  assert.equal(reverted.status, "prepared");
  assert.notEqual(reverted.id, original.id);
  assert.equal(f.workspace.latestApplication(original.id).id, reverted.id);
  assert.equal(f.workspace.history().length, 3);
  const second = new Store(f.home);
  try {
    assert.equal(
      new Workspace(second).latestApplication(original.id).id,
      reverted.id,
    );
  } finally {
    second.close();
  }
});

test("修改与发送并发时，只有一方可以生效", async (t) => {
  let sent = 0;
  const f = await fixture(t, async () => {
    sent++;
  });
  const original = f.application;
  const previous = process.env.RESUME_ALLOW_SEND;
  process.env.RESUME_ALLOW_SEND = "1";
  f.workspace.approve(original.id, original.digest);
  try {
    const [edit, send] = await Promise.allSettled([
      f.workspace.reviseApplication(original.id, original.digest, {
        recipient: original.recipient,
        subject: original.subject,
        body: "并发修改。",
      }),
      f.workspace.execute(original.id, false),
    ]);
    assert.equal(
      [edit, send].filter((result) => result.status === "fulfilled").length,
      1,
    );
    if (edit.status === "fulfilled") {
      assert.equal(sent, 0);
      assert.equal(f.workspace.preview(original.id).status, "superseded");
      assert.equal(edit.value.status, "prepared");
    } else {
      assert.equal(sent, 1);
      assert.equal(f.workspace.preview(original.id).status, "sent");
      assert.equal(f.workspace.history().length, 1);
    }
  } finally {
    if (previous === undefined) delete process.env.RESUME_ALLOW_SEND;
    else process.env.RESUME_ALLOW_SEND = previous;
  }
});

test("冻结附件损坏时不能通过编辑生成新预览", async (t) => {
  const f = await fixture(t),
    original = f.application;
  await writeFile(original.attachment, "broken PDF");
  await assert.rejects(
    f.workspace.reviseApplication(original.id, original.digest, {
      recipient: original.recipient,
      subject: original.subject,
      body: "新正文",
    }),
    /附件校验/,
  );
  assert.equal(f.workspace.history().length, 1);
});

async function fixture(t: any, sender?: any) {
  const home = await mkdtemp(join(tmpdir(), "resume-agent-test-"));
  const store = new Store(home),
    workspace = new Workspace(store, sender);
  t.after(async () => {
    store.close();
    if (
      dirname(home) === tmpdir() &&
      basename(home).startsWith("resume-agent-test-")
    )
      await rm(home, { recursive: true, force: true, maxRetries: 3 });
  });
  const path = join(home, "source.txt");
  await writeFile(path, "张三\n项目经历\n- 负责 Go API 开发与测试。");
  const resume = await workspace.importResume(path);
  const job = workspace.addJob({
    company: "示例公司",
    role: "Go 开发",
    jd: "示例公司招聘 Go 开发，负责 Go API 开发与测试。",
    sourceUrl: "https://example.com/jobs/1",
    recipient: "hr@example.com",
  });
  const context = workspace.reviewContext(resume.id, job.id);
  const section = context.sections.find((section) =>
    section.lines.some((line) => line.includes("Go")),
  )!;
  const lineIndex = section.lines.findIndex((line) => line.includes("Go"));
  const key = `${section.id}:${lineIndex}`;
  const plan = {
    company: job.company,
    role: job.role,
    sectionOrder: context.sections.map((section) => section.id),
    changes: [
      {
        sectionId: section.id,
        lineIndex,
        after: "- 负责 Go API 开发，参与测试。",
        requirement: "Go API 开发与测试",
        reason: "写清开发与测试工作。",
      },
    ],
    highlights: [],
    gaps: [],
  };
  const version = await workspace.saveVersion(resume.id, job.id, plan, [key]);
  const application = await workspace.prepare(
    job.id,
    version.id,
    "hr@example.com",
    "应聘 Go 开发",
    "您好，附件是简历。",
  );
  return {
    home,
    store,
    workspace,
    resume,
    job,
    version,
    application,
    plan,
    key,
  };
}

test("完整链路生成可读中文 PDF，模拟投递与重启查询保留附件快照", async (t) => {
  let sent = 0;
  const f = await fixture(t, async () => {
    sent++;
  });
  const original = await readFile(f.resume.original);
  const extracted = await readResume(f.version.pdf!);
  assert.match(extracted.text, /Go/);
  assert.match(extracted.text, /负责/);
  assert.equal(
    (await f.workspace.execute(f.application.id)).status,
    "simulated",
  );
  assert.equal(sent, 0);
  assert.deepEqual(await readFile(f.resume.original), original);
  const again = await f.workspace.prepare(
    f.job.id,
    f.version.id,
    "hr@example.com",
    "应聘 Go 开发",
    "您好，附件是简历。",
  );
  assert.equal(again.id, f.application.id);
  const secondStore = new Store(f.home);
  try {
    assert.equal(new Workspace(secondStore).history()[0].status, "simulated");
  } finally {
    secondStore.close();
  }
});

test("新增技能、未知接受项与跨岗位附件会被拒绝", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.workspace.saveVersion(
      f.resume.id,
      f.job.id,
      {
        ...f.plan,
        changes: [{ ...f.plan.changes[0], after: "负责 Rust API 开发" }],
      },
      [f.key],
    ),
  );
  await assert.rejects(
    f.workspace.saveVersion(f.resume.id, f.job.id, f.plan, ["missing:100"]),
  );
  const other = f.workspace.addJob({
    company: "另一家公司",
    role: "Go",
    jd: "Go",
    sourceUrl: "https://example.com/jobs/2",
  });
  await assert.rejects(
    f.workspace.prepare(
      other.id,
      f.version.id,
      "hr@example.com",
      "求职",
      "正文",
    ),
  );
});

test("确认绑定摘要、单次消耗；其他进程打开存储不会重置执行状态", async (t) => {
  let sent = 0,
    finish!: () => void;
  const f = await fixture(t, async () => {
    sent++;
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  const previous = process.env.RESUME_ALLOW_SEND;
  process.env.RESUME_ALLOW_SEND = "1";
  try {
    await assert.rejects(f.workspace.execute(f.application.id, false), /确认/);
    assert.throws(() => f.workspace.approve(f.application.id, "wrong"), /改变/);
    f.workspace.approve(f.application.id, f.application.digest);
    const sending = f.workspace.execute(f.application.id, false);
    while (!finish) await new Promise((resolve) => setTimeout(resolve, 5));
    const secondStore = new Store(f.home);
    try {
      const second = new Workspace(secondStore);
      assert.equal(second.preview(f.application.id).status, "sending");
      await assert.rejects(second.execute(f.application.id), /重复发送/);
    } finally {
      secondStore.close();
    }
    finish();
    assert.equal((await sending).status, "sent");
    await assert.rejects(
      f.workspace.execute(f.application.id, false),
      /重复发送/,
    );
    assert.equal(sent, 1);
  } finally {
    if (previous === undefined) delete process.env.RESUME_ALLOW_SEND;
    else process.env.RESUME_ALLOW_SEND = previous;
  }
});

test("SMTP 结果不明确时保留记录并阻止重发", async (t) => {
  const f = await fixture(t, async () => {
    throw new Error("connection lost after DATA");
  });
  const previous = process.env.RESUME_ALLOW_SEND;
  process.env.RESUME_ALLOW_SEND = "1";
  try {
    f.workspace.approve(f.application.id, f.application.digest);
    assert.equal(
      (await f.workspace.execute(f.application.id, false)).status,
      "uncertain",
    );
    await assert.rejects(f.workspace.execute(f.application.id, false));
    assert.equal(f.workspace.history()[0].events.at(-1)?.type, "uncertain");
  } finally {
    if (previous === undefined) delete process.env.RESUME_ALLOW_SEND;
    else process.env.RESUME_ALLOW_SEND = previous;
  }
});

test("附件被改变或确认过期时，发送函数完全不会调用", async (t) => {
  let sent = 0;
  const f = await fixture(t, async () => {
    sent++;
  });
  const previous = process.env.RESUME_ALLOW_SEND;
  process.env.RESUME_ALLOW_SEND = "1";
  try {
    f.workspace.approve(f.application.id, f.application.digest);
    f.store.db.prepare("UPDATE approvals SET expires=0").run();
    await assert.rejects(f.workspace.execute(f.application.id, false), /过期/);
    await writeFile(f.application.attachment, "changed");
    await assert.rejects(f.workspace.execute(f.application.id), /附件校验/);
    assert.equal(sent, 0);
  } finally {
    if (previous === undefined) delete process.env.RESUME_ALLOW_SEND;
    else process.env.RESUME_ALLOW_SEND = previous;
  }
});
