import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { z } from "zod";
import {
  bossBrowserChoice,
  bossUrl,
  type BossBrowserBackend,
  type BossBrowserChoice,
} from "../../domain/boss.js";
import type { BossJob, BossJobRead } from "../../domain/boss-search.js";
import { BossBrowserReader } from "./boss-reader.js";
import { createBossBatch } from "./boss-batch.js";
import { inspectBossDetail } from "./boss-inspection.js";
import { BossDetailError } from "../../domain/boss-inspection.js";
import { readBossJobList } from "./boss-job-list.js";

type Page = NonNullable<Awaited<ReturnType<BossBrowserReader["openBossPage"]>>>;
const messages = {
  loading: "BOSS 正在加载岗位，请稍后读取。",
  empty: "当前没有符合条件的岗位。",
  login: "请在浏览器登录后，回到工作台读取当前列表。",
  verification: "请在浏览器完成 BOSS 验证，再读取当前列表。",
  unsupported: "没有识别到岗位列表，请在浏览器打开 BOSS 搜索结果页。",
};
const navigationInterruption =
  /execution context|context with specified id|aborted by navigation|inspected target navigated/i;
const autoBackends: BossBrowserBackend[] = ["ego", "edge", "chrome"];
const browserNames = {
  ego: "ego",
  edge: "Microsoft Edge",
  chrome: "Google Chrome",
};

export class BossExecutor {
  private browser?: BossBrowserReader;
  private page?: Page;
  private pageSessionId?: string;
  private busy = false;
  private running = false;
  private closing = false;
  private pending?: Promise<unknown>;
  private startingBatch?: Promise<unknown>;
  private lastRead?: {
    id: string;
    address: string;
    jobs: BossJob[];
  };
  private readonly batches;
  private backend?: BossBrowserBackend;

  constructor(
    directory: string,
    private readonly openBrowser = (backend: BossBrowserBackend) =>
      BossBrowserReader.connect(backend, join(directory, "browser", backend)),
  ) {
    this.batches = createBossBatch(
      directory,
      () =>
        !this.closing &&
        !this.busy &&
        !this.running &&
        this.browser &&
        this.ready &&
        this.page
          ? { browser: this.browser, source: this.page }
          : undefined,
      (running) => {
        this.running = running;
      },
    );
  }

  get ready() {
    return (
      !this.closing &&
      !!this.browser?.isConnected() &&
      !!this.page &&
      !this.page.isClosed()
    );
  }

  get browserSessionId() {
    return this.ready ? this.pageSessionId : undefined;
  }

  private async exclusive<T>(run: () => Promise<T>) {
    if (this.closing || this.busy || this.running)
      throw new Error("当前有 BOSS 操作正在进行，请等待完成或先暂停批次。");
    this.busy = true;
    const promise = Promise.resolve().then(run);
    this.pending = promise;
    try {
      return await promise;
    } finally {
      this.pending = undefined;
      this.busy = false;
    }
  }

  async connectBrowser(choice: BossBrowserChoice, preferred?: BossBrowserChoice) {
    return this.exclusive(async () => {
      const current = this.browser?.isConnected() &&
        (choice === "auto" || this.backend === choice)
        ? this.browser
        : undefined;
      if (current && this.ready) return { ok: true };

      const next = current ? undefined : await this.launchBrowser(choice, preferred);
      // Keep an active session until the new browser has opened BOSS.
      if (next && !this.ready) await this.replaceBrowser(next.browser, next.backend);
      const browser = next?.browser ?? current!;
      try {
        const page = await browser.openBossPage();
        if (!page)
          throw new Error("浏览器里有多个 BOSS 页面，请保留一个岗位列表页后重试。");
        if (next && browser !== this.browser)
          await this.replaceBrowser(browser, next.backend);

        this.page = page;
        this.pageSessionId = randomUUID();
        page.once("close", () => {
          if (this.page === page) this.lastRead = undefined;
        });
        return { ok: true };
      } catch (error) {
        if (browser !== this.browser) await browser.close().catch(() => {});
        throw error;
      }
    });
  }

  private async launchBrowser(choice: BossBrowserChoice, preferred?: BossBrowserChoice) {
    const candidates = choice !== "auto"
      ? [choice]
      : preferred && preferred !== "auto"
        ? [preferred, ...autoBackends.filter((backend) => backend !== preferred)]
        : autoBackends;
    for (const backend of candidates) {
      try {
        return { browser: await this.openBrowser(backend), backend };
      } catch (error) {
        if (choice !== "auto" && backend === "ego")
          throw new Error("无法启动 ego。请完成 ego 的首次设置，或使用自动连接。", { cause: error });
      }
    }
    throw new Error(
      choice === "auto"
        ? "ego、Edge 和 Chrome 均无法连接。请确认至少安装了其中一个浏览器，再重试。"
        : `无法启动 ${browserNames[choice]}。请检查是否已安装，或切换浏览器。`,
    );
  }

  private async replaceBrowser(browser: BossBrowserReader, backend: BossBrowserBackend) {
    await this.release().catch(() => {});
    this.browser = browser;
    this.backend = backend;
  }

  private async release() {
    const browser = this.browser;
    this.browser = undefined;
    this.backend = undefined;
    this.page = undefined;
    this.pageSessionId = undefined;
    this.lastRead = undefined;
    await browser?.close();
  }

  async disconnect() {
    if (!this.browser) return;
    await this.exclusive(() => this.release());
  }

  async close() {
    this.closing = true;
    await Promise.allSettled([this.pending, this.startingBatch]);
    await this.batches.close();
    await this.release();
  }

  private requirePage() {
    if (!this.ready || !this.page) throw new Error("请先连接浏览器。");
    return this.page;
  }

