import { chromium } from "playwright-core";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import assert from "node:assert/strict";
import { Store } from "../../dist/infrastructure/sqlite-store.js";
import { Workspace } from "../../dist/core/workspace.js";
import { startPanel } from "../../dist/adapters/panel/server.js";

const home = await mkdtemp(join(tmpdir(), "resume-panel-browser-")),
  store = new Store(home),
  workspace = new Workspace(store);
const panel = await startPanel(workspace, 0);
let browser;
const output = resolve(".resume-agent/verification");
await mkdir(output, { recursive: true });
try {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({
    viewport: { width: 1500, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(panel.url);
  await page.waitForFunction(() => location.hash === "");
  await page.getByLabel("导入简历", { exact: true }).setInputFiles({
    name: "演示简历.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("演示用户\n项目经历\n- 负责 Go API 开发与测试。"),
  });
  await page.getByText("简历已导入", { exact: true }).waitFor();
  await page.getByRole("button", { name: "添加岗位", exact: true }).click();
  await page.getByLabel("岗位名称", { exact: true }).fill("Go 开发");
  await page.getByLabel("公司", { exact: true }).fill("示例公司");
  await page
    .getByLabel("来源链接", { exact: true })
    .fill("https://example.com/jobs/demo");
  await page
    .getByLabel("招聘邮箱（可选）", { exact: true })
    .fill("hr@example.com");
  await page
    .getByLabel("岗位描述", { exact: true })
    .fill("示例公司招聘 Go 开发，负责 Go API 开发与测试。");
  await page.getByRole("button", { name: "保存岗位", exact: true }).click();
  await page.getByRole("button", { name: "Go 开发 示例公司" }).waitFor();
  const resume = store.list("resume")[0],
    job = store.list("job")[0],
    context = workspace.reviewContext(resume.id, job.id);
  const section = context.sections.find((s) =>
      s.lines.some((line) => line.includes("Go")),
    ),
    lineIndex = section.lines.findIndex((line) => line.includes("Go"));
  workspace.propose(resume.id, job.id, {
    company: job.company,
    role: job.role,
    sectionOrder: context.sections.map((s) => s.id),
    changes: [
      {
        sectionId: section.id,
        lineIndex,
        after: "- 负责 Go API 开发，参与测试。",
        requirement: "Go API 开发与测试",
        reason: "写清测试职责。",
      },
    ],
    highlights: [],
    gaps: [],
  });
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await page.getByText("接受这条修改", { exact: true }).waitFor();
  await page.getByLabel("接受这条修改", { exact: true }).check();
  await page
    .getByRole("button", { name: "保存选中的修改并生成 PDF", exact: true })
    .click();
  await page
    .getByText("岗位版已保存，请先核对 PDF，再准备投递。", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "生成投递预览", exact: true }).click();
  await page.getByText("确认并真实发送", { exact: true }).waitFor();
  await page.locator(".pdf-pages[data-ready=true] canvas").waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "确认并真实发送", exact: true })
      .isDisabled(),
    true,
  );
  await page.screenshot({
    path: join(output, "panel-desktop.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "仅检查附件，不发信", exact: true })
    .click();
  await page
    .getByText("附件检查通过，没有发送邮件。", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: /投递记录/ }).click();
  await page
    .getByRole("cell", { name: "仅检查，未发送", exact: true })
    .waitFor();
  await page.screenshot({
    path: join(output, "panel-history.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "准备投递", exact: true }).click();
  await page.waitForFunction(() => {
    const host = document.querySelector(".pdf-pages");
    const canvas = host?.querySelector("canvas");
    return (
      host?.dataset.ready === "true" &&
      canvas &&
      Math.abs(
        canvas.width -
          (host.clientWidth - 2) * Math.min(devicePixelRatio || 1, 2),
      ) < 3
    );
  });
  await page.locator(".pdf-pages[data-ready=true] canvas").waitFor();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: join(output, "panel-mobile.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  assert.equal(workspace.history()[0].status, "simulated");
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.getByRole("button", { name: "求职任务", exact: true }).click();
  await page.getByLabel("岗位方向", { exact: true }).fill("Go");
  await page.getByRole("button", { name: "保存目标", exact: true }).click();
  await page.locator(".candidate").waitFor();
  const goal = store.list("goal")[0];
  // A browser-imported job must remain visible after a prior discovery run.
  store.put("search", {
    id: "browser-test-search",
    goalId: goal.id,
    createdAt: Date.now(),
    status: "complete",
    candidates: [
      { jobId: job.id, reasons: [], locationVerified: true, emailReady: true },
    ],
    sources: [],
    notes: [],
  });
  const noEmail = workspace.addJob({
    company: "另一个示例",
    role: "Go 数据服务",
    jd: "负责 Go API 开发与测试。",
    sourceUrl: "https://example.com/jobs/no-email",
  });
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  const reviewed = page
    .locator(".candidate")
    .filter({ hasText: "Go 开发 · 示例公司" });
  const blocked = page
    .locator(".candidate")
    .filter({ hasText: "Go 数据服务 · 另一个示例" });
  await blocked.waitFor();
  await reviewed.getByLabel("接受这条修改", { exact: true }).check();
  // Replacement proposal uses the same paragraph key; prior consent cannot carry over.
  const previous = store.list("proposal")[0];
  workspace.propose(resume.id, job.id, {
    ...previous.plan,
    changes: previous.plan.changes.map((change) => ({
      ...change,
      after: "- 参与 Go API 开发与测试。",
    })),
  });
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await page.getByText("- 参与 Go API 开发与测试。", { exact: true }).waitFor();
  assert.equal(
    await reviewed.getByLabel("接受这条修改", { exact: true }).isChecked(),
    false,
  );
  await reviewed.getByLabel("接受这条修改", { exact: true }).check();
  await reviewed
    .getByRole("checkbox", { name: "Go 开发 · 示例公司", exact: true })
    .check();
  await blocked
    .getByRole("checkbox", { name: "Go 数据服务 · 另一个示例", exact: true })
    .check();
  await blocked
    .getByLabel("这份岗位简历保留原文，不接受修改", { exact: true })
    .check();
  await page
    .getByRole("button", { name: "准备所选 2 个岗位", exact: true })
    .click();
  await page.getByText("简历与邮件已准备", { exact: true }).waitFor();
  await page
    .getByText("尚无明确招聘邮箱；需核对投递渠道，不猜测邮箱。", {
      exact: true,
    })
    .waitFor();
  const taskBatch = store.list("batch")[0];
  assert.equal(
    taskBatch.items.find((item) => item.jobId === noEmail.id).status,
    "blocked",
  );
  assert.equal(
    workspace.preview(
      taskBatch.items.find((item) => item.applicationId).applicationId,
    ).status,
    "prepared",
  );
  assert.equal(
    store.db.prepare("SELECT COUNT(*) AS n FROM approvals").get().n,
    0,
  );
  await page.screenshot({
    path: join(output, "panel-goals.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: join(output, "panel-goals-mobile.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "核对邮件与附件", exact: true })
    .click();
  await page.getByText("确认并真实发送", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      screenshots: output,
      steps:
        "import → JD → host proposal → PDF → preview → attachment check → history; saved goal → imported candidates → replaced proposal clears consent → batch PDF/mail + missing email blocker → preview; no mail sent",
    }),
  );
} finally {
  await browser?.close();
  await panel.close();
  store.close();
  if (
    dirname(home) === tmpdir() &&
    basename(home).startsWith("resume-panel-browser-")
  )
    await rm(home, { recursive: true, force: true, maxRetries: 5 });
}
