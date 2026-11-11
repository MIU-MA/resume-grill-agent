import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { Store } from "../../src/infrastructure/sqlite-store.js";
import { Workspace } from "../../src/core/workspace.js";
import { startPanel } from "../../src/adapters/panel/server.js";

test("React 面板 API：来源校验、共享建议、PDF、冻结预览、确认后发送及记录", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "resume-panel-test-"));
  const store = new Store(home);
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
  const panel = await startPanel(workspace, 0);
  const url = new URL(panel.url);
  const token = url.hash.slice(1);
  const origin = url.origin;
  t.after(async () => {
    await panel.close();
    store.close();
    if (
      dirname(home) === tmpdir() &&
      basename(home).startsWith("resume-panel-test-")
    )
      await rm(home, { recursive: true, force: true, maxRetries: 5 });
  });
  const session = await fetch(`${origin}/api/session`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const cookie = session.headers.get("set-cookie")!.split(";")[0];
  assert.match(session.headers.get("set-cookie")!, /HttpOnly/);
  const request = async (path: string, input?: unknown) =>
    fetch(`${origin}/api/${path}`, {
      headers: {
        Cookie: cookie,
        ...(input === undefined
          ? {}
          : { Origin: origin, "Content-Type": "application/json" }),
      },
      ...(input === undefined
        ? {}
        : { method: "POST", body: JSON.stringify(input) }),
    });
  assert.equal((await fetch(`${origin}/api/workspace`)).status, 401);
  assert.equal(
    (
      await fetch(`${origin}/api/send`, {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: "https://evil.example",
          "Content-Type": "application/json",
        },
        body: "{}",
      })
    ).status,
    403,
  );
  const doc = await (
    await request("import", {
      name: "演示.txt",
      base64: Buffer.from(
        "演示用户\n项目经历\n- 负责 Go API 开发与测试。",
      ).toString("base64"),
    })
  ).json();
  const job = await (
    await request("jobs", {
      company: "示例公司",
      role: "Go",
      jd: "示例公司招聘 Go，负责 Go API 开发与测试。",
      sourceUrl: "https://example.com/job",
      recipient: "hr@example.com",
    })
  ).json();
  const context = workspace.reviewContext(doc.id, job.id);
  const section = context.sections.find((s) =>
    s.lines.some((line) => line.includes("Go")),
  )!;
  const index = section.lines.findIndex((line) => line.includes("Go"));
  const plan = {
    company: job.company,
    role: job.role,
    sectionOrder: context.sections.map((s) => s.id),
    changes: [
      {
        sectionId: section.id,
        lineIndex: index,
        after: "- 负责 Go API 开发，参与测试。",
        requirement: "Go API 开发与测试",
        reason: "写清测试工作。",
      },
    ],
    highlights: [],
    gaps: [],
  };
  workspace.propose(doc.id, job.id, plan);
  const state = await (await request("workspace")).json();
  assert.equal(state.proposals.length, 1);
  const version = await (
    await request("version", {
      resumeId: doc.id,
      jobId: job.id,
      plan,
      accepted: [`${section.id}:${index}`],
    })
  ).json();
  const pdf = await request(`pdf/${version.id}`);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.match(
    Buffer.from(await pdf.arrayBuffer()).toString("ascii", 0, 5),
    /^%PDF-/,
  );
  const draft = await (
    await request("prepare", {
      jobId: job.id,
      resumeId: version.id,
      recipient: "hr@example.com",
      subject: "应聘",
      body: "正文",
    })
  ).json();
  assert.equal(
    (await (await request("check", { id: draft.id })).json()).status,
    "simulated",
  );
  assert.equal(sends, 0);
  const old = Object.fromEntries(
    [
      "RESUME_ALLOW_SEND",
      "RESUME_SMTP_ADDRESS",
      "RESUME_SMTP_CODE",
      "RESUME_SMTP_PROVIDER",
    ].map((k) => [k, process.env[k]]),
  );
  try {
    delete process.env.RESUME_ALLOW_SEND;
    assert.equal(
      (
        await request("send", {
          id: draft.id,
          digest: draft.digest,
          acknowledged: true,
          confirmation: "发送",
        })
      ).status,
      400,
    );
    process.env.RESUME_ALLOW_SEND = "1";
    process.env.RESUME_SMTP_ADDRESS = "sender@example.com";
    process.env.RESUME_SMTP_CODE = "secret-test-value";
    process.env.RESUME_SMTP_PROVIDER = "unsupported";
    assert.equal(
      (await (await request("workspace")).json()).sendingEnabled,
      false,
    );
    assert.equal(
      (
        await request("send", {
          id: draft.id,
          digest: draft.digest,
          acknowledged: true,
          confirmation: "发送",
        })
      ).status,
      400,
    );
    assert.equal(sends, 0);
    assert.equal(workspace.preview(draft.id).status, "simulated");
    assert.equal(
      store.db.prepare("SELECT COUNT(*) AS n FROM approvals").get()!.n,
      0,
    );
    process.env.RESUME_SMTP_PROVIDER = "qq";
    assert.equal(
      (
        await request("send", {
          id: draft.id,
          digest: "wrong",
          acknowledged: true,
          confirmation: "发送",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request("send", {
          id: draft.id,
          digest: draft.digest,
          acknowledged: false,
          confirmation: "发送",
        })
      ).status,
      400,
    );
    assert.equal(sends, 0);
    assert.equal(
      (
        await (
          await request("send", {
            id: draft.id,
            digest: draft.digest,
            acknowledged: true,
            confirmation: "发送",
          })
        ).json()
      ).status,
      "sent",
    );
    assert.equal(sends, 1);
    assert.equal(
      (
        await request("send", {
          id: draft.id,
          digest: draft.digest,
          acknowledged: true,
          confirmation: "发送",
        })
      ).status,
      400,
    );
    assert.equal(sends, 1);
    const text = await (await request("workspace")).text();
    assert.ok(!text.includes("secret-test-value"));
    assert.match(text, /250 test/);
  } finally {
    for (const [k, v] of Object.entries(old))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  }
  const html = await fetch(origin);
  assert.equal(html.status, 200);
  assert.match(await html.text(), /app.js/);
  assert.equal((await fetch(`${origin}/app.js`)).status, 200);
});
