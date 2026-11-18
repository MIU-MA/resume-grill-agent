import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { join, resolve, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { BossExecutor } from "../../dist/infrastructure/boss-executor/index.js";

await access(
  new URL(
    "../../dist/infrastructure/boss-executor/ego-cdp-runtime.mjs",
    import.meta.url,
  ),
);
const home = await mkdtemp(join(tmpdir(), "boss-contract-"));
const executor = new BossExecutor(home, async () => {
  throw new Error("验证期间不应连接浏览器。");
});
try {
  assert.deepEqual(await executor.request("/status"), {
    ready: false,
    phase: "disconnected",
  });
  assert.deepEqual(await executor.request("/boss-batches"), []);
  await assert.rejects(executor.request("/jobs"), /先连接/);
  await assert.rejects(executor.request("/boss-batch/preview", {}), /先连接/);
  await assert.rejects(executor.request("/open"), /不支持/);
  console.log("内置执行器与运行时验证通过，未启动浏览器。");
} finally {
  await executor.close();
  assert.equal(dirname(resolve(home)), resolve(tmpdir()));
  assert.ok(basename(home).startsWith("boss-contract-"));
  await rm(home, { recursive: true, force: true });
}
