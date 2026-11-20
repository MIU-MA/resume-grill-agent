import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { Store } from "../../dist/infrastructure/sqlite-store.js";
import { Workspace } from "../../dist/core/workspace.js";

// Uses the actual installed DSH runtime and a deterministic local LLM adapter.
// No real credentials, paid model requests or SMTP calls.
const command = process.env.DSH_COMMAND;
assert.ok(command, "设置 DSH_COMMAND 为本机 dsh.cmd 的绝对路径。");
const root = resolve("."),
  home = await mkdtemp(join(tmpdir(), "resume-native-browser-"));
let browser, child, store;
let log = "";
const env = {
  ...process.env,
  DSH_COMMAND: command,
  DSH_HOME: join(home, "dsh"),
  RESUME_AGENT_HOME: join(home, "data"),
  RESUME_ALLOW_SEND: "0",
  RESUME_SMTP_CODE: "",
  RESUME_SMTP_ADDRESS: "",
};
const run = (script, extra = {}) =>
  new Promise((done, reject) => {
    const p = spawn("powershell.exe", ["-NoProfile", "-Command", script], {
      cwd: root,
      env: { ...env, ...extra },
      windowsHide: true,
    });
    let out = "";
    p.stdout.on("data", (b) => (out += b));
    p.stderr.on("data", (b) => (out += b));
    p.on("error", reject);
    p.on("exit", (code) => (code === 0 ? done(out) : reject(new Error(out))));
  });
