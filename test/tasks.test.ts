import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/store.js";
import { Workspace } from "../src/service.js";
import { Tasks } from "../src/tasks.js";
import {
  extractCareerEmails,
  isPublicAddress,
  readCareerPage,
} from "../src/careers/public-page.js";

async function setup(t: any) {
  const home = await mkdtemp(join(tmpdir(), "resume-task-test-"));
  const store = new Store(home),
    workspace = new Workspace(store);
  t.after(async () => {
    store.close();
    if (
      dirname(home) === tmpdir() &&
      basename(home).startsWith("resume-task-test-")
    )
      await rm(home, { recursive: true, force: true, maxRetries: 5 });
  });
  const path = join(home, "resume.txt");
  await writeFile(path, "测试用户\n项目经历\n- 负责 Go API 开发与测试。");
  const resume = await workspace.importResume(path);
  return { store, workspace, resume };
}
const page = (
  role: string,
  company = "公司甲",
  email = "hr@example.com",
  jd = "杭州，负责 Go API 开发与测试。",
) =>
  extractCareerEmails(
    `<html><title>${company}</title><script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", title: role, hiringOrganization: { name: company }, description: jd })}</script><h1>${role}</h1><p>招聘邮箱：<a href="mailto:${email}">${email}</a></p></html>`,
    "https://example.com/jobs/1",
  );

test("真实 HTML 提取按全栈别名筛选，排除条件及来源失败可追溯", async (t) => {
  const f = await setup(t);
  let reads = 0;
  const tasks = new Tasks(f.workspace, async (url) => {
    reads++;
    if (url.includes("failed")) throw new Error("source timed out");
    const result = page("Full Stack Developer");
    return { ...result, url };
  });
  const goal = tasks.saveGoal({
    resumeId: f.resume.id,
    directions: ["全栈"],
    cities: ["杭州"],
    sources: ["https://example.com/jobs/1", "https://failed.example/jobs"],
  });
  const run = await tasks.discover(goal.id);
  assert.equal(reads, 2);
  assert.equal(run.candidates.length, 1);
  assert.equal(run.candidates[0].locationVerified, true);
  assert.equal(run.sources[1].status, "failed");
  assert.match(run.sources[1].error!, /timed out/);
  const excluded = tasks.saveGoal({
    resumeId: f.resume.id,
    directions: ["全栈"],
    exclude: ["公司甲"],
    sources: ["https://example.com/jobs/1"],
  });
  assert.equal((await tasks.discover(excluded.id)).candidates.length, 0);
});

test("缺失邮箱、城市或修改核对逐项阻塞，合法岗位一次准备，重复请求不新增", async (t) => {
  const f = await setup(t),
    tasks = new Tasks(f.workspace);
  const goal = tasks.saveGoal({
    resumeId: f.resume.id,
    directions: ["Go"],
    cities: ["杭州"],
  });
  const base = {
    company: "公司甲",
    role: "Go 开发",
    jd: "杭州负责 Go API 开发与测试。",
  };
  const valid = f.workspace.addJob({
    ...base,
    sourceUrl: "https://example.com/good",
    recipient: "hr@example.com",
  });
  const noEmail = f.workspace.addJob({
    ...base,
    sourceUrl: "https://example.com/no-email",
  });
  const noCity = f.workspace.addJob({
    ...base,
    jd: "负责 Go API 开发与测试。",
    sourceUrl: "https://example.com/no-city",
    recipient: "hr@example.com",
  });
  const needsReview = f.workspace.addJob({
    ...base,
    sourceUrl: "https://example.com/review",
    recipient: "hr@example.com",
  });
  const choices = [
    { jobId: valid.id, keepOriginal: true },
    { jobId: noEmail.id, keepOriginal: true },
    { jobId: noCity.id, keepOriginal: true },
    { jobId: needsReview.id },
  ];
  const batch = await tasks.prepareBatch(goal.id, choices);
  assert.deepEqual(
    batch.items.map((i) => i.status),
    ["prepared", "blocked", "blocked", "blocked"],
  );
  assert.equal(batch.status, "needs_input");
  assert.match(batch.items[1].reason!, /邮箱/);
  assert.match(batch.items[2].reason!, /城市/);
  assert.match(batch.items[3].reason!, /修改建议/);
  assert.equal(f.workspace.history().length, 1);
  assert.equal(f.workspace.history()[0].status, "prepared");
  const again = await tasks.prepareBatch(goal.id, choices);
  assert.equal(again.id, batch.id);
  assert.equal(f.workspace.history().length, 1);
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) AS n FROM approvals").get()!.n,
    0,
  );
});

