import { chromium } from "playwright-core";
import { resolve, join } from "node:path";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { Store } from "../../dist/infrastructure/sqlite-store.js";
import { Workspace } from "../../dist/core/workspace.js";
import { startPanel } from "../../dist/adapters/panel/server.js";

// Only inspect data produced by the separately authorized DSH verification task.
const home = resolve(
  process.env.RESUME_AGENT_HOME ?? ".resume-agent/dsh-verification",
);
const store = new Store(home),
  workspace = new Workspace(store);
const before = workspace.history();
assert.ok(before.length > 0, "先运行 DSH 求职流程验证");
assert.ok(before.every((item) => item.status === "prepared"));
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
  await page.getByRole("button", { name: /投递记录/ }).click();
  await page
    .getByRole("cell", { name: "hr@example.com", exact: true })
    .waitFor();
  await page.screenshot({
    path: join(output, "dsh-history.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "查看详情", exact: true })
    .first()
    .click();
  await page.locator(".pdf-pages[data-ready=true] canvas").waitFor();
  await page.getByText("DSH 插件验证（未发送）", { exact: true }).waitFor();
  await page.screenshot({
    path: join(output, "dsh-application.png"),
    fullPage: true,
  });
  const source = store.list("resume").find((item) => !item.parentId);
  await page
    .getByRole("button", { name: `${source.name} 原始简历`, exact: true })
    .click();
  await page.getByLabel("接受这条修改", { exact: true }).waitFor();
  assert.ok((await page.locator(".diff").textContent()).includes("参与测试"));
  await page.screenshot({
    path: join(output, "dsh-review.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(workspace.history(), before);
  assert.equal(
    store.db.prepare("SELECT COUNT(*) AS n FROM approvals").get().n,
    0,
  );
  console.log(
    JSON.stringify({
      passed: true,
      source: "DSH-produced SQLite records",
      checked:
        "proposal diff, actual PDF, email preview, history, zero approvals; no writes or mail",
      screenshots: output,
    }),
  );
} finally {
  await browser?.close();
  await panel.close();
  store.close();
}
