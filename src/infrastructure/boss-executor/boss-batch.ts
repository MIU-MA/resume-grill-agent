import { randomBytes, createHash } from "node:crypto";
import { mkdir, open, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BossBrowserReader } from "./boss-reader.js";
import { createBrowserBatch, validateBrowserBatch } from "./browser-batch.js";
import { runApplicationQueue } from "./application-queue.js";
import { createBossDeliveryAdapter } from "./boss-delivery-adapter.js";
import type {
  BrowserRun,
  SimulationBatch,
} from "../../domain/browser-application.js";
type Page = Parameters<Parameters<BossBrowserReader["withJobPage"]>[2]>[0];
type Context = { browser: BossBrowserReader; source: Page };
export function createBossBatch(
  directory: string,
  current: () => Context | undefined,
  onRunning: (running: boolean) => void,
) {
  const previews = new Map<
    string,
    {
      batch: SimulationBatch;
      context: Context;
      expires: number;
      started?: Promise<BrowserRun>;
    }
  >();
  const contexts = new Map<string, Context>();
  let live: ReturnType<typeof createBossDeliveryAdapter> | undefined;
  const claims = join(directory, "contact-claims");
  const claimKey = (url: string) =>
    createHash("sha256").update(url).digest("hex");
  const claimContact = async (url: string) => {
    await mkdir(claims, { recursive: true });
    // A successful exclusive create survives a crash after the browser click.
    // It also serializes contact across executors sharing this directory.
    const file = await open(join(claims, claimKey(url)), "wx", 0o600).catch(
      (error) => {
        if (error.code === "EEXIST")
          throw new Error("本机已有该岗位的联系记录，未再次沟通");
        throw error;
      },
    );
    await file.close();
  };
  const manager = createBrowserBatch(directory, {
    mode: "boss",
    tasks: (batch) =>
      batch.jobs.map((job, index) => ({
        ...job,
        state: "queued",
        steps: [
          {
            id: `${index}:contact`,
            kind: "contact",
            value: job.url,
            state: "pending",
          },
          {
            id: `${index}:text`,
            kind: "greeting",
            value: job.greeting,
            state: "pending",
          },
          ...batch.images.map((image, number) => ({
            id: `${index}:image:${number}`,
            kind: "image" as const,
            value: image.sha256,
            state: "pending" as const,
          })),
        ],
      })),
    execute: async (batch, run, save, stopped) => {
      const context = contexts.get(batch.id);
      contexts.delete(batch.id);
      const files = new Map<string, string>();
      try {
        if (!context || !context.browser.isConnected())
          throw new Error("批次对应的浏览器连接已结束，未执行");
        const isBlocked = await blockedContacts();
        if (run.tasks.some((task) => isBlocked(task.url)))
          throw new Error("其他批次已联系其中岗位，未重复发送，请重新核对");
        const folder = join(directory, batch.id, "images");
        await mkdir(folder, { recursive: true });
        for (const [index, image] of batch.images.entries()) {
          const path = join(
            folder,
            `${index}.${image.type === "image/png" ? "png" : "jpg"}`,
          );
          await writeFile(path, Buffer.from(image.base64, "base64"), {
            mode: 0o600,
          });
          context.browser.approveImage(path);
          files.set(image.sha256, path);
        }
        live = createBossDeliveryAdapter(
          context.browser,
          context.source,
          files,
          claimContact,
        );
        await runApplicationQueue(run, live.adapter, save, stopped);
      } finally {
        try {
          await live?.close();
        } finally {
          live = undefined;
          for (const path of files.values()) context?.browser.revokeImage(path);
          onRunning(false);
        }
      }
    },
  });
  const blockedContacts = async () => {
    const urls = new Set<string>();
    for (const name of await readdir(directory).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    )) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      const saved = JSON.parse(
        await readFile(join(directory, name), "utf8"),
      ) as { run: BrowserRun };
      for (const task of saved.run.tasks)
        if (
          task.state === "verified" ||
          task.state === "uncertain" ||
          task.steps.some((step) => step.state !== "pending")
        )
          urls.add(task.url);
    }
    const ids = new Set(
      await readdir(claims).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      }),
    );
    return (url: string) => urls.has(url) || ids.has(claimKey(url));
  };
  return {
    async preview(value: unknown) {
      const context = current();
      if (!context || !context.browser.isConnected())
        throw new Error("请先连接已登录的 BOSS 浏览器");
      const batch = validateBrowserBatch(value);
      const isBlocked = await blockedContacts();
      const skipped = batch.jobs
        .filter((job) => isBlocked(job.url))
        .map((job) => ({
          url: job.url,
          title: job.title,
          reason: "本机已有联系记录或待核对结果，已排除以避免重复联系",
        }));
      batch.jobs = batch.jobs.filter((job) => !isBlocked(job.url));
      if (!batch.jobs.length)
        throw new Error(
          "本批岗位均已有联系记录或待核对结果，请先检查投递记录。",
        );
      if (batch.jobs.length > 10)
        throw new Error("每批最多 10 个岗位，请减少勾选数量");
      if (batch.jobs.some((job) => !job.company.trim()))
        throw new Error("请先补齐岗位公司名称并核对 JD");
      for (const [key, entry] of previews)
        if (entry.expires < Date.now()) previews.delete(key);
      if (previews.size >= 30) throw new Error("待核对批次过多，请稍后重试");
      const id = randomBytes(16).toString("hex"),
        expiresAt = Date.now() + 120000;
      previews.set(id, { batch, context, expires: expiresAt });
      return {
        id,
        batchId: batch.id,
        expiresAt,
        greetingMode: "platform" as const,
        jobs: batch.jobs,
        skipped,
        images: batch.images.map(({ base64: _base64, ...image }) => image),
      };
    },
    async confirm(
      id: string,
      confirmed: boolean,
      defaultGreetingAccepted: boolean,
    ) {
      const value = previews.get(id);
      if (!value || !confirmed || !defaultGreetingAccepted)
        throw new Error("请先核对整批岗位、内容和图片，并确认官网默认招呼行为");
      if (value.started) return value.started;
      const context = current();
      if (
        value.expires < Date.now() ||
        !context ||
        context.browser !== value.context.browser ||
        context.source.browserContextId() !==
          value.context.source.browserContextId()
      )
        throw new Error("批次核对已过期或浏览器已变化，请重新核对");
      onRunning(true); // Reserve the browser before asynchronous journal reads.
      value.started = (async () => {
        const isBlocked = await blockedContacts();
        if (value.batch.jobs.some((job) => isBlocked(job.url)))
          throw new Error("其中的岗位已被其他批次联系，请重新核对批次");
        contexts.set(value.batch.id, value.context);
        const run = await manager.start(value.batch);
        // Replaying an existing run returns its snapshot without calling execute.
        if (contexts.delete(value.batch.id)) onRunning(false);
        return run;
      })().catch((error) => {
        contexts.delete(value.batch.id);
        onRunning(false);
        throw error;
      });
      return value.started;
    },
    recent: manager.recent,
    status: manager.status,
    stop: manager.stop,
    close: manager.close,
  };
}
