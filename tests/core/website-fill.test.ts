import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { FormRuns, type FormRun } from "../../src/core/form-runs.js";
import { ResumeProfiles } from "../../src/core/resume-profiles.js";
import { WebsiteFill, type WebsiteField } from "../../src/core/website-fill.js";
import { Workspace } from "../../src/core/workspace.js";
import { Store } from "../../src/infrastructure/sqlite-store.js";

test("第三方申请页需要核对具体页面、岗位和简历，旧确认不能复用", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "website-fill-test-"));
  const storage = new Store(home);
  t.after(async () => {
    storage.close();
    await rm(home, { recursive: true, force: true });
  });
  const workspace = new Workspace(storage);
  const resume = await workspace.createResume("示例", "姓名：演示用户");
  const profiles = new ResumeProfiles(workspace);
  const draft = profiles.draft(resume.id);
  profiles.confirm(draft.id, draft.data);
  const source = "https://careers.example.com/jobs/1";
  const target = "https://ats.example.org/apply/1";
  const job = workspace.addJob({ role: "前端开发", company: "示例公司", jd: "开发", sourceUrl: source });
  const otherJob = workspace.addJob({ role: "工程师", company: "示例公司", jd: "研发", sourceUrl: source });
  let current = target;
  let name = "";
  let reads = 0;
  let attachments = 0;
  const validated: string[] = [];
  const confirmed: WebsiteField = {
    field: { uid: "name", label: "姓名", type: "text", required: true, options: [], value: "" },
    read: async () => name,
    fill: async (value) => { name = value; },
    attach: async () => { throw new Error("不适用"); },
  };
  const attachment: WebsiteField = {
    field: { uid: "resume", label: "简历附件", type: "file", required: true, options: [], value: "" },
    read: async () => attachments ? "示例.pdf" : undefined,
    fill: async () => { throw new Error("不适用"); },
    attach: async () => { attachments++; },
  };
  const manual: WebsiteField = {
    field: { uid: "degree", label: "学历", type: "select", manual: true, required: true, options: [], value: "" },
    read: async () => undefined,
    fill: async () => { throw new Error("应由用户处理"); },
    attach: async () => { throw new Error("不适用"); },
  };
  const service = new WebsiteFill(workspace, async (_jobId, url) => {
    assert.equal(url, source);
    return {
      url: () => current,
      inspect: async () => { reads++; return [confirmed, attachment, manual]; },
      followApplicationLink: async () => false,
      validateDestination: async (url) => { validated.push(url); },
    };
  });
  const signal = new AbortController().signal;
  const fill = (approvalId?: string, jobId = job.id) => service.fill(resume.id, jobId, signal, approvalId);
  assert.match((await fill(target)).notice, /重新点/);
  const other = await fill();
  assert.ok(other.approvalId);
  assert.equal(reads, 0);
  assert.equal(attachments, 0);
  assert.match((await fill(other.approvalId, otherJob.id)).notice, /重新点/);
  const changed = await fill();
  assert.ok(changed.approvalId);
  current = "https://ats.example.org/apply/2";
  assert.match((await fill(changed.approvalId)).notice, /重新点/);
  assert.equal(reads, 0);
  current = target;
  const ready = await fill();
  assert.ok(ready.approvalId);
  assert.match((await fill(ready.approvalId)).notice, /核对填入的资料/);
  assert.equal(name, "演示用户");
  assert.equal(attachments, 1);
  assert.deepEqual(validated, [target, target, target, target]);
  assert.match((await fill(ready.approvalId)).notice, /重新点/);
  assert.equal(attachments, 1);
  const [run] = storage.list<FormRun>("form-run");
  assert.match(run.targetDigest ?? "", /^[a-f0-9]{64}$/);
  assert.match(run.issues[0].reason, /手动/);
  await assert.rejects(new FormRuns(workspace).plan(run.id, target, []), /核对第三方/);
});
