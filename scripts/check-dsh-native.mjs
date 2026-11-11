import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { Store } from "../dist/store.js";
import { Workspace } from "../dist/service.js";

// Uses the actual installed DSH runtime and a deterministic local LLM adapter.
// No credentials, paid model requests, browser task automation or SMTP calls.
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
try {
  await run("& $env:DSH_COMMAND plugin --profile web add $env:RG_PACKAGE", {
    RG_PACKAGE: `link:${root}`,
  });
  store = new Store(env.RESUME_AGENT_HOME);
  const workspace = new Workspace(store);
  const file = join(home, "演示简历.txt");
  await writeFile(file, "演示用户\n项目经历\n- 负责 Go API 开发与测试。");
  const resume = await workspace.importResume(file),
    job = workspace.addJob({
      company: "演示公司",
      role: "Go 开发",
      jd: "演示公司招聘 Go 开发，负责 Go API 开发与测试。",
      sourceUrl: "https://example.com/jobs/native",
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
 export async function apply(ctx){await ctx.workspaceRegistry.create(${JSON.stringify(home)},'演示求职');const seen=new Set();const adapter={providerInfo:p=>({id:p,name:'本地验证（不调用模型）'}),providerRetryPolicy:()=>undefined,imageRequestPricing:()=>undefined,listModels:async p=>[{provider:p,id:'local',name:'本地验证（不调用模型）'}],resolveModel:async(p,m)=>({provider:p,id:m,name:'本地验证（不调用模型）',inputModalities:['text']}),async prepareCall(p,m){return{model:await this.resolveModel(p,m),stream:o=>this.stream(o)}},async *stream(options){options.signal?.throwIfAborted();if(!seen.has(options.sessionId)){seen.add(options.sessionId);const block={type:'tool-call',id:'native-review-1',name:'resume_grill_propose_resume_changes',arguments:${JSON.stringify(JSON.stringify(args))}};yield{type:'block-start',index:0,blockType:'tool-call'};yield{type:'tool-call-delta',index:0,id:block.id,name:block.name,argumentsDelta:block.arguments};yield{type:'block-end',index:0,block};yield{type:'finish',reason:{kind:'tool-calls'}}}else{yield{type:'block-start',index:0,blockType:'text'};yield{type:'text-delta',index:0,text:'请在上面的求职卡片中核对。'};yield{type:'block-end',index:0,block:{type:'text',text:'请在上面的求职卡片中核对。'}};yield{type:'finish',reason:{kind:'stop'}}}}};ctx.effect(()=>ctx.llm.registerAdapter(['resume-native-test'],adapter));}
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
  await input.fill("验证原生求职卡片，不发送邮件。");
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
  await page.getByText("hr@example.com", { exact: true }).waitFor();
  assert.equal(workspace.history().length, 1, "重放卡片不得产生重复投递");
  await page.setViewportSize({ width: 430, height: 900 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: join(output, "dsh-native-mobile.png"),
    fullPage: true,
  });
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
  await page.getByText("插件", { exact: true }).first().click();
  await page.getByText("求职助手", { exact: true }).first().waitFor();
  console.log(
    JSON.stringify({
      passed: true,
      runtime: "installed DSH",
      model: "deterministic local test adapter; zero external model calls",
      verified:
        "installed bundle → native tool → persisted metadata → React card → human command → PDF/mail → attachment check → replay; no mail sent",
      screenshots: output,
    }),
  );
} catch (error) {
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
