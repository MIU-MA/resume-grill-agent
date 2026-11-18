import { resolve } from "node:path";
import { EventEmitter } from "node:events";
import { findBossImageInput } from "./boss-delivery-dom.js";
import { EgoCdpSocket } from "./ego-cdp-connection.js";
import { ChromiumCdpSocket } from "./chromium-cdp-connection.js";
import type { BossBrowserBackend } from "../../domain/boss.js";

type TargetInfo = {
  targetId: string;
  type: string;
  url: string;
  title: string;
  browserContextId?: string;
  openerId?: string;
};
type ProtocolMessage = {
  id?: number;
  sessionId?: string;
  method?: string;
  params?: any;
  result?: any;
  error?: { message: string };
};
const bossHost = (host: string) =>
  host === "zhipin.com" || host.endsWith(".zhipin.com");
const readMethods = new Set([
  "Target.getTargets",
  "Target.createTarget",
  "Target.closeTarget",
  "Target.setDiscoverTargets",
  "Target.attachToTarget",
  "Page.enable",
  "Page.getFrameTree",
  "Network.enable",
  "Network.getResponseBody",
  "Runtime.evaluate",
  "Page.navigate",
  "DOM.setFileInputFiles",
]);

// Local browser runtime: discover metadata and attach one explicitly selected page.
// No Debugger, global auto-attach or startup scripts. Batch input is scoped to owned pages.
export class BossBrowserReader extends EventEmitter {
  private nextId = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private pages = new Map<string, BossReadPage>();
  private ownedTargets = new Set<string>();
  private ownedPages = new Map<string, BossReadPage>();
  private imageFiles = new Set<string>();
  private detailCreations = new Set<Promise<{ targetId: string }>>();
  private closing = false;
  private openingBoss?: Promise<BossReadPage | undefined>;
  private constructor(
    private readonly socket: EgoCdpSocket | ChromiumCdpSocket,
    readonly backend: BossBrowserBackend,
  ) {
    super();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(
        String((event as MessageEvent).data),
      ) as ProtocolMessage;
      if (message.id !== undefined) {
        const request = this.pending.get(message.id);
        if (!request) return;
        this.pending.delete(message.id);
        clearTimeout(request.timer);
        if (message.error) request.reject(new Error(message.error.message));
        else request.resolve(message.result);
      } else if (message.sessionId) {
        for (const page of [
          ...this.pages.values(),
          ...this.ownedPages.values(),
        ])
          if (page.sessionId === message.sessionId) page.event(message);
      } else if (message.method === "Target.targetDestroyed")
        (
          this.pages.get(message.params.targetId) ??
          this.ownedPages.get(message.params.targetId)
        )?.markClosed();
      else if (message.method === "Target.targetInfoChanged")
        (
          this.pages.get(message.params.targetInfo.targetId) ??
          this.ownedPages.get(message.params.targetInfo.targetId)
        )?.update(message.params.targetInfo);
    });
    socket.addEventListener("close", () => {
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("浏览器连接已断开"));
      }
      this.pending.clear();
      for (const page of this.pages.values()) page.markClosed();
      this.emit("disconnected");
    });
  }
  static async connect(backend: BossBrowserBackend, directory: string) {
    const socket =
      backend === "ego"
        ? await EgoCdpSocket.connect()
        : await ChromiumCdpSocket.connect(directory, backend);
    const reader = new BossBrowserReader(socket, backend);
    try {
      await reader.command("Target.setDiscoverTargets", { discover: true });
      return reader;
    } catch (error) {
      await reader.close().catch(() => {});
      throw error;
    }
  }
  isConnected() {
    return this.socket.readyState === WebSocket.OPEN;
  }
  command<T = any>(
    method: string,
    params: object = {},
    sessionId?: string,
  ): Promise<T> {
    if (!readMethods.has(method))
      return Promise.reject(new Error("只读连接禁止此操作"));
    if (method === "Target.createTarget") {
      const value = params as { url: string; background: boolean };
      const url = new URL(value.url);
      if (
        (url.href !== "about:blank" &&
          (url.origin !== "https://www.zhipin.com" ||
            !(
              url.pathname === "/web/geek/jobs" ||
              /^\/job_detail\/[^/]+\.html$/.test(url.pathname)
            ) ||
            url.search ||
            url.hash ||
            url.username ||
            url.password)) ||
        (value.background !== true &&
          (this.backend === "ego" || url.href !== "about:blank"))
      )
        return Promise.reject(
          new Error("只允许打开 BOSS 招聘页或明确指定的岗位详情"),
        );
    }
    if (method === "DOM.setFileInputFiles") {
      const files = (params as { files?: string[] }).files;
      if (
        !sessionId ||
        ![...this.ownedPages.values()].some(
          (page) => page.sessionId === sessionId,
        ) ||
        !files?.length ||
        files.some((file) => !this.imageFiles.has(resolve(file)))
      )
        return Promise.reject(
          new Error("只允许在本批拥有的会话上传已核对图片"),
        );
    }
    if (
      method === "Target.closeTarget" &&
      !this.ownedTargets.has((params as { targetId: string }).targetId)
    )
      return Promise.reject(new Error("只能关闭本次读取创建的临时标签页"));
    if (method === "Page.navigate") {
      const url = new URL((params as { url: string }).url);
      if (
        url.origin !== "https://www.zhipin.com" ||
        url.username ||
        url.password ||
        url.hash ||
        !(
          (url.pathname === "/web/geek/chat" && !url.search) ||
          (/^\/job_detail\/[^/]+\.html$/.test(url.pathname) && !url.search) ||
          (url.pathname === "/web/geek/jobs" &&
            (!url.search ||
              ([...url.searchParams.keys()].every(
                (key) => key === "query" || key === "city",
              ) &&
                !!url.searchParams.get("query") &&
                (!url.searchParams.has("city") ||
                  /^\d{9}$/.test(url.searchParams.get("city")!)))))
        )
      )
        return Promise.reject(new Error("只允许打开官网岗位、搜索或已有会话"));
    }
    if (!this.isConnected())
      return Promise.reject(new Error("浏览器连接已断开"));
    this.emit("command", method);
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} 读取超时`));
      }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(
        JSON.stringify({
          id,
          method,
          params,
          ...(sessionId ? { sessionId } : {}),
        }),
      );
    });
  }
  async listPages() {
    const { targetInfos } = await this.command<{ targetInfos: TargetInfo[] }>(
      "Target.getTargets",
    );
    const targets = targetInfos.filter((target) => {
      try {
        return (
          target.type === "page" &&
          !this.ownedTargets.has(target.targetId) &&
          bossHost(new URL(target.url).hostname)
        );
      } catch {
        return false;
      }
    });
    for (const target of targets) {
      const current = this.pages.get(target.targetId);
      if (current) current.update(target);
      else this.pages.set(target.targetId, new BossReadPage(this, target));
    }
    const ids = new Set(targets.map((target) => target.targetId));
    for (const [id, page] of this.pages)
      if (!ids.has(id)) {
        page.markClosed();
        this.pages.delete(id);
      }
    return [...this.pages.values()];
  }
  async withJobPage<T>(
    url: string,
    source: BossReadPage,
    read: (page: BossReadPage) => Promise<T>,
  ): Promise<T> {
    if (this.closing) throw new Error("浏览器连接正在关闭");
    const address = new URL(url);
    if (
      address.origin !== "https://www.zhipin.com" ||
      !/^\/job_detail\/[^/]+\.html$/.test(address.pathname) ||
      address.search ||
      address.hash ||
      address.username ||
      address.password
    )
      throw new Error("只允许指定的 BOSS 岗位详情");
    const creation = this.command<{ targetId: string }>("Target.createTarget", {
      url: "about:blank",
      background: true,
      ...(source.browserContextId()
        ? { browserContextId: source.browserContextId() }
        : {}),
    });
    this.detailCreations.add(creation);
    let targetId: string;
    try {
      targetId = (await creation).targetId;
    } finally {
      this.detailCreations.delete(creation);
    }
    this.ownedTargets.add(targetId);
    const target = new BossReadPage(this, {
      targetId,
      type: "page",
      url,
      title: "",
    });
    this.ownedPages.set(targetId, target);
    try {
      await target.attach();
      await this.command("Page.navigate", { url }, target.sessionId);
      const end = Date.now() + 8000;
      while (Date.now() < end && this.isConnected()) {
        try {
          if (
            await target.evaluate(
              () =>
                location.hostname.endsWith("zhipin.com") &&
                document.readyState !== "loading",
            )
          )
            break;
        } catch {
          /* navigation replaces the initial execution context */
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return await read(target);
    } finally {
      target.markClosed();
      try {
        if (this.ownedTargets.has(targetId))
          await this.command("Target.closeTarget", { targetId });
      } finally {
        this.ownedTargets.delete(targetId);
        this.ownedPages.delete(targetId);
      }
    }
  }
  approveImage(file: string) {
    this.imageFiles.add(resolve(file));
  }
  revokeImage(file: string) {
    this.imageFiles.delete(resolve(file));
  }
  async ownedChatPopup(parent: BossReadPage) {
    if (!this.ownedTargets.has(parent.targetId()))
      throw new Error("不是本批创建的岗位页面");
    const { targetInfos } = await this.command<{ targetInfos: TargetInfo[] }>(
      "Target.getTargets",
    );
    const children = targetInfos.filter((target) => {
      try {
        const url = new URL(target.url);
        return (
          target.openerId === parent.targetId() &&
          target.type === "page" &&
          url.origin === "https://www.zhipin.com" &&
          /^\/web\/geek\/chat\/?$/.test(url.pathname)
        );
      } catch {
        return false;
      }
    });
    if (children.length > 1)
      throw new Error("岗位打开了多个会话页面，无法核对收件人");
    if (!children.length) return undefined;
    const info = children[0];
    let page = this.ownedPages.get(info.targetId);
    if (!page) {
      this.pages.delete(info.targetId);
      page = new BossReadPage(this, info);
      this.ownedTargets.add(info.targetId);
      this.ownedPages.set(info.targetId, page);
    }
    return page;
  }
  async closeOwnedPage(page: BossReadPage) {
    const id = page.targetId();
    if (!this.ownedTargets.has(id)) return;
    try {
      await this.command("Target.closeTarget", { targetId: id });
    } finally {
      this.ownedTargets.delete(id);
      this.ownedPages.delete(id);
      page.markClosed();
    }
  }
  /** Reuse the search page within this browser session. */
  async openBossPage() {
    if (this.closing) throw new Error("浏览器连接正在关闭");
    if (this.openingBoss) return this.openingBoss;
    this.openingBoss = (async () => {
      const existing = await this.listPages();
      if (existing.length)
        return existing.length === 1 ? existing[0] : undefined;
      const url = "https://www.zhipin.com/web/geek/jobs";
      const { targetId } = await this.command<{ targetId: string }>(
        "Target.createTarget",
        { url: "about:blank", background: this.backend === "ego" },
      );
      const target = new BossReadPage(this, {
        targetId,
        type: "page",
        url,
        title: "BOSS 招聘页",
      });
      await target.attach();
      await this.command("Page.navigate", { url }, target.sessionId);
      const until = Date.now() + 10000;
      while (this.isConnected() && Date.now() < until) {
        if (this.closing) throw new Error("浏览器连接正在关闭");
        try {
          const address = await target.evaluate(() =>
            (location.hostname === "zhipin.com" ||
              location.hostname.endsWith(".zhipin.com")) &&
            document.readyState !== "loading"
              ? location.href
              : "",
          );
          if (address) {
            target.update({
              targetId,
              type: "page",
              url: address,
              title: "BOSS 招聘页",
            });
            this.pages.set(targetId, target);
            return target;
          }
        } catch {
          /* Navigation can replace the execution context; don't reload the page. */
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      throw new Error(
        "BOSS 页面已打开，仍在加载。可稍后刷新页面列表继续，不会重复打开。",
      );
    })();
    try {
      return await this.openingBoss;
    } finally {
      this.openingBoss = undefined;
    }
  }
  async close() {
    this.closing = true;
    await Promise.allSettled([...this.detailCreations]);
    await Promise.allSettled(
      [...this.ownedTargets].map((targetId) =>
        this.command("Target.closeTarget", { targetId }),
      ),
    );
    this.ownedTargets.clear();
    this.ownedPages.clear();
    this.imageFiles.clear();
    await this.socket.close();
  }
}

class BossReadPage extends EventEmitter {
  sessionId?: string;
  private closed = false;
  private target: TargetInfo;
  private browser: BossBrowserReader;
  private frame = { id: "", url: () => this.target.url };
  private responses = new Map<string, { url: string; status: number }>();
  constructor(browser: BossBrowserReader, target: TargetInfo) {
    super();
    this.browser = browser;
    this.target = target;
  }
  update(target: TargetInfo) {
    this.target = target;
  }
  url() {
    return this.target.url;
  }
  targetId() {
    return this.target.targetId;
  }
  isClosed() {
    return this.closed || !this.browser.isConnected();
  }
  browserContextId() {
    return this.target.browserContextId;
  }
  markClosed() {
    if (!this.closed) {
      this.closed = true;
      this.emit("close");
    }
  }
  async attach() {
    if (this.sessionId) return;
    const { sessionId } = await this.browser.command("Target.attachToTarget", {
      targetId: this.target.targetId,
      flatten: true,
    });
    this.sessionId = sessionId;
    const { frameTree } = await this.browser.command(
      "Page.getFrameTree",
      {},
      sessionId,
    );
    this.frame.id = frameTree.frame.id;
    await this.browser.command("Page.enable", {}, sessionId);
    // Keep bounded response bodies available while verifying upload receipts.
    await this.browser.command(
      "Network.enable",
      {
        maxTotalBufferSize: 8 * 1024 * 1024,
        maxResourceBufferSize: 1024 * 1024,
        maxPostDataSize: 0,
        enableDurableMessages: true,
      },
      sessionId,
    );
  }
  // tsx may preserve nested function names with __name; keep its helper local to this read.
  async evaluate<T, A = undefined>(
    fn: (arg: A) => T,
    arg?: A,
  ): Promise<Awaited<T>> {
    await this.attach();
    // Reviewed batch clicks may open a chat window. Ordinary reads and draft
    // filling do not receive a browser user gesture.
    const userGesture =
      !!arg &&
      typeof arg === "object" &&
      "action" in arg &&
      ["contact", "confirm-image"].includes(String(arg.action));
    const data = await this.browser.command(
      "Runtime.evaluate",
      {
        expression: `(() => { const __name = value => value; return (${fn.toString()})(${JSON.stringify(arg) ?? "undefined"}) })()`,
        returnByValue: true,
        awaitPromise: true,
        userGesture,
      },
      this.sessionId,
    );
    if (data.exceptionDetails)
      throw new Error(
        data.exceptionDetails.exception?.description || "页面读取失败",
      );
    return data.result.value;
  }
  async attachImage(file: string) {
    await this.attach();
    const result = await this.browser.command(
      "Runtime.evaluate",
      {
        expression: `(() => { const __name = value => value; return (${findBossImageInput.toString()})(); })()`,
        returnByValue: false,
      },
      this.sessionId,
    );
    if (result.exceptionDetails || !result.result?.objectId)
      throw new Error("没有识别到唯一图片上传入口");
    await this.browser.command(
      "DOM.setFileInputFiles",
      { objectId: result.result.objectId, files: [resolve(file)] },
      this.sessionId,
    );
  }
  async searchJobs(query: string) {
    await this.attach();
    const url = new URL("https://www.zhipin.com/web/geek/jobs");
    url.searchParams.set("query", query);
    const current = new URL(this.url());
    const city = current.searchParams.get("city");
    if (
      current.origin === url.origin &&
      current.pathname === url.pathname &&
      current.searchParams.get("query") === query
    )
      return;
    url.searchParams.set(
      "city",
      city && /^\d{9}$/.test(city) ? city : "100010000",
    );
    const navigation = await this.browser.command(
      "Page.navigate",
      { url: url.href },
      this.sessionId,
    );
    if (navigation.errorText)
      throw new Error("BOSS 搜索页未能打开，请检查浏览器网络。");
  }
  event(message: ProtocolMessage) {
    const data = message.params;
    if (message.method === "Page.frameNavigated" && !data.frame.parentId) {
      this.frame.id = data.frame.id;
      this.target.url = data.frame.url;
      this.emit("framenavigated", this.frame);
    } else if (
      message.method === "Page.navigatedWithinDocument" &&
      data.frameId === this.frame.id
    ) {
      this.target.url = data.url;
      this.emit("framenavigated", this.frame);
    } else if (
      message.method === "Network.requestWillBeSent" &&
      data.type === "Document" &&
      data.frameId === this.frame.id
    )
      this.emit("request", {
        isNavigationRequest: () => true,
        frame: () => this.frame,
        url: () => data.request.url,
      });
    else if (message.method === "Network.responseReceived") {
      const url = new URL(data.response.url);
      if (bossHost(url.hostname) && url.pathname.startsWith("/wapi/")) {
        this.responses.set(data.requestId, {
          url: data.response.url,
          status: data.response.status,
        });
        if (this.responses.size > 100)
          this.responses.delete(this.responses.keys().next().value!);
      }
    } else if (message.method === "Network.loadingFinished") {
      const response = this.responses.get(data.requestId);
      this.responses.delete(data.requestId);
      if (response)
        this.emit("response", {
          url: () => response.url,
          status: () => response.status,
          json: async () => {
            const body = await this.browser.command(
              "Network.getResponseBody",
              { requestId: data.requestId },
              this.sessionId,
            );
            return JSON.parse(
              body.base64Encoded
                ? Buffer.from(body.body, "base64").toString("utf8")
                : body.body,
            );
          },
        });
    } else if (message.method === "Network.loadingFailed")
      this.responses.delete(data.requestId);
  }
}