  private async readJobs(expectedQuery?: string): Promise<BossJobRead> {
    const page = this.requirePage();
    const address = page.url();
    this.lastRead = undefined;
    const loading: BossJobRead = {
      state: "loading",
      query: expectedQuery ?? "",
      jobs: [],
      message: messages.loading,
    };
    let result;
    try {
      result = await page.evaluate(readBossJobList);
    } catch (error) {
      if (error instanceof Error && navigationInterruption.test(error.message))
        return loading;
      throw error;
    }
    if (this.page !== page || address !== page.url() || result.address !== address)
      return loading;
    const { state, query, jobs } = result;
    if (
      expectedQuery !== undefined &&
      query !== expectedQuery &&
      state !== "login" &&
      state !== "verification"
    )
      return loading;
    if (state === "ready") {
      const readId = randomUUID();
      this.lastRead = { id: readId, address, jobs };
      return { state, query, readId, jobs };
    }
    return { state, query, jobs: [], message: messages[state] };
  }

  private async searchJobs(query: string) {
    const page = this.requirePage();
    let current = await this.readJobs();
    const readyBy = Date.now() + 4000;
    // Let the initial page settle before issuing a new search.
    while (current.state === "loading" && current.query !== query && Date.now() < readyBy) {
      await wait(300);
      current = await this.readJobs();
    }
    if (current.state === "loading")
      return current.query === query
        ? current
        : {
          ...current,
          searchDeferred: true as const,
          message: "BOSS 页面仍在加载。加载完成后点「继续搜索」。",
        };
    if (
      current.state === "login" ||
      current.state === "verification" ||
      (current.query === query && current.state !== "unsupported")
    )
      return current;
    this.lastRead = undefined;
    try {
      await page.searchJobs(query);
    } catch (error) {
      if (!(error instanceof Error && navigationInterruption.test(error.message)))
        throw error;
    }
    const deadline = Date.now() + 4000;
    // Wait on the same tab. Never navigate again if the first request redirects.
    for (;;) {
      const result = await this.readJobs(query);
      if (result.state !== "loading" && result.state !== "unsupported")
        return result;
      if (Date.now() >= deadline) return result;
      await wait(300);
    }
  }

  private async readLegacyJobs() {
    const result = await this.readJobs();
    return {
      ...result,
      readId: result.state === "ready" ? result.readId : randomUUID(),
      needsLogin: result.state === "login",
      needsVerification: result.state === "verification",
    };
  }

  private async inspect(value: unknown) {
    const { readId, url } = z
      .object({ readId: z.string().uuid(), url: bossUrl })
      .parse(value);
    const page = this.requirePage();
    const snapshot = this.lastRead;
    const job = snapshot?.jobs.find((item) => item.url === url);
    if (
      !job ||
      !snapshot ||
      readId !== snapshot.id ||
      page.url() !== snapshot.address
    )
      throw new BossDetailError("岗位列表已变化，请重新读取。", "session");
    const result = await this.browser!.withJobPage(
      url,
      page,
      async (target) => {
        const deadline = Date.now() + 8000;
        let detail = await inspectBossDetail(target, job);
        while (
          detail.kind !== "login" &&
          detail.kind !== "verification" &&
          !(
            detail.kind === "detail" &&
            detail.title &&
            detail.company &&
            detail.description
          ) &&
          Date.now() < deadline
        ) {
          await wait(250);
          detail = await inspectBossDetail(target, job);
        }
        return detail;
      },
    );
    if (page.url() !== snapshot.address)
      throw new BossDetailError("读取期间列表已变化，请重新读取。", "session");
    return result;
  }

  async request(path: string, input?: unknown): Promise<unknown> {
    if (this.closing) throw new Error("BOSS 执行器正在关闭。");
    switch (path) {
      case "/status":
        return {
          ready: this.ready,
          phase: this.ready ? "connected" : "disconnected",
          ...(this.backend ? { backend: this.backend } : {}),
        };
      case "/connect": {
        const { backend } = z
          .object({ backend: bossBrowserChoice.default("auto") })
          .strict()
          .parse(input ?? {});
        return this.connectBrowser(backend);
      }
      case "/search":
        return this.exclusive(async () => {
          const { query } = z
            .object({ query: z.string().trim().min(1).max(120) })
            .parse(input);
          return this.searchJobs(query);
        });
      case "/jobs":
        return this.exclusive(() => this.readLegacyJobs());
      case "/inspect-job":
        return this.exclusive(() => this.inspect(input));
      case "/boss-batches":
        return this.batches.recent();
      case "/boss-batch/preview":
        return this.batches.preview(input);
      case "/boss-batch/confirm": {
        if (this.startingBatch)
          throw new Error("已有 BOSS 批次正在确认，请稍后读取回执。");
        const args = z
          .object({
            id: z.string().min(1),
            confirmed: z.literal(true),
            defaultGreetingAccepted: z.literal(true),
          })
          .strict()
          .parse(input);
        const promise = this.batches.confirm(
          args.id,
          args.confirmed,
          args.defaultGreetingAccepted,
        );
        this.startingBatch = promise;
        try {
          return structuredClone(await promise);
        } finally {
          if (this.startingBatch === promise) this.startingBatch = undefined;
        }
      }
      default: {
        const pathMatch = /^\/boss-batch\/([a-f0-9-]{36})(\/stop)?$/.exec(path);
        if (!pathMatch) throw new Error("不支持此 BOSS 操作。");
        const id = z.uuid().parse(pathMatch[1]);
        if (!pathMatch[2])
          return structuredClone(await this.batches.status(id));
        await this.batches.status(id);
        this.batches.stop(id);
        return { ok: true };
      }
    }
  }
}
