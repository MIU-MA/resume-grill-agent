import { chromium } from "playwright-core";
import { createServer } from "node:https";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { Store } from "../../dist/infrastructure/sqlite-store.js";
import { Workspace } from "../../dist/core/workspace.js";
import { ResumeProfiles } from "../../dist/core/resume-profiles.js";

// Actual DSH + official Chrome DevTools MCP + an HTTPS form with a real upload
// endpoint. Deterministic local model; no personal data, paid model or submission.
const command = process.env.DSH_COMMAND;
assert.ok(command, "设置 DSH_COMMAND。");
const home = await mkdtemp(join(tmpdir(), "resume-form-browser-"));
const output = resolve(".resume-agent/verification");
const env = {
  ...process.env,
  DSH_HOME: join(home, "dsh"),
  RESUME_AGENT_HOME: join(home, "data"),
  RESUME_ALLOW_SEND: "0",
  RESUME_SMTP_CODE: "",
  RESUME_SMTP_ADDRESS: "",
};
let browser,
  child,
  store,
  server,
  log = "",
  uploads = 0,
  submissions = 0,
  uploaded = Buffer.alloc(0);
const run = (cmd, args, extra = {}) =>
  new Promise((done, reject) => {
    const p = spawn(cmd, args, {
      env: { ...env, ...extra },
      cwd: resolve("."),
      windowsHide: true,
    });
    let text = "";
    p.stdout.on("data", (b) => (text += b));
    p.stderr.on("data", (b) => (text += b));
    p.on("error", reject);
    p.on("exit", (code) => (code === 0 ? done(text) : reject(new Error(text))));
  });
