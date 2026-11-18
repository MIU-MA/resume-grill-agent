import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { BossGateway } from "../../dist/infrastructure/boss-gateway.js";
// Real executor HTTP/auth contract only. Never connects a browser or sends.
const root = process.env.RESUME_GRILL_ROOT;
assert.ok(root, "设置 RESUME_GRILL_ROOT 为网页项目的绝对目录。");
const { createBossPreview } = await import(
  pathToFileURL(resolve(root, "scripts/boss-preview.mjs")).href
);
const reserve = createServer();
await new Promise((r) => reserve.listen(0, "127.0.0.1", r));
const port = reserve.address().port;
await new Promise((r) => reserve.close(r));
const home = await mkdtemp(join(tmpdir(), "boss-contract-"));
let executor;
try {
  const log = console.log;
  console.log = () => {};
  try {
    executor = await createBossPreview({
      port,
      attach: "ego:",
      deferConnect: true,
      stream: false,
      deliveryDirectory: join(home, "batches"),
      simulationDirectory: join(home, "simulations"),
    });
  } finally {
    console.log = log;
  }
  const gateway = BossGateway.fromLink(
    `http://localhost:3000/boss#boss-origin=${encodeURIComponent(executor.origin)}&boss-token=${executor.token}`,
  );
  const state = await gateway.request("/status");
  assert.equal(state.ready, false);
  assert.equal(state.phase, "disconnected");
  assert.equal(state.browserConnected, false);
  assert.deepEqual(await gateway.request("/boss-batches"), []);
  assert.equal((await fetch(executor.origin + "/status")).status, 401);
  await assert.rejects(gateway.request("/jobs"));
  await assert.rejects(gateway.request("/boss-batch/preview", {}));
  assert.equal(executor.page, undefined);
  console.log(
    "真实执行器 HTTP 契约通过：鉴权、状态、历史与未连接阻断；浏览器未启动，投递次数为 0。",
  );
} finally {
  await executor?.close();
  assert.equal(dirname(resolve(home)), resolve(tmpdir()));
  assert.ok(basename(home).startsWith("boss-contract-"));
  await rm(home, { recursive: true, force: true });
}
