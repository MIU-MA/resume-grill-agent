/** Narrow client to the existing local executor. No arbitrary CDP or shell calls. */
export class BossGateway {
  private constructor(
    private readonly origin: string,
    private readonly token: string,
  ) {}
  static fromLink(link: string) {
    const u = new URL(link);
    if (
      u.protocol !== "http:" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) ||
      u.username ||
      u.password
    )
      throw new Error("请粘贴本机 BOSS 服务输出的工作台链接。");
    const p = new URLSearchParams(u.hash.slice(1)),
      origin = new URL(p.get("boss-origin") ?? ""),
      token = p.get("boss-token") ?? "";
    if (
      origin.protocol !== "http:" ||
      origin.hostname !== "127.0.0.1" ||
      !origin.port ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash ||
      origin.username ||
      origin.password ||
      !/^[a-f0-9]{48}$/.test(token)
    )
      throw new Error("BOSS 连接凭据无效，请使用本次服务输出的新链接。");
    return new BossGateway(origin.origin, token);
  }
  async request(path: string, input?: unknown): Promise<any> {
    if (
      !/^\/(?:status|connect|search|jobs|inspect-job|boss-batches|boss-batch\/(?:preview|confirm|[a-f0-9-]{36}(?:\/stop)?))$/.test(
        path,
      )
    )
      throw new Error("不支持此 BOSS 操作。");
    let response: Response;
    try {
      response = await fetch(this.origin + path, {
        method: input === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        ...(input === undefined ? {} : { body: JSON.stringify(input) }),
        signal: AbortSignal.timeout(45000),
        redirect: "error",
      });
    } catch {
      throw new Error(
        "本机 BOSS 服务未响应。请检查服务是否运行，再读取状态；不要重复投递。",
      );
    }
    if (Number(response.headers.get("content-length") ?? 0) > 2 * 1024 * 1024)
      throw new Error("BOSS 服务返回内容过大。");
    // Bound chunked responses too; never forward executor errors containing credentials.
    const reader = response.body?.getReader();
    let size = 0;
    const parts: Uint8Array[] = [];
    if (reader)
      try {
        while (true) {
          const r = await reader.read();
          if (r.done) break;
          size += r.value.length;
          if (size > 2 * 1024 * 1024) throw new Error("返回内容过大");
          parts.push(r.value);
        }
      } catch {
        await reader.cancel();
        throw new Error("BOSS 服务返回内容过大或读取中断，请重新查询状态。");
      }
    if (!response.ok)
      throw new Error(
        response.status === 401
          ? "BOSS 连接码已失效，请重新粘贴本次服务链接。"
          : "BOSS 操作未完成，请检查登录、页面及批次状态。",
      );
    try {
      return JSON.parse(Buffer.concat(parts).toString("utf8"));
    } catch {
      throw new Error("BOSS 服务未返回有效数据。");
    }
  }
}
