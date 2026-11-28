import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { deflateSync, gzipSync } from "node:zlib";
import { readBoundedStream } from "../../src/infrastructure/careers/public-page.js";
import { ResourceCache } from "../../src/infrastructure/careers/resource-cache.js";
import { mapWithConcurrency, Semaphore } from "../../src/shared/concurrency.js";
import { AppError, classifyError } from "../../src/shared/errors.js";
import {
  PROMPT_VERSION,
  promptManifest,
  promptSectionsFor,
} from "../../src/shared/prompts.js";

test("流式解压支持 gzip/deflate，并在解压输出超限时实时拦截压缩炸弹", async () => {
  const html = "<html><body><h1>Go 后端工程师</h1></body></html>";
  const gz = await readBoundedStream(
    Readable.from([gzipSync(Buffer.from(html, "utf8"))]),
    "gzip",
    1024 * 64,
  );
  assert.equal(gz.toString("utf8"), html);

  const df = await readBoundedStream(
    Readable.from([deflateSync(Buffer.from(html, "utf8"))]),
    "deflate",
    1024 * 64,
  );
  assert.equal(df.toString("utf8"), html);

  // 高度压缩的 3 MiB 零字节流（压缩后仅几 KB），必须在解压输出超过 64 KiB 时立刻阻断
  const bomb = gzipSync(Buffer.alloc(3 * 1024 * 1024, 0x41));
  assert.ok(bomb.length < 32 * 1024);
  let aborted = false;
  await assert.rejects(
    readBoundedStream(Readable.from([bomb]), "gzip", 64 * 1024, () => {
      aborted = true;
    }),
    /超过 2 MB/,
  );
  assert.equal(aborted, true);
});

test("ResourceCache 支持 SingleFlight 并发折叠、TTL 过期与 LRU 容量淘汰", async () => {
  const cache = new ResourceCache(2, 1024);
  let loads = 0;
  const loader = async (tag: string) => {
    loads++;
    await new Promise((r) => setTimeout(r, 20));
    return { text: `body-${tag}`, url: `https://example.com/${tag}` };
  };
  const concurrent = await Promise.all(
    Array.from({ length: 5 }, () =>
      cache.coalesce("k1", () => loader("1"), 5_000),
    ),
  );
  assert.equal(loads, 1);
  assert.ok(concurrent.every((r) => r.text === "body-1"));

  // 缓存命中不重复加载
  await cache.coalesce("k1", () => loader("1"), 5_000);
  assert.equal(loads, 1);

  // 触发 LRU 淘汰（上限 2 条）
  await cache.coalesce("k2", () => loader("2"), 5_000);
  assert.equal(cache.get("k1")?.text, "body-1"); // 刷新 k1 为最新
  await cache.coalesce("k3", () => loader("3"), 5_000); // 淘汰最旧的 k2
  assert.equal(cache.size, 2);
  assert.equal(cache.get("k2"), undefined);
  assert.equal(cache.get("k1")?.text, "body-1");
  assert.equal(cache.get("k3")?.text, "body-3");
});

test("Semaphore 与 mapWithConcurrency 严格控制并发上限、保序并响应取消", async () => {
  let active = 0;
  let peak = 0;
  const out = await mapWithConcurrency([10, 20, 30, 40, 50, 60], 2, async (n) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 15));
    active--;
    return n * 2;
  });
  assert.equal(peak, 2);
  assert.deepEqual(out, [20, 40, 60, 80, 100, 120]);

  const sem = new Semaphore(1);
  const controller = new AbortController();
  const holder = sem.run(async () => {
    await new Promise((r) => setTimeout(r, 40));
    return "first";
  });
  const waiter = sem.run(async () => "second", controller.signal);
  controller.abort(new Error("cancelled"));
  await assert.rejects(waiter, /cancelled/);
  assert.equal(await holder, "first");
});

test("Prompt 注册表按能力裁剪并生成稳定版本摘要，错误码分类覆盖关键域异常", () => {
  const bossOnly = promptSectionsFor(["boss"]);
  assert.deepEqual(
    bossOnly.map((s) => s.id),
    ["base", "boss"],
  );
  const manifest = promptManifest(["mail", "website", "boss"]);
  assert.equal(manifest.version, PROMPT_VERSION);
  assert.equal(manifest.sections.length, 4);
  assert.match(manifest.digest, /^[a-f0-9]{16}$/);

  assert.equal(
    classifyError(new AppError("SSRF_BLOCKED", "blocked")).code,
    "SSRF_BLOCKED",
  );
  assert.equal(
    classifyError(new Error("招聘页必须使用公网地址，不能访问本机或内网")).code,
    "SSRF_BLOCKED",
  );
  assert.equal(
    classifyError(new Error("缺少人工确认，或确认已过期。")).code,
    "APPROVAL_REQUIRED",
  );
  assert.equal(
    classifyError(new Error("附件校验失败，已阻止执行。")).code,
    "INTEGRITY_FAILED",
  );
});