test("不同岗位的建议不可混用，已提交和待核对记录不重复准备", async (t) => {
  const f = await setup(t),
    tasks = new Tasks(f.workspace);
  const goal = tasks.saveGoal({ resumeId: f.resume.id, directions: ["Go"] });
  const job = f.workspace.addJob({
    company: "公司甲",
    role: "Go",
    jd: "Go",
    sourceUrl: "https://example.com/1",
    recipient: "hr@example.com",
  });
  const other = f.workspace.addJob({
    company: "公司乙",
    role: "Go",
    jd: "Go",
    sourceUrl: "https://example.com/2",
    recipient: "hr@example.com",
  });
  const sections = f.workspace.reviewContext(f.resume.id, other.id).sections;
  const proposal = f.workspace.propose(f.resume.id, other.id, {
    company: "",
    role: "",
    sectionOrder: sections.map((s) => s.id),
    changes: [],
    highlights: [],
    gaps: [],
  });
  const invalid = await tasks.prepareBatch(goal.id, [
    { jobId: job.id, proposalId: proposal.id },
  ]);
  assert.match(invalid.items[0].reason!, /不一致/);
  const batch = await tasks.prepareBatch(goal.id, [
    { jobId: job.id, keepOriginal: true },
  ]);
  const a = f.workspace.preview(batch.items[0].applicationId!);
  f.store.put("application", { ...a, status: "uncertain" });
  assert.equal(
    tasks.candidates(goal.id).some((c) => c.job.id === job.id),
    false,
  );
  const duplicate = await tasks.prepareBatch(goal.id, [
    { jobId: job.id, keepOriginal: true, accepted: [] },
  ]);
  assert.equal(duplicate.items[0].applicationId, a.id);
});

test("网页读取拒绝内网地址，非法来源不能保存到求职目标", async (t) => {
  const f = await setup(t),
    tasks = new Tasks(f.workspace);
  for (const address of ["127.0.0.1", "10.0.0.1", "::1", "169.254.169.254"])
    assert.equal(isPublicAddress(address), false);
  await assert.rejects(readCareerPage("https://127.0.0.1/jobs"), /公网地址/);
  assert.throws(() =>
    tasks.saveGoal({
      resumeId: f.resume.id,
      directions: ["设计"],
      sources: ["http://example.com/jobs"],
    }),
  );
  assert.throws(() =>
    tasks.saveGoal({ resumeId: "missing", directions: ["设计"] }),
  );
});

test("同一招聘页的不同岗位分别保存，来源上限不隐藏未读取项目", async (t) => {
  const f = await setup(t);
  const base = {
    company: "公司甲",
    jd: "负责 Go API 开发与测试。",
    sourceUrl: "https://example.com/jobs",
    recipient: "hr@example.com",
  };
  const first = f.workspace.addJob({ ...base, role: "Go 开发" }),
    second = f.workspace.addJob({ ...base, role: "Go 测试开发" });
  assert.notEqual(first.id, second.id);
  const tasks = new Tasks(f.workspace, async (url) => ({
    ...page("Go 开发"),
    url,
  }));
  const goal = tasks.saveGoal({
    resumeId: f.resume.id,
    directions: ["Go"],
    sources: Array.from(
      { length: 7 },
      (_, i) => `https://example.com/jobs/${i}`,
    ),
    limit: 20,
  });
  const run = await tasks.discover(goal.id);
  assert.equal(run.sources.length, 7);
  assert.equal(
    run.sources.filter((source) => source.status === "read").length,
    6,
  );
  assert.equal(run.sources[6].status, "pending");
  assert.equal(run.status, "partial");
});

test("复用已生成 PDF 也不接受不存在的修改键", async (t) => {
  const f = await setup(t),
    tasks = new Tasks(f.workspace);
  const goal = tasks.saveGoal({ resumeId: f.resume.id, directions: ["Go"] });
  const job = f.workspace.addJob({
    company: "公司甲",
    role: "Go",
    jd: "负责 Go API 开发与测试。",
    sourceUrl: "https://example.com/job",
    recipient: "hr@example.com",
  });
  const sections = f.workspace.reviewContext(f.resume.id, job.id).sections;
  const proposal = f.workspace.propose(f.resume.id, job.id, {
    company: "",
    role: "",
    sectionOrder: sections.map((s) => s.id),
    changes: [],
    highlights: [],
    gaps: [],
  });
  const good = await tasks.prepareBatch(goal.id, [
    { jobId: job.id, proposalId: proposal.id },
  ]);
  assert.equal(good.items[0].status, "prepared");
  const bad = await tasks.prepareBatch(goal.id, [
    { jobId: job.id, proposalId: proposal.id, accepted: ["section-0:999"] },
  ]);
  assert.equal(bad.items[0].status, "blocked");
  assert.match(bad.items[0].reason!, /接受项/);
  assert.equal(f.workspace.history().length, 1);
});
