import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { mount } from "../../dist/adapters/dsh/host.js";
import { ResumeProfiles } from "../../dist/core/resume-profiles.js";
import { WebsiteFill } from "../../dist/core/website-fill.js";
import { Workspace } from "../../dist/core/workspace.js";
import { Store } from "../../dist/infrastructure/sqlite-store.js";
import { applicationPage } from "../../dist/infrastructure/website-browser.js";

// Intercept all traffic. Exercise the native command and the real browser DOM,
// with a private temporary workspace and without a DSH model or browser MCP.
const origin = "https://careers.example.test";
const ats = "https://hiring.example.test";
const home = await mkdtemp(join(tmpdir(), "resume-website-form-"));
const store = new Store(home);
const workspace = new Workspace(store);
let browser;
try {
  const resume = await workspace.createResume(
    "示例简历",
    "姓名：演示用户\n手机：13800000000\n邮箱：demo@example.com\n教育经历\n学校：示例大学\n学历：本科\n项目经历\nGo 工具 | 开发 2026.01 - 至今\n参与 Go API 开发与测试。",
  );
  const profiles = new ResumeProfiles(workspace);
  const draft = profiles.draft(resume.id);
  profiles.confirm(draft.id, draft.data);
  const job = workspace.addJob({
    company: "表单验证", role: "软件工程师", jd: "软件开发", sourceUrl: `${origin}/jobs/1`,
  });
  const boss = workspace.addJob({
    company: "测试", role: "开发", jd: "软件开发", sourceUrl: "https://www.zhipin.com/job_detail/test.html",
  });
  browser = await chromium.launch({ channel: process.env.RESUME_TEST_BROWSER ?? "msedge", headless: true });
  const page = await browser.newPage();
  let submissions = 0;
  let uploads = 0;
  let opened = 0;
  let payload;
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === ats && url.pathname === "/apply/1")
      return route.fulfill({ contentType: "text/html; charset=utf-8", body: `<!doctype html>
        <main>
          <div role="form" aria-label="职位申请">
            <span id="name-label">姓名</span><input aria-labelledby="name-label" id="ats-name">
            <input aria-label="手机" type="tel" required>
            <div role="group" aria-label="教育经历">
              <input aria-label="学校">
              <button role="combobox" aria-label="学历" aria-required="true" onclick="document.body.dataset.clicked = 'yes'">请选择</button>
            </div>
            <div contenteditable="true" role="textbox" aria-label="项目经历"></div>
            <label>简历附件<input type="file" accept=".pdf" hidden></label>
            <button onclick="document.body.dataset.submitted = 'yes'">提交申请</button>
          </div>
        </main>` });
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/submit") {
      submissions++;
      return route.fulfill({ body: "submitted" });
    }
    if (url.pathname === "/attachment") {
      uploads++;
      payload = request.postDataBuffer();
      return route.fulfill({ body: "uploaded" });
    }
    return route.fulfill({ contentType: "text/html; charset=utf-8", body:
      url.pathname === "/jobs/1" ? '<a href="/apply">申请职位</a>' : `<!doctype html>
      <form action="/submit" method="post">
        <label>姓名<input name="name" required></label>
        <label>手机<input name="phone" type="tel" required></label>
        <label>邮箱<input name="email" type="email" required></label>
        <label>学校<input name="school"></label>
        <label>学历<select name="degree"><option value="">请选择</option><option value="bachelor">本科</option></select></label>
        <label>项目经历<textarea name="project"></textarea></label>
        <label>毕业日期<input name="graduation" type="date" required></label>
        <label>简历附件<input type="file" name="resume" accept=".pdf" hidden></label>
        <label><input name="consent" type="checkbox" required>我同意信息处理声明</label>
        <button type="submit">提交申请</button>
      </form>
      <script>document.forms[0].elements.resume.onchange = e => {
        fetch('/attachment', { method: 'POST', body: e.target.files[0] }).then(() => {
          document.body.dataset.uploaded = e.target.files[0].name;
        });
      };</script>`,
    });
  });
  let handler;
  mount({
    effect: (register) => register(),
    tools: { register: () => () => {} },
    commands: { register: (command) => { handler = command.handler; return () => {}; } },
    systemPrompt: { section: () => () => {} },
  }, workspace, undefined, undefined, undefined, new WebsiteFill(workspace, async (_, url) => {
    if (opened++ === 0) await page.goto(url);
    return applicationPage(page, async (host) => assert.equal(host, "hiring.example.test"));
  }));
  const fill = (jobId, approvalId) => handler({ rawInput: JSON.stringify({
    action: "website-fill", resumeId: resume.id, jobId, approvalId,
  }), signal: new AbortController().signal });

  const result = await fill(job.id);
  assert.equal(result.kind, "success", result.text);
  await page.waitForFunction(() => document.body.dataset.uploaded === "示例简历.pdf");
  const view = JSON.parse(result.text);
  assert.match(view.websiteNotice, /补完必填项/);
  assert.equal(view.formRun.status, "needs_input");
  assert.equal(view.formRun.checks.filter((check) => check.status === "matched").length, 7);
  assert.equal(await page.locator('[name="degree"]').inputValue(), "bachelor");
  assert.match(await page.locator('[name="project"]').inputValue(), /Go API/);
  assert.equal(await page.locator('[name="graduation"]').inputValue(), "");
  assert.equal(await page.locator('[name="consent"]').isChecked(), false);
  assert.deepEqual(payload, await readFile(resume.pdf));

  await page.locator('[name="email"]').fill("already-entered@example.com");
  assert.equal((await fill(job.id)).kind, "success");
  assert.equal(await page.locator('[name="email"]').inputValue(), "already-entered@example.com");
  assert.equal(uploads, 1, "同一份简历不会重复上传");
  await page.locator("form").evaluate((form) => { form.action = "https://other.example.test/submit"; });
  await page.locator('[name="name"]').clear();
  const foreign = await fill(job.id);
  assert.match(JSON.parse(foreign.text).websiteNotice, /具体申请表/);
  assert.equal(await page.locator('[name="name"]').inputValue(), "");
  const rejected = await fill(boss.id);
  assert.equal(rejected.kind, "error");
  assert.match(rejected.text, /BOSS/);
  assert.equal(opened, 3, "BOSS 链接不能唤起官网浏览器");
  await page.goto(`${ats}/apply/1`);
  const pending = JSON.parse((await fill(job.id)).text);
  assert.match(pending.websiteNotice, /hiring\.example\.test/);
  assert.ok(pending.websiteApprovalId);
  assert.equal(await page.locator("#ats-name").inputValue(), "");
  const confirmed = JSON.parse((await fill(job.id, pending.websiteApprovalId)).text);
  assert.equal(await page.locator("#ats-name").inputValue(), "演示用户");
  assert.equal(await page.getByLabel("学校").inputValue(), "示例大学");
  assert.match(await page.getByRole("textbox", { name: "项目经历" }).innerText(), /Go API/);
  assert.equal(await page.locator("input[type=file]").evaluate((node) => node.files[0].name), "示例简历.pdf");
  assert.equal(confirmed.formRun.status, "needs_input");
  assert.ok(confirmed.formRun.issues.some((issue) => issue.label === "学历" && /手动/.test(issue.reason)));
  assert.equal(await page.locator("body").getAttribute("data-clicked"), null);
  assert.equal(await page.locator("body").getAttribute("data-submitted"), null);
  assert.equal(submissions, 0);
  assert.equal(workspace.history().length, 0);
  console.log(JSON.stringify({ passed: true, nativeChecks: 7, crossOriginSpa: true, uploads, submissions, mailRecords: 0 }));
} finally {
  await browser?.close();
  store.close();
  await rm(home, { recursive: true, force: true, maxRetries: 5 });
}
