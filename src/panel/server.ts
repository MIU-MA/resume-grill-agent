import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  randomBytes,
  timingSafeEqual,
  randomUUID,
  createHash,
} from "node:crypto";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Workspace, type Resume } from "../service.js";
import { Tasks, type Goal } from "../tasks.js";
import { smtpConfigured } from "../smtp.js";

export async function startPanel(workspace: Workspace, port = 4319) {
  const tasks = new Tasks(workspace);
  const token = randomBytes(32).toString("hex");
  const valid = (value: string) =>
    Buffer.byteLength(value) === Buffer.byteLength(token) &&
    timingSafeEqual(Buffer.from(value), Buffer.from(token));
  const server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent)
        json(res, 500, { error: "本机操作失败，请检查文件或服务后重试。" });
      else res.destroy();
    });
  });
  const json = (res: ServerResponse, code: number, data: unknown) => {
    res.writeHead(code, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(data));
  };
  const body = async (req: IncomingMessage) => {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 15 * 1024 * 1024)
        throw new Error("上传内容过大，文件须小于 10 MiB。");
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  };
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const localPort = (server.address() as { port: number }).port;
    const host = req.headers.host ?? "";
    if (
      !["127.0.0.1", "::ffff:127.0.0.1", "::1"].includes(
        req.socket.remoteAddress ?? "",
      ) ||
      ![`127.0.0.1:${localPort}`, `localhost:${localPort}`].includes(host)
    )
      return json(res, 403, { error: "仅允许本机访问。" });
    const origin = `http://${host}`;
    const url = new URL(req.url ?? "/", origin);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (
      req.method === "POST" &&
      (req.headers.origin !== origin ||
        !req.headers["content-type"]?.startsWith("application/json"))
    )
      return json(res, 403, { error: "请求来源无效。" });
    const cookieName = `resume_panel_${localPort}`;
    if (req.method === "POST" && url.pathname === "/api/session") {
      const input = await body(req);
      if (!valid(typeof input.token === "string" ? input.token : ""))
        return json(res, 401, {
          error: "面板连接已失效，请使用终端中新生成的地址。",
        });
      res.setHeader(
        "Set-Cookie",
        `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/`,
      );
      return json(res, 200, { ok: true });
    }
    if (url.pathname.startsWith("/api/")) {
      const value =
        req.headers.cookie
          ?.split(";")
          .map((item) => item.trim())
          .find((item) => item.startsWith(`${cookieName}=`))
          ?.slice(cookieName.length + 1) ?? "";
      if (
        !valid(value) ||
        (req.headers.origin && req.headers.origin !== origin) ||
        req.headers["sec-fetch-site"] === "cross-site"
      )
        return json(res, 401, { error: "请使用终端提供的面板地址连接。" });
      try {
        if (req.method === "GET" && url.pathname === "/api/workspace")
          return json(res, 200, {
            resumes: workspace.store.list("resume"),
            jobs: workspace.store.list("job"),
            applications: workspace.history(),
            proposals: workspace.store.list("proposal"),
            goals: workspace.store.list("goal"),
            searches: workspace.store.list("search"),
            batches: workspace.store.list("batch"),
            goalCandidates: Object.fromEntries(
              workspace.store
                .list<Goal>("goal")
                .map((goal) => [goal.id, tasks.candidates(goal.id)]),
            ),
            sendingEnabled:
              process.env.RESUME_ALLOW_SEND === "1" &&
              !!workspace.send &&
              smtpConfigured(),
          });
        const asset = url.pathname.match(/^\/api\/pdf\/([a-f0-9-]+)$/);
        if (req.method === "GET" && asset) {
          const resume = workspace.store.get<Resume>("resume", asset[1]);
          if (!resume.pdf || !resume.pdfHash)
            return json(res, 404, { error: "尚未生成岗位 PDF。" });
          const bytes = await readFile(resume.pdf);
          if (
            createHash("sha256").update(bytes).digest("hex") !== resume.pdfHash
          )
            throw new Error("PDF 已改变，请重新生成。");
          res.writeHead(200, {
            "Content-Type": "application/pdf",
            "Content-Disposition": 'inline; filename="resume.pdf"',
          });
          res.end(bytes);
          return;
        }
        if (req.method !== "POST")
          return json(res, 404, { error: "接口不存在。" });
        const input = await body(req);
        if (url.pathname === "/api/import") {
          const parsed = z
            .object({
              name: z.string().max(200),
              base64: z.string().max(14 * 1024 * 1024),
            })
            .strict()
            .parse(input);
          const bytes = Buffer.from(parsed.base64, "base64");
          if (
            !bytes.length ||
            bytes.length > 10 * 1024 * 1024 ||
            !/\.(pdf|docx|txt|md)$/i.test(parsed.name)
          )
            throw new Error("请选择 10 MiB 以内的 PDF、DOCX 或文本简历。");
          const folder = join(workspace.store.home, `upload-${randomUUID()}`);
          await mkdir(folder);
          const file = join(
            folder,
            basename(parsed.name.replaceAll("\\", "/")),
          );
          try {
            await writeFile(file, bytes, { flag: "wx", mode: 0o600 });
            return json(res, 200, await workspace.importResume(file));
          } finally {
            await rm(folder, { recursive: true, force: true });
          }
        }
        if (url.pathname === "/api/goals")
          return json(res, 200, tasks.saveGoal(input));
        if (url.pathname === "/api/discover") {
          const p = z.object({ goalId: z.string() }).strict().parse(input);
          return json(res, 200, await tasks.discover(p.goalId));
        }
        if (url.pathname === "/api/batch") {
          const p = z
            .object({ goalId: z.string(), choices: z.unknown() })
            .strict()
            .parse(input);
          return json(res, 200, await tasks.prepareBatch(p.goalId, p.choices));
        }
        if (url.pathname === "/api/jobs")
          return json(res, 200, workspace.addJob(input));
        if (url.pathname === "/api/context") {
          const p = z
            .object({ resumeId: z.string(), jobId: z.string() })
            .strict()
            .parse(input);
          return json(res, 200, workspace.reviewContext(p.resumeId, p.jobId));
        }
        if (url.pathname === "/api/version") {
          const p = z
            .object({
              resumeId: z.string(),
              jobId: z.string(),
              plan: z.unknown(),
              accepted: z.array(z.string()),
            })
            .strict()
            .parse(input);
          return json(
            res,
            200,
            await workspace.saveVersion(
              p.resumeId,
              p.jobId,
              p.plan,
              p.accepted,
            ),
          );
        }
        if (url.pathname === "/api/proposal") {
          const p = z
            .object({
              resumeId: z.string(),
              jobId: z.string(),
              plan: z.unknown(),
            })
            .strict()
            .parse(input);
          return json(res, 200, workspace.propose(p.resumeId, p.jobId, p.plan));
        }
        if (url.pathname === "/api/prepare") {
          const p = z
            .object({
              jobId: z.string(),
              resumeId: z.string(),
              recipient: z.string(),
              subject: z.string(),
              body: z.string(),
            })
            .strict()
            .parse(input);
          return json(
            res,
            200,
            await workspace.prepare(
              p.jobId,
              p.resumeId,
              p.recipient,
              p.subject,
              p.body,
            ),
          );
        }
        if (url.pathname === "/api/check") {
          const p = z.object({ id: z.string() }).strict().parse(input);
          return json(res, 200, await workspace.execute(p.id, true));
        }
        if (url.pathname === "/api/send") {
          const p = z
            .object({
              id: z.string(),
              digest: z.string(),
              acknowledged: z.literal(true),
              confirmation: z.literal("发送"),
            })
            .strict()
            .parse(input);
          if (
            process.env.RESUME_ALLOW_SEND !== "1" ||
            !workspace.send ||
            !smtpConfigured()
          )
            throw new Error("未配置真实发件邮箱；不会自动改为模拟投递。");
          workspace.approve(p.id, p.digest);
          return json(res, 200, await workspace.execute(p.id, false));
        }
        return json(res, 404, { error: "接口不存在。" });
      } catch (error) {
        return json(res, 400, {
          error:
            error instanceof z.ZodError
              ? error.issues.map((item) => item.message).join("；")
              : error instanceof Error
                ? error.message
                : "操作未完成。",
        });
      }
    }
    if (req.method !== "GET")
      return json(res, 405, { error: "请求方法无效。" });
    const assets: Record<string, [string, string]> = {
      "/": ["index.html", "text/html; charset=utf-8"],
      "/app.js": ["app.js", "text/javascript"],
      "/app.css": ["app.css", "text/css"],
    };
    assets["/pdf.worker.mjs"] = ["pdf.worker.mjs", "text/javascript"];
    const asset = assets[url.pathname];
    if (!asset) return json(res, 404, { error: "页面不存在。" });
    if (url.pathname === "/")
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      );
    const bytes = await readFile(
      fileURLToPath(
        new URL(`../../dist/panel-web/${asset[0]}`, import.meta.url),
      ),
    );
    res.writeHead(200, { "Content-Type": asset[1] });
    res.end(bytes);
  };
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      done();
    });
  });
  const address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    server,
    url: `${address}/#${token}`,
    close: () =>
      new Promise<void>((done, reject) => {
        server.close((error) => (error ? reject(error) : done()));
        server.closeIdleConnections();
      }),
  };
}