async function openSettings(page) {
  const direct = page.getByRole("button", { name: "设置", exact: true });
  if (await direct.isVisible()) await direct.click();
  else {
    await page.getByRole("button", { name: "账号菜单", exact: true }).click();
    await page.getByRole("menuitem", { name: /^设置/ }).click();
  }
}
try {
  const previous = process.env.RESUME_PREVIOUS_PLUGIN_SPEC;
  if (previous) {
    assert.ok(process.env.RESUME_PLUGIN_SPEC, "升级验证需要新旧两个安装包。");
    await run("& $env:DSH_COMMAND plugin --profile web add $env:RG_PACKAGE", {
      RG_PACKAGE: previous,
    });
  }
  await run("& $env:DSH_COMMAND plugin --profile web add $env:RG_PACKAGE", {
    RG_PACKAGE: process.env.RESUME_PLUGIN_SPEC ?? `link:${root}`,
  });
  if (previous) {
    const installed = JSON.parse(await readFile(join(env.DSH_HOME, "profiles", "web", "node_modules", "resume-grill-agent", "package.json"), "utf8"));
    const expected = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    assert.equal(installed.version, expected.version, "DSH 应升级到当前仓库的插件版本");
  }
  store = new Store(env.RESUME_AGENT_HOME);
  const workspace = new Workspace(store);
  const file = join(home, "演示简历.txt");
  await writeFile(file, "演示用户\n项目经历\n- 负责 Go API 开发与测试。");
  const resume = await workspace.importResume(file),
    job = workspace.addJob({
      company: "演示公司",
      role: "Go 开发",
      jd: "演示公司招聘 Go 开发，负责 Go API 开发与测试。",
      sourceUrl: "https://127.0.0.1/jobs/native",
      recipient: "hr@example.com",
    });
  const context = workspace.reviewContext(resume.id, job.id),
    section = context.sections.find((s) =>
      s.lines.some((l) => l.includes("Go")),
    ),
    lineIndex = section.lines.findIndex((l) => l.includes("Go"));
  const args = {
    resumeId: resume.id,
    jobId: job.id,
    plan: {
      company: "演示公司",
      role: "Go 开发",
      sectionOrder: context.sections.map((s) => s.id),
      changes: [
        {
          sectionId: section.id,
          lineIndex,
          after: "- 参与 Go API 开发与测试。",
          requirement: "Go API 开发与测试",
          reason: "写清参与范围。",
        },
      ],
      highlights: [],
      gaps: [],
    },
  };
  const fixture = join(home, "fixture.mjs");
  await writeFile(
    fixture,
    `export const name='resume-native-test';export const inject=['llm','workspaceRegistry'];
 export async function apply(ctx){await ctx.workspaceRegistry.create(${JSON.stringify(home)},'演示求职');const seen=new Map();const adapter={providerInfo:p=>({id:p,name:'本地验证（不调用模型）'}),providerRetryPolicy:()=>undefined,imageRequestPricing:()=>undefined,listModels:async p=>[{provider:p,id:'local',name:'本地验证（不调用模型）'}],resolveModel:async(p,m)=>({provider:p,id:m,name:'本地验证（不调用模型）',inputModalities:['text']}),async prepareCall(p,m){return{model:await this.resolveModel(p,m),stream:o=>this.stream(o)}},async *stream(options){options.signal?.throwIfAborted();const count=seen.get(options.sessionId)||0;seen.set(options.sessionId,count+1);if(count%2===0){const block={type:'tool-call',id:'native-review-'+count,name:'resume_grill_propose_resume_changes',arguments:JSON.stringify({...${JSON.stringify(args)},jobId:options.messages.filter(m=>m.role==='user').flatMap(m=>m.content).filter(p=>p.type==='text').map(p=>p.text).reverse().find(t=>t.includes('resume_grill_review_context'))?.match(/与岗位 ([a-f0-9-]+)/)?.[1]||${JSON.stringify(job.id)}})};yield{type:'block-start',index:0,blockType:'tool-call'};yield{type:'tool-call-delta',index:0,id:block.id,name:block.name,argumentsDelta:block.arguments};yield{type:'block-end',index:0,block};yield{type:'finish',reason:{kind:'tool-calls'}}}else{yield{type:'block-start',index:0,blockType:'text'};yield{type:'text-delta',index:0,text:'请在上面的求职卡片中核对。'};yield{type:'block-end',index:0,block:{type:'text',text:'请在上面的求职卡片中核对。'}};yield{type:'finish',reason:{kind:'stop'}}}}};ctx.effect(()=>ctx.llm.registerAdapter(['resume-native-test'],adapter));}
 `,
  );
  const patch = join(home, "verify.patch.yml");
  await writeFile(
    patch,
    `- id: agent-default-model\n  config:\n    provider: resume-native-test\n    model: local\n- id: session-title-llm\n  disabled: true\n- insert:\n    - id: resume-native-test\n      name: ${JSON.stringify(pathToFileURL(fixture).href)}\n`,
  );
  child = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "& $env:DSH_COMMAND --profile web --patch $env:RG_PATCH --no-open --port 0",
    ],
    { cwd: root, env: { ...env, RG_PATCH: patch }, windowsHide: true },
  );
  child.stdout.on("data", (b) => (log += b));
  child.stderr.on("data", (b) => (log += b));
  let address;
  for (let i = 0; i < 150; i++) {
    address = log.match(/dsh web: (http:\/\/[^\s]+)/)?.[1];
    if (address) break;
    if (child.exitCode !== null) throw new Error(log);
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(address, `DSH 未启动：${log}`);
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(address);
  const welcome = page.getByRole("button", { name: "继续", exact: true });
  if (
    await welcome
      .waitFor({ state: "visible", timeout: 10000 })
      .then(() => true)
      .catch(() => false)
  )
    await welcome.click();
  const input = page.getByRole("textbox").last();
  if ((await input.getAttribute("contenteditable")) === "false")
    await page.getByText("演示求职", { exact: true }).first().click();
  await input.fill("按 JD 核对 Go 开发简历。");
  await input.press("Enter");
  const card = page.getByRole("region", { name: "Resume Grill 求职卡片" });
  await page
    .getByLabel("接受这条修改", { exact: true })
    .waitFor({ timeout: 40000 });
  assert.equal(store.list("proposal").length, 1);
  await page.getByLabel("接受这条修改", { exact: true }).check();
  await page
    .getByRole("button", { name: "用所选修改准备邮件", exact: true })
    .click();
  await page.getByText("hr@example.com", { exact: true }).waitFor();
  assert.equal(workspace.history().length, 1);
  assert.equal(workspace.history()[0].status, "prepared");
  const original = workspace.history()[0];
  await page.getByLabel("我已核对收件人、邮件正文和实际附件").check();
  await page.getByRole("button", { name: "修改邮件", exact: true }).click();
  await page.getByLabel("收件邮箱", { exact: true }).fill("edited@example.com");
  await page.getByLabel("主题", { exact: true }).fill("应聘 Go 开发 · 已核对");
  await page
    .getByLabel("正文", { exact: true })
    .fill(
      "您好：\n\n我参与过 Go API 开发与测试，附件是我的简历。\n\n感谢查看。",
    );
  assert.equal(
    await page
      .getByRole("button", { name: "核对最新状态", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "确认并真实发送", exact: true })
      .count(),
    0,
  );
  const frozenBytes = await readFile(original.attachment);
  await writeFile(original.attachment, "damaged test attachment");
  await page.getByRole("button", { name: "保存邮件", exact: true }).click();
  await card.getByRole("alert").filter({ hasText: "附件校验失败" }).waitFor();
  assert.equal(
    await page.getByLabel("收件邮箱", { exact: true }).inputValue(),
    "edited@example.com",
  );
  assert.equal(workspace.history().length, 1, "保存失败不得生成新投递");
  await writeFile(original.attachment, frozenBytes);
  await page.getByRole("button", { name: "保存邮件", exact: true }).click();
  await page.getByText("edited@example.com", { exact: true }).waitFor();
  const revised = workspace.history()[0];
  assert.notEqual(revised.id, original.id);
  assert.equal(revised.revisedFrom, original.id);
  assert.equal(revised.attachmentHash, original.attachmentHash);
  assert.equal(workspace.preview(original.id).status, "superseded");
  assert.equal(
    await page.getByLabel("我已核对收件人、邮件正文和实际附件").isChecked(),
    false,
  );
  await page.getByRole("button", { name: "修改邮件", exact: true }).click();
  await page.getByLabel("主题", { exact: true }).fill("取消后不应保存");
  await page.getByRole("button", { name: "取消修改", exact: true }).click();
  assert.equal(workspace.history().length, 2);
  await page.getByText(revised.subject, { exact: true }).waitFor();
  const output = resolve(".resume-agent/verification");
  await mkdir(output, { recursive: true });
  await page.screenshot({
    path: join(output, "dsh-native-application.png"),
    fullPage: true,
  });
  assert.equal(
    await page
      .getByRole("button", { name: "确认并真实发送", exact: true })
      .isDisabled(),
    true,
  );
  await page
    .getByRole("button", { name: "检查附件，不发信", exact: true })
    .click();
  await page.getByText("附件已检查，未发送", { exact: true }).waitFor();
  assert.equal(workspace.history()[0].status, "simulated");
  assert.equal(
    store.db.prepare("SELECT COUNT(*) AS n FROM approvals").get().n,
    0,
  );
  // A replayed tool card starts from its committed proposal; re-read the live record explicitly.
  await page.reload();
  await page.getByText("edited@example.com", { exact: true }).waitFor();
  await page.getByText("附件已检查，未发送", { exact: true }).waitFor();
  assert.equal(workspace.history().length, 2, "重放卡片不得产生重复投递");
  await page.setViewportSize({ width: 430, height: 900 });
  await page.getByRole("button", { name: "修改邮件", exact: true }).click();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: join(output, "dsh-native-mobile.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "取消修改", exact: true }).click();
  assert.deepEqual(errors, []);
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page
    .getByRole("button", { name: "打开实际 PDF 附件", exact: true })
    .click();
  await page.locator("canvas").first().waitFor({ timeout: 20000 });
  await page.screenshot({
    path: join(output, "dsh-native-attachment.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "求职快开", exact: true }).click();
  const workbench = page.getByRole("region", {
    name: "Resume Grill",
    exact: true,
  });
  const narrow = workbench.getByRole("region", { name: "求职总览", exact: true });
  const narrowPortrait = narrow.getByRole("img", { name: "像素风 DS 娘" });
  await narrowPortrait.waitFor();
  assert.equal(await narrowPortrait.evaluate(async (image) => {
    await image.decode();
    return image.naturalWidth;
  }), 256);
  assert.equal(await narrow.locator(".rg-overview-grid").evaluate((grid) =>
    getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length,
  ), 1, "窄侧栏应使用单列");
  assert.deepEqual(await narrow.locator(".rg-overview-counts > button").evaluateAll((buttons) => {
    const perRow = new Map();
    for (const button of buttons) {
      const top = button.getBoundingClientRect().top;
      perRow.set(top, (perRow.get(top) ?? 0) + 1);
    }
    return [...perRow.values()];
  }), [3, 2], "窄侧栏的五张统计卡应平衡分成两行");
  await workbench.screenshot({ path: join(output, "dsh-workspace-sidebar.png") });
  await workbench.getByRole("button", { name: "简历库", exact: true }).click();
  await workbench.getByText("演示简历.txt", { exact: true }).waitFor();
  const [resumeChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    workbench.getByText("选择简历文件", { exact: true }).click(),
  ]);
  await resumeChooser.setFiles({
    name: "侧栏上传.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("演示用户\n项目经历\n- 参与 Go API 开发与测试。"),
  });
  await workbench
    .getByRole("region", { name: "可复用的简历资料", exact: true })
    .waitFor();
  await workbench
    .getByRole("button", { name: "确认并保存资料", exact: true })
    .click();
  await workbench
    .getByRole("button", { name: "返回清单", exact: true })
    .click();
  await workbench.getByText("侧栏上传.txt", { exact: true }).waitFor();
  assert.equal(store.list("resume").filter((item) => !item.parentId).length, 2);
  await workbench
    .locator("article")
    .filter({ hasText: "侧栏上传.txt" })
    .getByRole("button", { name: "查看 / 修改简历", exact: true })
    .click();
  await workbench.getByLabel("简历正文", { exact: true }).waitFor();
  assert.match(
    await workbench.getByLabel("简历正文", { exact: true }).inputValue(),
    /Go API/,
  );
  await workbench
    .getByRole("button", { name: "返回清单", exact: true })
    .click();
  await workbench.getByLabel("查找简历", { exact: true }).fill("侧栏上传");
  const uploadedRow = workbench
    .locator("article")
    .filter({ has: page.getByText("侧栏上传.txt", { exact: true }) });
  await uploadedRow
    .getByRole("button", { name: "重命名", exact: true })
    .click();
  await workbench
    .getByLabel("简历名称", { exact: true })
    .fill("侧栏上传-已改名");
  await workbench
    .getByRole("button", { name: "保存名称", exact: true })
    .click();
  await workbench.getByText("侧栏上传-已改名", { exact: true }).waitFor();
  await workbench
    .getByLabel("查找简历", { exact: true })
    .fill("完全不存在的简历");
  await workbench
    .getByText("没有找到匹配的简历，可以更换关键词。", { exact: true })
    .waitFor();
  await workbench
    .getByLabel("查找简历", { exact: true })
    .fill("侧栏上传-已改名");
  await workbench
    .locator("article")
    .filter({ has: page.getByText("侧栏上传-已改名", { exact: true }) })
    .getByRole("button", { name: "复制", exact: true })
    .click();
  await workbench
    .getByRole("region", { name: "简历查看与编辑", exact: true })
    .waitFor();
  await workbench
    .getByRole("button", { name: "返回清单", exact: true })
    .click();
  const copyName = "侧栏上传-已改名-副本.txt";
  const copyRow = workbench
    .locator("article")
    .filter({ has: page.getByText(copyName, { exact: true }) });
  await copyRow.getByRole("button", { name: "删除", exact: true }).click();
  await workbench
    .getByRole("button", { name: "撤销删除", exact: true })
    .click();
  await copyRow.getByRole("button", { name: "删除", exact: true }).click();
  await workbench.getByLabel("简历范围", { exact: true }).selectOption("trash");
  await copyRow.getByRole("button", { name: "恢复简历", exact: true }).click();
  await workbench.getByText("回收站为空。", { exact: true }).waitFor();
  await workbench.getByLabel("简历范围", { exact: true }).selectOption("all");
  await copyRow
    .getByRole("button", { name: "查看 / 修改简历", exact: true })
    .waitFor();
  await workbench
    .getByRole("button", { name: "新建简历", exact: true })
    .click();
  await workbench
    .getByLabel("新简历名称", { exact: true })
    .fill("文字整理简历");
  await workbench
    .getByLabel("新简历内容", { exact: true })
    .fill("演示用户\n项目经历\n- 参与 Go API 开发与测试。");
  await workbench
    .getByRole("button", { name: "保存新简历", exact: true })
    .click();
  await workbench
    .getByRole("region", { name: "简历查看与编辑", exact: true })
    .waitFor();
  await workbench
    .getByRole("button", { name: "返回清单", exact: true })
    .click();
  await workbench.getByRole("button", { name: "总览", exact: true }).click();
  await workbench
    .getByRole("region", { name: "求职总览", exact: true })
    .waitFor();
  await workbench
    .getByRole("button", { name: "管理简历库", exact: true })
    .click();
  await workbench.getByRole("button", { name: "招聘官网", exact: true }).click();
  await workbench.getByText("Go 开发", { exact: true }).waitFor();
  await workbench
    .getByLabel("官网岗位关键词", { exact: true })
    .fill("数据分析");
  assert.equal(
    await workbench
      .getByRole("button", { name: "实时拉取岗位", exact: true })
      .isEnabled(),
    true,
  );
  workspace.addJob({
    company: "新增岗位公司",
    role: "数据分析师",
    jd: "数据分析师，负责 SQL 数据分析。",
    sourceUrl: "https://example.com/data",
  });
  await workbench
    .getByRole("button", { name: "刷新求职资料", exact: true })
    .click();
  await workbench.getByText("数据分析师", { exact: true }).waitFor();
  await workbench.getByRole("button", { name: /^邮箱投递/ }).click();
  await workbench.getByText("edited@example.com", { exact: true }).waitFor();
  await workbench
    .getByRole("button", { name: "查看邮件与附件", exact: true })
    .click();
  await workbench
    .getByRole("button", { name: "修改邮件", exact: true })
    .waitFor();
  assert.equal(workspace.history().length, 2);
  await page.screenshot({
    path: join(output, "dsh-workbench.png"),
    fullPage: true,
  });
  await openSettings(page);
  await page.getByText("Resume Grill 邮箱", { exact: true }).click();
  const mailSettings = page.getByRole("region", { name: "Resume Grill 邮箱设置" });
  await mailSettings
    .getByLabel("发件邮箱", { exact: true })
    .fill("demo@qq.com");
  await mailSettings
    .getByLabel("SMTP 授权码", { exact: true })
    .fill("fake-local-verification-code");
  await mailSettings
    .getByRole("button", { name: "保存邮箱设置", exact: true })
    .click();
  await mailSettings.getByText("已保存邮箱设置。", { exact: true }).waitFor();
  assert.equal(
    await mailSettings.getByLabel("SMTP 授权码", { exact: true }).inputValue(),
    "",
  );
  assert.ok(
    !(await page.locator("body").innerText()).includes(
      "fake-local-verification-code",
    ),
  );
  await page.screenshot({
    path: join(output, "dsh-mail-settings.png"),
    fullPage: true,
  });
  await page.reload();
  await openSettings(page);
  await page.getByText("Resume Grill 邮箱", { exact: true }).click();
  await mailSettings
    .getByText("此邮箱的授权码已保存。", { exact: false })
    .waitFor();
  assert.equal(
    await mailSettings.getByLabel("发件邮箱", { exact: true }).inputValue(),
    "demo@qq.com",
  );
  await mailSettings
    .getByRole("button", { name: "移除授权码", exact: true })
    .click();
  await mailSettings
    .getByText("授权码已移除，发送已停用。", { exact: true })
    .waitFor();
  await page.keyboard.press("Escape");
  await page.getByText("插件", { exact: true }).first().click();
  await page.getByText("Resume Grill", { exact: true }).first().waitFor();
  await page.getByRole("button", { name: "求职快开", exact: true }).click();
  await page.getByRole("region", { name: "Resume Grill", exact: true }).waitFor();
  await page.getByRole("button", { name: "Resume Grill", exact: true }).click();
  const full = page
    .locator('[data-global-panel="true"]')
    .getByRole("region", { name: "Resume Grill", exact: true });
  const portrait = full.getByRole("img", { name: "像素风 DS 娘" });
  await portrait.waitFor();
  assert.equal(await portrait.evaluate((image) => image.decode().then(() => image.naturalWidth)), 256);
  await full.getByRole("button", { name: "简历库", exact: true }).click();
  await full.getByText("侧栏上传-已改名", { exact: true }).waitFor();
  await page.waitForFunction(() => {
    const panel = document.querySelector(
      '[data-global-panel="true"] .rg-workbench',
    );
    return panel && panel.getBoundingClientRect().width > 850;
  });
  await full.locator(".rg-refresh:enabled").waitFor();
  await page.screenshot({
    path: join(output, "dsh-resume-library.png"),
    fullPage: true,
  });
  await full.getByRole("button", { name: "总览", exact: true }).click();
  await full.getByRole("region", { name: "求职总览", exact: true }).waitFor();
  await full.locator(".rg-overview-actions .rg-primary:enabled").waitFor();
  assert.equal(await full.locator(".rg-overview-grid").evaluate((grid) =>
    getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length,
  ), 2, "宽版总览应使用双列");
  await page.screenshot({
    path: join(output, "dsh-workspace-overview.png"),
    clip: { x: 0, y: 0, width: 1440, height: 900 },
  });
  await full.getByRole("button", { name: "BOSS 投递", exact: true }).click();
  const boss = full.getByRole("region", { name: "BOSS 投递", exact: true });
  await boss.getByRole("button", { name: "找岗位并准备投递", exact: true }).waitFor();
  await boss.getByRole("button", { name: "打开 BOSS 浏览器", exact: true }).waitFor();
  assert.equal(await boss.locator("details").count(), 0);
  await page.screenshot({
    path: join(output, "dsh-boss-workbench.png"),
    clip: { x: 0, y: 0, width: 1440, height: 650 },
  });
  if (process.env.RESUME_VERIFY_BOSS_PREVIEW === "1") {
    const pdf = await workspace.createResume("BOSS 预览演示", "演示用户\n项目经历\n负责 Go API 开发。");
    const alternate = await workspace.createResume("BOSS 备用简历", "演示用户\n项目经历\n负责 Go API 测试。");
    const bossJob = workspace.addJob({
      company: "演示软件", role: "Go 开发", jd: "开发 Go API",
      sourceUrl: "https://www.zhipin.com/job_detail/demo.html",
    });
    const jdHash = createHash("sha256").update(bossJob.jd).digest("hex");
    store.put("boss-evidence", { id: `boss-evidence:${bossJob.id}`, jobId: bossJob.id, jdHash });
    const { resumeImages } = await import("../../dist/infrastructure/resume-images.js");
    const rendered = await resumeImages(pdf.pdf);
    const image = rendered.images[0];
    const folder = join(env.RESUME_AGENT_HOME, "boss-images", "preview-fixture");
    await mkdir(folder, { recursive: true });
    const imagePath = join(folder, "1.png");
    await writeFile(imagePath, image.bytes);
    store.put("boss-scan", {
      id: "10000000-0000-4000-8000-000000000012",
      resumeId: pdf.id,
      readId: "10000000-0000-4000-8000-000000000013",
      createdAt: Date.now(),
      query: "Go 开发",
      state: "ready",
      jobs: [
        { title: "Go 开发", company: "演示软件", salary: "18-25K", url: "https://www.zhipin.com/job_detail/demo.html" },
        { title: "后端开发实习", company: "演示科技", salary: "200-300 元/天", url: "https://www.zhipin.com/job_detail/demo2.html" },
        { title: "后端工程师", company: "演示数据", salary: "20-30K", url: "https://www.zhipin.com/job_detail/demo3.html" },
      ],
    });
    const deliveryId = "10000000-0000-4000-8000-000000000011";
    store.put("boss-delivery", {
      id: deliveryId, jobId: bossJob.id, resumeId: pdf.id, resumeName: pdf.name,
      company: bossJob.company, role: bossJob.role, url: bossJob.sourceUrl, jdHash,
      pdfPath: pdf.pdf, pdfHash: rendered.pdfHash,
      images: [{ path: imagePath, name: "简历-1.png", sha256: image.sha256, size: image.bytes.length }],
      digest: "preview-fixture", createdAt: Date.now(), updatedAt: Date.now(),
      status: "prepared", remoteId: deliveryId,
    });
    await full.getByRole("button", { name: "返回清单", exact: true }).click();
    const results = boss.getByRole("region", { name: "搜索结果", exact: true });
    await results.getByRole("listitem").first().waitFor();
    assert.equal(await results.getByRole("listitem").count(), 3);
    await results.getByText("已加入", { exact: true }).waitFor();
    await page.screenshot({
      path: join(output, "dsh-boss-job-list.png"),
      clip: { x: 0, y: 0, width: 1440, height: 935 },
    });
    await boss.getByRole("button", { name: "归档", exact: true }).click();
    const archivedTasks = boss.getByRole("button", { name: "已归档 1", exact: true });
    await archivedTasks.waitFor();
    assert.equal(await boss.getByRole("button", { name: "查看投递", exact: true }).count(), 0);
    await archivedTasks.click();
    await boss.getByRole("button", { name: "恢复", exact: true }).waitFor();
    await page.screenshot({
      path: join(output, "dsh-boss-task-archive.png"),
      fullPage: true,
    });
    await boss.getByRole("button", { name: "恢复", exact: true }).click();
    await boss.getByRole("button", { name: "已归档 0", exact: true }).waitFor();
    await boss.getByRole("button", { name: "当前任务", exact: true }).click();
    await boss.getByRole("button", { name: "查看投递", exact: true }).click();
    const review = full.getByRole("region", { name: "BOSS 投递核对", exact: true });
    await review.getByRole("button", { name: "查看简历", exact: true }).click();
    const imageView = review.getByRole("img", { name: "投递简历第 1 页" });
    await imageView.waitFor();
    await imageView.evaluate((img) => img.decode());
    await page.screenshot({
      path: join(output, "dsh-boss-resume-preview.png"),
      fullPage: true,
    });
    await review.getByRole("button", { name: "收起简历", exact: true }).click();
    assert.equal(await imageView.count(), 0);
    assert.equal(store.list("boss-run").length, 0);
    await rm(imagePath, { force: true });
    await review.getByRole("button", { name: "查看简历", exact: true }).click();
    await review.getByRole("alert").filter({ hasText: "第 1 页无法预览" }).waitFor();
    await review.getByRole("button", { name: "换简历", exact: true }).click();
    await review.getByLabel("为「Go 开发」选择简历", { exact: true }).selectOption(alternate.id);
    await review.getByRole("button", { name: "保存并重新核对", exact: true }).click();
    const batch = review.getByRole("region", { name: "BOSS 整批任务" });
    await batch.getByText(/简历：BOSS 备用简历/).waitFor();
    const checked = batch.getByLabel("已逐项核对全部公司、岗位、简历图片和默认招呼方式");
    assert.equal(await checked.isChecked(), false);
    assert.equal(await batch.getByRole("button", { name: "确认投递 1 个岗位" }).isDisabled(), true);
    await page.screenshot({ path: join(output, "dsh-boss-edit-queue.png"), fullPage: true });
    await batch.getByRole("button", { name: "移出待投", exact: true }).click();
    await boss.getByText("已移出待投。", { exact: true }).waitFor();
    assert.equal(store.list("boss-run").length, 0);
  }
  await full.getByRole("button", { name: "投递记录", exact: true }).click();
  await full.getByRole("heading", { name: "投递记录", exact: true }).waitFor();
  await full.getByText("edited@example.com", { exact: true }).waitFor();
  await full.locator(".rg-refresh:enabled").waitFor();
  await page.screenshot({
    path: join(output, "dsh-delivery-history.png"),
    clip: { x: 0, y: 0, width: 1440, height: 650 },
  });
  await full.getByRole("button", { name: "招聘官网", exact: true }).click();
  await full.getByRole("heading", { name: "招聘官网", exact: true }).waitFor();
  await full.locator(".rg-refresh:enabled").waitFor();
  await page.screenshot({
    path: join(output, "dsh-career-workbench.png"),
    clip: { x: 0, y: 0, width: 1440, height: 720 },
  });
  await full
    .getByLabel("用于核对的简历", { exact: true })
    .selectOption(resume.id);
  await full
    .getByRole("region", { name: "已保存的岗位", exact: true })
    .getByRole("listitem")
    .filter({ has: page.getByText("Go 开发", { exact: true }) })
    .getByRole("button", { name: "核对简历", exact: true })
    .click();
  const firstChange = full.getByLabel("接受这条修改", { exact: true });
  await firstChange.waitFor();
  await page.setViewportSize({ width: 1440, height: 1280 });
  await full.getByRole("region", { name: "Resume Grill 求职卡片", exact: true }).screenshot({
    path: join(output, "dsh-job-review.png"),
  });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await full
    .getByRole("button", { name: "解析简历并核对资料", exact: true })
    .click();
  await full
    .getByRole("button", { name: "确认并保存资料", exact: true })
    .click();
  await full.getByRole("button", { name: "回到当前岗位", exact: true }).click();
  await full.getByLabel("接受这条修改", { exact: true }).check();
  await full
    .getByRole("button", { name: "官网代填", exact: true })
    .click();
  await full
    .getByRole("alert")
    .filter({ hasText: "招聘页必须使用公网地址" })
    .waitFor();
  assert.equal(store.list("proposal").length, 1, "代填失败不能调用模型");
  await full.getByRole("button", { name: "记录官网已提交", exact: true }).click();
  await full.getByRole("status").filter({ hasText: "已记入投递记录。" }).waitFor();
  assert.equal(await full.getByLabel("接受这条修改", { exact: true }).isChecked(), true);
  await full
    .getByRole("button", { name: "重新生成建议", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        '[data-global-panel="true"] input[type="checkbox"]:checked',
      ).length === 0,
  );
  assert.equal(
    store.list("proposal").length,
    2,
    "点击生成建议必须实际通过宿主工具保存并刷新卡片",
  );
  await full
    .getByLabel("岗位 JD", { exact: true })
    .fill("演示公司招聘 Go 开发，负责 Go API 开发与测试，以及接口联调。");
  await full
    .getByRole("button", { name: "更新 JD，重新匹配", exact: true })
    .click();
  for (let i = 0; i < 150 && store.list("proposal").length < 3; i++)
    await new Promise((done) => setTimeout(done, 100));
  await full.getByLabel("接受这条修改", { exact: true }).waitFor();
  assert.equal(store.list("proposal").length, 3, "更新 JD 后直接生成独立建议");
  assert.notEqual(store.list("proposal")[0].jobId, job.id);
  assert.equal(
    await full.getByLabel("接受这条修改", { exact: true }).isChecked(),
    false,
  );
  await full
    .getByRole("button", { name: "保存所选修改为岗位版 PDF", exact: true })
    .click();
  await full
    .getByRole("region", { name: "简历查看与编辑", exact: true })
    .waitFor();
  await full.getByRole("button", { name: "返回清单", exact: true }).click();
  if (process.env.RESUME_VERIFY_LIVE === "1") {
    await full.getByRole("button", { name: "招聘官网", exact: true }).click();
    await full.getByLabel("官网岗位关键词", { exact: true }).fill("AI应用");
    await full
      .getByRole("button", { name: "实时拉取岗位", exact: true })
      .click();
    await full
      .getByRole("region", { name: "招聘官网实时岗位", exact: true })
      .getByRole("button", { name: "核对简历", exact: true })
      .first()
      .waitFor({ timeout: 90000 });
    console.log(
      JSON.stringify({
        liveSource: "Tencent official",
        rows: await full
          .getByRole("region", { name: "招聘官网实时岗位", exact: true })
          .getByRole("button", { name: "核对简历", exact: true })
          .count(),
      }),
    );
    await full
      .getByRole("region", { name: "招聘官网实时岗位", exact: true })
      .getByRole("button", { name: "核对简历", exact: true })
      .first()
      .click();
    await full
      .getByLabel("岗位 JD", { exact: true })
      .waitFor({ timeout: 60000 });
    assert.ok(
      (await full.getByLabel("岗位 JD", { exact: true }).inputValue()).length >
        50,
    );
    const text = full.getByLabel("岗位版简历正文", { exact: true });
    await text.fill((await text.inputValue()) + "\n参与接口联调。");
    await full
      .getByRole("button", { name: "保存手动修改", exact: true })
      .click();
    await full
      .getByRole("region", { name: "简历查看与编辑", exact: true })
      .waitFor();
    assert.match(
      await full.getByLabel("简历正文", { exact: true }).inputValue(),
      /接口联调/,
    );
    assert.equal(
      workspace.history().length,
      2,
      "实时查看和改简历不能准备或发送邮件",
    );
  }
  await full.getByRole("button", { name: "投递记录", exact: true }).click();
  const webRow = full.getByRole("listitem").filter({ hasText: "手动记录已提交" });
  await webRow.getByRole("button", { name: "记录跟进", exact: true }).click();
  await webRow.getByLabel("跟进进展", { exact: true }).selectOption("interview");
  await webRow.getByLabel("下次跟进日期", { exact: true }).fill("2025-03-10");
  await webRow.getByLabel("跟进备注", { exact: true }).fill("复习 Go API 项目，再确认面试时间");
  await webRow.getByRole("button", { name: "保存跟进", exact: true }).click();
  await webRow.getByText("已约面", { exact: true }).waitFor();
  await full.getByRole("button", { name: "到期跟进 1", exact: true }).click();
  assert.equal(await full.getByRole("listitem").count(), 1);
  assert.equal(store.list("website-application").length, 1);
  assert.equal(await webRow.getByText("复习 Go API 项目，再确认面试时间", { exact: true }).count(), 1);
  await page.screenshot({ path: join(output, "dsh-application-followup.png"), fullPage: true });
  await page.screenshot({
    path: join(output, "dsh-workspace-full.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      runtime: "installed DSH",
      model: "deterministic local test adapter; zero external model calls",
      verified:
        "resume create/upload/search/rename/copy/trash/undo/restore → overview → native PDF; email edit → model regeneration → JD update → independent PDF; live official jobs optional; no mail sent",
      screenshots: output,
    }),
  );
} catch (error) {
  if (store)
    console.error(
      JSON.stringify({
        proposalCount: store.list("proposal").length,
        applicationCount: store.list("application").length,
      }),
    );
  if (browser) {
    const p = browser.contexts()[0]?.pages()[0];
    if (p) {
      console.error((await p.locator("body").innerText()).slice(-7000));
      await p
        .screenshot({
          path: resolve(".resume-agent/native-failure.png"),
          fullPage: true,
        })
        .catch(() => {});
    }
  }
  console.error(log.replace(/\?token=[^\s]+/g, "?token=[redacted]"));
  throw error;
} finally {
  await browser?.close();
  if (child?.pid)
    await new Promise((done) => {
      const p = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        windowsHide: true,
      });
      p.on("exit", done);
      p.on("error", done);
    });
  store?.close();
  if (
    dirname(home) === tmpdir() &&
    basename(home).startsWith("resume-native-browser-")
  )
    await rm(home, {
      recursive: true,
      force: true,
      maxRetries: 6,
      retryDelay: 500,
    });
}