try {
  await mkdir(output, { recursive: true });
  await run(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "& $env:DSH_COMMAND plugin --profile web add $env:RG_PACKAGE",
    ],
    { DSH_COMMAND: command, RG_PACKAGE: `link:${resolve(".")}` },
  );
  await run(
    process.env.RESUME_TEST_OPENSSL ??
      "C:/Program Files/Git/usr/bin/openssl.exe",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(home, "key.pem"),
      "-out",
      join(home, "cert.pem"),
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
    ],
  );
  const html = `<!doctype html><html lang="zh"><meta charset="utf-8"><title>招聘表单验证（演示数据）</title><style>body{font:16px sans-serif;max-width:800px;margin:36px auto}label{display:block;margin:20px 0}input,select,textarea{display:block;padding:8px;min-width:280px}input[type=checkbox]{display:inline;min-width:0}</style><h1>招聘申请 · 验证页面</h1>
  <form id="application"><label>姓名<input name="name" required></label><label>手机<input name="phone" type="tel" required></label><label>邮箱<input name="email" type="email" required></label><label>学校<input name="school"></label><label>学历<select name="degree"><option value="">请选择</option><option>本科</option><option>硕士</option></select></label><label>项目经历<textarea name="project"></textarea></label><label>毕业日期<input name="graduation" type="date"></label><label>简历附件<input type="file" name="resume" accept=".pdf"></label><p id="upload-status" role="status">尚未上传附件</p><label><input name="consent" type="checkbox" required>我同意信息处理声明</label><button type="submit">提交申请</button></form>
  <script>const form=document.querySelector('form');form.onsubmit=async e=>{e.preventDefault();await fetch('/submit',{method:'POST'});};form.elements.resume.onchange=async e=>{const data=new FormData();data.append('resume',e.target.files[0]);const response=await fetch('/attachment',{method:'POST',body:data});if(response.ok)document.querySelector('#upload-status').textContent='附件已上传：'+e.target.files[0].name;};</script></html>`;
  server = createServer(
    {
      key: await readFile(join(home, "key.pem")),
      cert: await readFile(join(home, "cert.pem")),
    },
    async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      if (req.url === "/attachment" && req.method === "POST") {
        uploads++;
        uploaded = Buffer.concat(chunks);
        res.end("ok");
        return;
      }
      if (req.url === "/submit") {
        submissions++;
        res.end("unexpected submission");
        return;
      }
      res.setHeader("content-type", "text/html;charset=utf-8");
      res.end(html);
    },
  );
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(443, "127.0.0.1", done);
  });
  const formUrl = "https://127.0.0.1/apply";
  store = new Store(env.RESUME_AGENT_HOME);
  const workspace = new Workspace(store);
  const resume = await workspace.createResume(
    "演示简历.pdf",
    "姓名：演示用户\n手机：13800000000\n邮箱：demo@example.com\n教育经历\n学校：示例大学\n学历：本科\n项目经历\nGo 工具 | 开发 2026.01 - 至今\n参与 Go API 开发与测试。",
  );
  const job = workspace.addJob({
    company: "表单验证",
    role: "Go 开发",
    jd: "Go API 开发与测试",
    sourceUrl: formUrl,
  });
  const fixture = join(home, "model.mjs");
  await writeFile(
    fixture,
    `import fs from 'node:fs';export const name='form-test';export const inject=['llm','workspaceRegistry'];export async function apply(ctx){await ctx.workspaceRegistry.create(${JSON.stringify(home)},'官网填写验证');const counts=new Map();const state={};const adapter={providerInfo:p=>({id:p,name:'本地表单验证'}),providerRetryPolicy:()=>undefined,imageRequestPricing:()=>undefined,listModels:async p=>[{provider:p,id:'local',name:'本地表单验证'}],resolveModel:async(p,m)=>({provider:p,id:m,name:'本地表单验证',inputModalities:['text']}),async prepareCall(p,m){return {model:await this.resolveModel(p,m),stream:o=>this.stream(o)}},async *stream(options){const step=counts.get(options.sessionId)||0;counts.set(options.sessionId,step+1);fs.writeFileSync(${JSON.stringify(join(home, "last-request.json"))},JSON.stringify(options.messages,null,2));const texts=options.messages.filter(m=>m.role==='tool').flatMap(m=>m.content).filter(p=>p.type==='text').map(p=>p.text);const latest=texts.at(-1)||'';let name,args;
if(step===0){name='resume_grill_application_form_context';args={resumeId:${JSON.stringify(resume.id)},jobId:${JSON.stringify(job.id)}}};
if(step===1){state.context=JSON.parse(latest);name='resume_grill_start_form_run';args={resumeId:state.context.resumeId,jobId:state.context.jobId}};
if(step===2){state.run=JSON.parse(latest);name='mcp__recruiting_browser__new_page';args={url:state.context.url}};
if(step===3){state.pageId=Number(latest.match(/(?:^|\\n)(\\d+):.*\\[selected\\]/)?.[1]);if(!state.pageId)throw new Error('没有实际 pageId '+latest);name='mcp__recruiting_browser__take_snapshot';args={pageId:state.pageId}};
if(step===4){state.snapshot=latest;const lines=latest.split('\\n');const field=(label,type='text',required=false)=>{const line=lines.find(l=>l.includes('"'+label+'"')&&/textbox|combobox|button|checkbox/.test(l));if(!line)throw new Error('字段缺失 '+label);return{uid:line.match(/uid=(\\S+)/)[1],label,type,required,value:line.match(/value="([^"]*)"/)?.[1]||'',...(type==='select'?{options:lines.filter(l=>l.includes('option "')).map(l=>l.match(/option "([^"]+)"/)[1])}:{})}};name='resume_grill_plan_form_fill';args={runId:state.run.id,url:state.context.url,fields:[field('姓名','text',true),field('手机','text',true),field('邮箱','text',true),field('学校'),field('学历','select'),field('项目经历','textarea'),field('简历附件','file'),field('我同意信息处理声明','checkbox',true)]}};
if(step===5){state.plan=JSON.parse(latest);name='mcp__recruiting_browser__fill_form';args={pageId:state.pageId,elements:state.plan.actions.filter(a=>a.write).map(a=>({uid:a.uid,value:a.value})),includeSnapshot:true}};
if(step===6){name='mcp__recruiting_browser__upload_file';args={pageId:state.pageId,uid:state.plan.uploads[0].uid,filePaths:[state.plan.uploads[0].path],includeSnapshot:true}};
if(step===7){name='mcp__recruiting_browser__take_snapshot';args={pageId:state.pageId}};
if(step===8){const lines=latest.split('\\n');name='resume_grill_verify_form_fill';args={runId:state.run.id,url:state.context.url,values:state.plan.actions.map(a=>{const line=lines.find(l=>l.includes('uid='+a.uid+' '))||'';return{uid:a.uid,value:line.match(/value="([^"]*)"/)?.[1]||''}}),uploadedName:latest.match(/附件已上传：([^"\\n]+)/)?.[1]}};
if(name){const block={type:'tool-call',id:'form-'+step,name,arguments:JSON.stringify(args)};yield{type:'block-start',index:0,blockType:'tool-call'};yield{type:'tool-call-delta',index:0,id:block.id,name,argumentsDelta:block.arguments};yield{type:'block-end',index:0,block};yield{type:'finish',reason:{kind:'tool-calls'}}}else{const text='字段和附件已回读核对。毕业日期未提供，保持空白；未勾选声明，未提交申请。';yield{type:'block-start',index:0,blockType:'text'};yield{type:'text-delta',index:0,text};yield{type:'block-end',index:0,block:{type:'text',text}};yield{type:'finish',reason:{kind:'stop'}}}}};ctx.effect(()=>ctx.llm.registerAdapter(['form-test'],adapter));}`,
  );
  await run(process.execPath, ["--check", fixture]);
  const patch = join(home, "patch.yml");
  await writeFile(
    patch,
    `- id: agent-default-model\n  config:\n    provider: form-test\n    model: local\n- id: session-title-llm\n  disabled: true\n- insert:\n    - id: form-test\n      name: ${JSON.stringify(pathToFileURL(fixture).href)}\n    - id: recruiting-browser\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        serverName: recruiting_browser\n        transport: stdio\n        command: ${JSON.stringify(process.execPath)}\n        args: ${JSON.stringify([resolve("node_modules/chrome-devtools-mcp/out/Default/gen/src/bin/chrome-devtools-mcp.js"), "--headless", "--isolated", "--workspace=" + env.RESUME_AGENT_HOME, "--executablePath=" + (process.env.RESUME_BROWSER_EXECUTABLE ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"), "--no-usage-statistics", "--no-performance-crux", "--no-javascript-evaluation", "--no-category-emulation", "--no-category-performance", "--no-category-network", "--no-category-memory", "--chromeArg=--ignore-certificate-errors"])}\n        failOnStartupError: true\n        toolCallTimeoutMs: 60000\n`,
  );
  child = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "& $env:DSH_COMMAND --profile web --patch $env:RG_PATCH --no-open --port 0",
    ],
    {
      env: { ...env, DSH_COMMAND: command, RG_PATCH: patch },
      windowsHide: true,
    },
  );
  child.stdout.on("data", (b) => (log += b));
  child.stderr.on("data", (b) => (log += b));
  let address;
  for (let i = 0; i < 200; i++) {
    address = log.match(/dsh web: (http:\/\/[^\s]+)/)?.[1];
    if (address) break;
    if (child.exitCode !== null) throw new Error(log);
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(address, log);
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await page.goto(address);
  const welcome = page.getByRole("button", { name: "继续", exact: true });
  if (
    await welcome
      .waitFor({ timeout: 10000 })
      .then(() => true)
      .catch(() => false)
  )
    await welcome.click();
  await page.getByText("官网填写验证", { exact: true }).first().click();
  await page.getByRole("button", { name: "求职工作台", exact: true }).click();
  const full = page
    .locator('[data-global-panel="true"]')
    .getByRole("region", { name: "求职工作台", exact: true });
  await full.getByRole("button", { name: "招聘官网", exact: true }).click();
  await full.getByRole("button", { name: "核对简历", exact: true }).click();
  await full
    .getByRole("button", { name: "解析简历并核对资料", exact: true })
    .click();
  await full.getByLabel("资料-姓名", { exact: true }).waitFor();
  assert.equal(
    await full.getByLabel("资料-姓名", { exact: true }).inputValue(),
    "演示用户",
  );
  await full
    .getByRole("button", { name: "确认并保存资料", exact: true })
    .click();
  await full.getByRole("button", { name: "回到当前岗位", exact: true }).click();
  await full
    .getByRole("button", { name: "开始官网代填", exact: true })
    .click();
  // Browser work remains in the normal model/tool conversation.
  await page.getByText("官网填写验证", { exact: true }).first().click();
  await page
    .getByText(
      "字段和附件已回读核对。毕业日期未提供，保持空白；未勾选声明，未提交申请。",
      { exact: true },
    )
    .waitFor({ timeout: 90000 });
  assert.equal(uploads, 1, "必须实际向表单上传端点传输附件");
  assert.ok(
    uploaded.includes(await readFile(resume.pdf)),
    "实际上传内容必须是所选简历的 PDF 字节",
  );
  assert.equal(submissions, 0);
  const task = store.list("form-run")[0];
  assert.equal(task.status, "needs_input");
  assert.equal(task.checks.filter((c) => c.status === "matched").length, 7);
  assert.ok(task.issues.some((i) => i.label.includes("同意")));
  assert.equal(workspace.history().length, 0);
  const messages = JSON.parse(
    await readFile(join(home, "last-request.json"), "utf8"),
  );
  const snapshots = messages
    .filter((m) => m.role === "tool")
    .flatMap((m) => m.content)
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .filter((t) => t.includes("Latest page snapshot"));
  const final = snapshots.at(-1);
  for (const value of [
    "演示用户",
    "13800000000",
    "demo@example.com",
    "示例大学",
    "参与 Go API 开发与测试。",
    "附件已上传",
  ])
    assert.ok(final.includes(value), value);
  assert.ok(!/checkbox.*checked/.test(final), "不能代勾同意声明");
  await writeFile(join(output, "dsh-browser-form-snapshot.txt"), final);
  await page.screenshot({
    path: join(output, "dsh-browser-conversation.png"),
    fullPage: true,
  });
  console.log(
    JSON.stringify({
      passed: true,
      runtime: "installed DSH + Chrome DevTools MCP 1.13.0",
      uploads,
      submissions,
      mailRecords: workspace.history().length,
      model: "deterministic local adapter",
      form: "controlled HTTPS form; not a company submission",
    }),
  );
} catch (error) {
  const fixtureText = await readFile(join(home, "model.mjs"), "utf8").catch(
    () => "",
  );
  if (fixtureText)
    await writeFile(join(output, "dsh-browser-test-model.mjs"), fixtureText);
  console.error(log.replace(/\?token=[^\s]+/g, "?token=[redacted]"));
  if (browser) {
    const page = browser.contexts()[0]?.pages()[0];
    if (page) {
      console.error((await page.locator("body").innerText()).slice(-7000));
      await page
        .screenshot({
          path: join(output, "dsh-browser-failure.png"),
          fullPage: true,
        })
        .catch(() => {});
    }
  }
  const request = await readFile(join(home, "last-request.json"), "utf8").catch(
    () => "",
  );
  if (request)
    await writeFile(join(output, "dsh-browser-last-request.json"), request);
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
  if (server) await new Promise((done) => server.close(done));
  store?.close();
  if (
    dirname(home) === tmpdir() &&
    basename(home).startsWith("resume-form-browser-")
  )
    await rm(home, {
      recursive: true,
      force: true,
      maxRetries: 6,
      retryDelay: 500,
    });
}
