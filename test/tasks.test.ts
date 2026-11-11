import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
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

test("临时文件错误修复后可重试失败批次，并复用原批次编号", async (t) => {
  const f = await setup(t),
    tasks = new Tasks(f.workspace);
  const goal = tasks.saveGoal({ resumeId: f.resume.id, directions: ["Go"] });
  const job = f.workspace.addJob({
    company: "演示",
    role: "Go",
    jd: "负责 Go API 开发与测试。",
    sourceUrl: "https://example.com/retry",
    recipient: "hr@example.com",
  });
  const sections = f.workspace.reviewContext(f.resume.id, job.id).sections;
  const version = await f.workspace.saveVersion(
    f.resume.id,
    job.id,
    {
      company: "",
      role: "",
      sectionOrder: sections.map((s) => s.id),
      changes: [],
      highlights: [],
      gaps: [],
    },
    [],
  );
  const bytes = await readFile(version.pdf!);
  await rm(version.pdf!);
  const failed = await tasks.prepareBatch(goal.id, [
    { jobId: job.id, keepOriginal: true },
  ]);
  assert.equal(failed.items[0].status, "blocked");
  await writeFile(version.pdf!, bytes);
  const retry = await tasks.prepareBatch(goal.id, [
    { jobId: job.id, keepOriginal: true },
  ]);
  assert.equal(retry.id, failed.id);
  assert.equal(retry.items[0].status, "prepared");
  assert.equal(f.workspace.history().length, 1);
});

test("不同任务实例并发准备相同批次都等待最终结果，不返回中间态", async (t) => {
  const f = await setup(t),
    tasks = new Tasks(f.workspace),
    goal = tasks.saveGoal({ resumeId: f.resume.id, directions: ["Go"] });
  const job = f.workspace.addJob({
    company: "演示",
    role: "Go",
    jd: "负责 Go API 开发与测试。",
    sourceUrl: "https://example.com/concurrent",
    recipient: "hr@example.com",
  });
  const results = await Promise.all([
    tasks.prepareBatch(goal.id, [{ jobId: job.id, keepOriginal: true }]),
    new Tasks(f.workspace).prepareBatch(goal.id, [
      { jobId: job.id, keepOriginal: true },
    ]),
  ]);
  assert.equal(results[0].id, results[1].id);
  assert.ok(
    results.every(
      (b) => b.status === "prepared" && b.items[0].status === "prepared",
    ),
  );
  assert.equal(f.workspace.history().length, 1);
});

test("所选岗位顺序改变仍复用同一准备批次", async (t) => {
  const f = await setup(t),
    tasks = new Tasks(f.workspace),
    goal = tasks.saveGoal({ resumeId: f.resume.id, directions: ["Go"] });
  const jobs = ["a", "b"].map((key) =>
    f.workspace.addJob({
      company: "演示",
      role: "Go",
      jd: "负责 Go API 开发与测试。",
      sourceUrl: `https://example.com/order/${key}`,
      recipient: "hr@example.com",
    }),
  );
  const choices = jobs.map((job) => ({ jobId: job.id, keepOriginal: true }));
  const first = await tasks.prepareBatch(goal.id, choices),
    second = await tasks.prepareBatch(goal.id, [...choices].reverse());
  assert.equal(first.id, second.id);
  assert.equal(f.workspace.history().length, 2);
  assert.equal(f.store.list("batch").length, 1);
});

test("失败的详情请求也计入十页预算，并标记部分读取", async (t) => {
  const f = await setup(t);
  let reads = 0;
  const tasks = new Tasks(f.workspace, async (url) => {
    reads++;
    if (url.includes("/detail/")) throw new Error("详情读取失败");
    return {
      ...page("产品经理"),
      url,
      links: [0, 1].map((i) => ({
        url: `https://example.com/detail/${reads}/${i}`,
        kind: "job" as const,
        label: "Go 开发",
        sourceUrl: url,
      })),
    };
  });
  const goal = tasks.saveGoal({
    resumeId: f.resume.id,
    directions: ["Go"],
    sources: Array.from(
      { length: 6 },
      (_, i) => `https://example.com/list/${i}`,
    ),
  });
  const result = await tasks.discover(goal.id);
  assert.equal(reads, 10);
  assert.equal(result.status, "partial");
  const one = tasks.saveGoal({
    resumeId: f.resume.id,
    directions: ["Go"],
    sources: ["https://example.com/list/single"],
  });
  assert.equal((await tasks.discover(one.id)).status, "partial");
});

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
