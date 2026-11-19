import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { Workspace } from "../../src/core/workspace.js";
import { Store } from "../../src/infrastructure/sqlite-store.js";
import { applicationFormContext } from "../../src/core/application-forms.js";
import { requireBrowserTools } from "../../src/adapters/dsh/browser-tools.js";
import { ResumeProfiles } from "../../src/core/resume-profiles.js";

test("官网填写使用所选版本与附件，不依赖邮箱，不猜测缺失资料，不准备投递", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "form-context-test-")),
    store = new Store(home),
    workspace = new Workspace(store);
  t.after(async () => {
    store.close();
    if (
      dirname(home) === tmpdir() &&
      basename(home).startsWith("form-context-test-")
    )
      await rm(home, { recursive: true, force: true });
  });
  const resume = await workspace.createResume(
    "官网简历",
    "姓名：演示用户\n手机：13800000000\n邮箱：demo@example.com\n项目经历\n参与 Go API 开发。",
  );
  const job = workspace.addJob({
    company: "示例",
    role: "Go",
    jd: "Go 开发",
    sourceUrl: "https://example.com/jobs/1",
  });
  await assert.rejects(
    applicationFormContext(workspace, resume.id, job.id),
    /先解析/,
  );
  const profiles = new ResumeProfiles(workspace),
    draft = profiles.draft(resume.id);
  profiles.confirm(draft.id, draft.data);
  const context = await applicationFormContext(workspace, resume.id, job.id);
  assert.equal(context.attachment.path, resume.pdf);
  assert.deepEqual(
    context.facts.map(({ field, value }) => ({ field, value })),
    [
      { field: "name", value: "演示用户" },
      { field: "phone", value: "13800000000" },
      { field: "email", value: "demo@example.com" },
    ],
  );
  assert.equal(context.policy.submit, false);
  assert.equal(context.policy.sendMail, false);
  assert.equal(workspace.history().length, 0);
  const boss = workspace.addJob({
    company: "示例",
    role: "Go",
    jd: "Go 开发",
    sourceUrl: "https://www.zhipin.com/job_detail/demo.html?source=share",
  });
  await assert.rejects(
    applicationFormContext(workspace, resume.id, boss.id),
    /BOSS 招聘链接.*BOSS 投递/,
  );
  await writeFile(resume.pdf!, "corrupted");
  await assert.rejects(
    applicationFormContext(workspace, resume.id, job.id),
    /附件已改变/,
  );
  workspace.trashResume(resume.id);
  await assert.rejects(
    applicationFormContext(workspace, resume.id, job.id),
    /回收站/,
  );
});

test("浏览器填写检查真实工具，不把预览器或不同连接的零散工具当成可用", () => {
  const names = ["new_page", "take_snapshot", "fill_form", "upload_file"];
  assert.deepEqual(
    requireBrowserTools(names.map((n) => `mcp__recruiting_browser__${n}`)),
    names.map((n) => `mcp__recruiting_browser__${n}`),
  );
  assert.throws(
    () => requireBrowserTools(["preview_document", "open_browser"]),
    /官网代填不可用.*BOSS 投递不受影响/,
  );
  assert.throws(
    () => requireBrowserTools(names.map((n, i) => `mcp__browser_${i}__${n}`)),
    /官网代填不可用/,
  );
});
