import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../../src/infrastructure/sqlite-store.js";
import { Workspace } from "../../src/core/workspace.js";
import { ResumeProfiles } from "../../src/core/resume-profiles.js";
import { FormRuns } from "../../src/core/form-runs.js";
test("自动计划只取已确认资料，检查真实回读、恢复进度并限制重试", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "form-run-test-")),
    store = new Store(home),
    ws = new Workspace(store);
  t.after(async () => {
    store.close();
    await rm(home, { recursive: true, force: true });
  });
  const resume = await ws.createResume(
    "简历.pdf",
    "姓名：演示用户\n手机：138-0000-0000\n教育背景\n甲大学 | 软件 2020.01 - 2024.01\n项目经历\n工具 | 开发 2024.02 - 至今\n开发页面。",
  );
  const profiles = new ResumeProfiles(ws),
    draft = profiles.draft(resume.id);
  profiles.confirm(draft.id, draft.data);
  const job = ws.addJob({
      company: "招聘公司",
      role: "开发",
      jd: "开发",
      sourceUrl: "https://example.com/job",
    }),
    runs = new FormRuns(ws),
    run = await runs.start(resume.id, job.id);
  assert.equal((await runs.start(resume.id, job.id)).id, run.id);
  const plan = await runs.plan(run.id, "https://example.com/apply", [
    { uid: "name", label: "姓名", type: "text", required: true },
    { uid: "phone", label: "手机", type: "text", value: "+86 13800000000" },
    { uid: "company", label: "公司名称", type: "text", required: true },
    { uid: "city", label: "期望城市", type: "text", required: true },
    { uid: "school", label: "学校", type: "text", value: "不同大学" },
    { uid: "consent", label: "同意声明", type: "checkbox", required: true },
  ]);
  assert.deepEqual(
    plan.actions.map((a) => [a.uid, a.value, a.write]),
    [
      ["name", "演示用户", true],
      ["phone", "13800000000", false],
    ],
  );
  assert.ok(plan.issues.find((i) => i.uid === "company"));
  assert.ok(plan.issues.find((i) => i.uid === "school"));
  const verified = await runs.verify(run.id, "https://example.com/apply", [
    { uid: "name", value: "演示用户" },
    { uid: "phone", value: "13800000000" },
  ]);
  assert.equal(verified.status, "needs_review");
  assert.equal(
    verified.checks.every((c) => c.status === "matched"),
    true,
  );
  const clean = await runs.plan(run.id, "https://example.com/apply", [
    { uid: "n2", label: "姓名", type: "text", required: true },
  ]);
  await runs.verify(run.id, "https://example.com/apply", [
    { uid: "n2", value: "" },
  ]);
  const repeat = await runs.verify(run.id, "https://example.com/apply", [
    { uid: "n2", value: "" },
  ]);
  assert.equal(
    repeat.checks[0].attempt,
    1,
    "同一轮回读重试不能重复计算填写失败",
  );
  await runs.plan(run.id, "https://example.com/apply", [
    { uid: "retry", label: "姓名", type: "text", required: true },
  ]);
  await runs.verify(run.id, "https://example.com/apply", [
    { uid: "retry", value: "" },
  ]);
  const stopped = await runs.plan(run.id, "https://example.com/apply", [
    { uid: "n3", label: "姓名", type: "text", required: true },
  ]);
  assert.equal(stopped.actions.length, 0);
  assert.match(stopped.issues[0].reason, /两次/);
  const file = { uid: "attachment", label: "上传简历", type: "file", required: true };
  assert.equal((await runs.plan(run.id, job.sourceUrl, [file])).uploads[0].write, true);
  const wrong = await runs.verify(run.id, job.sourceUrl, [], "其他附件.pdf");
  assert.equal(wrong.checks[0].status, "mismatch");
  assert.equal(wrong.checks[0].attempt, 1);
  assert.equal((await runs.verify(run.id, job.sourceUrl, [])).checks[0].attempt, 1);
  await runs.plan(run.id, job.sourceUrl, [file]);
  assert.equal((await runs.verify(run.id, job.sourceUrl, [])).checks[0].attempt, 2);
  const stoppedUpload = await runs.plan(run.id, job.sourceUrl, [file]);
  assert.equal(stoppedUpload.uploads.length, 0);
  assert.match(stoppedUpload.issues[0].reason, /附件.*两次/);
  const manualUpload = await runs.plan(run.id, job.sourceUrl, [
    { ...file, value: resume.name },
  ]);
  assert.equal(manualUpload.uploads[0].write, false);
  assert.equal((await runs.verify(run.id, job.sourceUrl, [], resume.name)).status, "ready");
  const other = new Store(home);
  try {
    assert.equal(
      (await new FormRuns(new Workspace(other)).start(resume.id, job.id)).id,
      run.id,
    );
  } finally {
    other.close();
  }
  const foreign = await runs.plan(run.id, "https://other.example/apply", []);
  assert.equal(foreign.actions.length, 0);
  assert.equal(foreign.status, "needs_review");
  const p = profiles.confirmed(resume.id);
  profiles.confirm(p.id, {
    ...p.data,
    contact: { ...p.data.contact, city: "杭州" },
  });
  await assert.rejects(
    runs.verify(run.id, "https://example.com/apply", []),
    /失效/,
  );
  assert.equal(ws.history().length, 0);
});
test("多段同类经历必须指定分组序号，回读不全不能标成已核对", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "form-run-multi-")),
    store = new Store(home),
    ws = new Workspace(store);
  t.after(async () => {
    store.close();
    await rm(home, { recursive: true, force: true });
  });
  const r = await ws.createResume(
    "简历",
    "姓名：测试用户\n教育背景\n甲大学 | 计算机 2020.01 - 2024.01\n乙大学 | 软件 2024.02 - 至今",
  );
  const profiles = new ResumeProfiles(ws),
    p = profiles.draft(r.id);
  profiles.confirm(p.id, p.data);
  const j = ws.addJob({
      company: "公司",
      role: "开发",
      jd: "开发",
      sourceUrl: "https://example.com/job",
    }),
    runs = new FormRuns(ws),
    run = await runs.start(r.id, j.id);
  let plan = await runs.plan(run.id, j.sourceUrl, [
    { uid: "a", label: "学校", type: "text", required: true },
  ]);
  assert.equal(plan.actions.length, 0);
  plan = await runs.plan(run.id, j.sourceUrl, [
    {
      uid: "b",
      label: "学校",
      type: "text",
      group: "education",
      index: 1,
      required: true,
    },
  ]);
  assert.equal(plan.actions[0].value, "乙大学");
  assert.equal(
    (await runs.verify(run.id, j.sourceUrl, [])).status,
    "needs_input",
  );
  assert.equal(
    (await runs.verify(run.id, j.sourceUrl, [{ uid: "b", value: "乙大学" }]))
      .status,
    "ready",
  );
  assert.equal(ws.history().length, 0);
});
