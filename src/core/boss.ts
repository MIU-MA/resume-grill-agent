import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import type { Job, Workspace } from "./workspace.js";
import type { Goal } from "./tasks.js";
import { BossGateway } from "../infrastructure/boss-gateway.js";
import type { BossExecutor } from "../infrastructure/boss-executor/index.js";
import { resumeSearchDirection } from "../domain/resume-search-direction.js";
import {
  bossBrowserChoice,
  bossInspection,
  bossJob,
  bossRun,
  bossUrl,
  type BossBrowserChoice,
  type BossScan,
} from "../domain/boss.js";

const readResult = z.object({
  readId: z.string().min(1).optional(),
  jobs: z.array(bossJob).max(30),
  state: z
    .enum(["ready", "loading", "empty", "login", "verification", "unsupported"])
    .optional(),
  query: z.string().optional(),
  needsLogin: z.boolean().optional(),
  needsVerification: z.boolean().optional(),
  searchDeferred: z.literal(true).optional(),
  message: z.string().max(300).optional(),
});

// Connection codes rotate with the executor. Never store them in SQLite or cards.
const connections = new WeakMap<Workspace, BossGateway>();
const executors = new WeakMap<Workspace, BossExecutor>();
const statuses = new WeakMap<
  Workspace,
  { ready: boolean; phase: string; backend?: string; error: string }
>();
export class Boss {
  constructor(readonly workspace: Workspace) {}
  useExecutor(executor: BossExecutor) {
    executors.set(this.workspace, executor);
  }
  connect(link: string) {
    connections.set(this.workspace, BossGateway.fromLink(link));
  }
  disconnect() {
    connections.delete(this.workspace);
    statuses.delete(this.workspace);
  }
  async browserDisconnect() {
    if (!connections.has(this.workspace))
      await executors.get(this.workspace)?.disconnect();
    this.disconnect();
  }
  get connected() {
    return (
      connections.has(this.workspace) ||
      executors.get(this.workspace)?.ready === true
    );
  }
  get browserState() {
    if (!this.connected) return undefined;
    return statuses.get(this.workspace);
  }
  get browserPreference(): BossBrowserChoice {
    const saved = this.workspace.store.list<{ backend: unknown }>(
      "boss-browser",
    )[0];
    return bossBrowserChoice.safeParse(saved?.backend).data ?? "auto";
  }
  gateway() {
    const gateway =
      connections.get(this.workspace) ?? executors.get(this.workspace);
    if (!gateway) throw new Error("请先在 BOSS 页面连接浏览器。");
    return gateway;
  }
  async status() {
    const state = z
      .object({
        ready: z.boolean(),
        phase: z.string(),
        backend: z.string().optional(),
        error: z.string().optional(),
      })
      .parse(await this.gateway().request("/status"));
    const result = {
      ...state,
      error: state.error ? "请在工作台检查浏览器和执行器状态。" : "",
    };
    statuses.set(this.workspace, result);
    return result;
  }
  async browserConnect(backend?: BossBrowserChoice) {
    const executor = connections.has(this.workspace)
      ? undefined
      : executors.get(this.workspace);
    const choice = backend ?? "auto";
    if (executor) await executor.connectBrowser(choice, this.browserPreference);
    else await this.gateway().request("/connect", { backend: choice });

    const state = await this.status();
    if (state.ready && executor)
      this.workspace.store.put("boss-browser", {
        id: "boss-browser:preferred",
        backend: bossBrowserChoice.safeParse(state.backend).data ?? choice,
      });
  }
  async findForResume(
    resumeId: string,
    query?: string,
    backend?: BossBrowserChoice,
  ) {
    const resume = this.workspace.resume(resumeId);
    const goal = this.workspace.store
      .list<Goal>("goal")
      .find((g) => g.resumeId === resumeId);
    const job = resume.jobId
      ? this.workspace.store.list<Job>("job").find((j) => j.id === resume.jobId)
      : undefined;
    const keyword =
      query?.trim() ||
      resumeSearchDirection(resume.text, resume.name, [
        ...(goal?.directions ?? []),
        ...(job ? [job.role] : []),
      ]);
    if (!keyword) return { needsDirection: true as const };
    if (!this.connected) await this.browserConnect(backend);
    return { scan: await this.search(keyword, resumeId) };
  }
  async search(query: string, resumeId?: string) {
    const keyword = z.string().trim().min(1).max(120).parse(query);
    const response = await this.gateway().request("/search", { query: keyword });
    if (
      response == null ||
      (typeof response === "object" && !("jobs" in response))
    )
      return this.read(resumeId, keyword);
    return this.saveScan(readResult.parse(response), resumeId, keyword);
  }
  async read(resumeId?: string, requestedQuery?: string) {
    if (resumeId) this.workspace.resume(resumeId);
    return this.saveScan(
      readResult.parse(await this.gateway().request("/jobs")),
      resumeId,
      requestedQuery,
    );
  }
  private saveScan(
    data: z.infer<typeof readResult>,
    resumeId?: string,
    requestedQuery?: string,
  ) {
    const state = data.needsLogin
      ? "login"
      : data.needsVerification
        ? "verification"
        : data.state;
    const mismatched =
      requestedQuery && state !== "login" && state !== "verification" &&
      state !== "loading" && data.query !== undefined && data.query !== requestedQuery;
    const blocked = mismatched
      ? "当前列表不是这次搜索的结果，请重新搜索。"
      :
      state === "login"
        ? requestedQuery
          ? "请在浏览器登录，然后回来继续找岗位。"
          : "请在浏览器登录后读取当前列表。"
        : state === "verification"
          ? "请在浏览器完成安全验证后读取当前列表；无需重新搜索。"
          : data.message;
    if (!blocked && data.jobs.length && !data.readId)
      throw new Error("岗位列表缺少快照，请重新读取。");
    const scan: BossScan = {
      id: randomUUID(),
      readId: data.readId ?? "",
      createdAt: Date.now(),
      jobs: mismatched ? [] : data.jobs,
      ...(resumeId ? { resumeId } : {}),
      ...(data.query || requestedQuery
        ? { query: data.query || requestedQuery }
        : {}),
      ...(requestedQuery ? { requestedQuery } : {}),
      ...(state === "loading" && data.searchDeferred ? { searchDeferred: true } : {}),
      ...(mismatched ? { state: "unsupported" } : state ? { state } : {}),
      ...(blocked ? { blocked } : {}),
    };
    this.workspace.store.put("boss-scan", scan);
    return scan;
  }
  async detail(scanId: string, url: string) {
    bossUrl.parse(url);
    const scan = this.workspace.store.get<BossScan>("boss-scan", scanId),
      expected = scan.jobs.find((j) => j.url === url);
    if (scan.blocked || !expected)
      throw new Error(scan.blocked ?? "岗位不在本次列表中。");
    const detail = bossInspection.parse(
      await this.gateway().request("/inspect-job", {
        readId: scan.readId,
        url,
      }),
    );
    if (
      detail.kind !== "detail" ||
      !detail.matched ||
      detail.truncated ||
      detail.blockers.length ||
      detail.url !== url ||
      detail.title !== expected.title ||
      detail.company !== expected.company ||
      !detail.description.trim()
    )
      throw new Error("岗位身份或完整 JD 未核对通过，请在官网检查。");
    const job = this.workspace.addJob({
      sourceUrl: url,
      role: detail.title,
      company: detail.company,
      jd: detail.description,
    });
    this.workspace.store.put("boss-evidence", {
      id: `boss-evidence:${job.id}`,
      jobId: job.id,
      scanId,
      jdHash: createHash("sha256").update(job.jd).digest("hex"),
    });
    return job;
  }
  async recent() {
    const rows = z
      .array(
        z.object({
          id: z.string().uuid(),
          state: z.enum(["running", "paused", "finished", "failed"]),
          createdAt: z.number(),
          total: z.number(),
          verified: z.number(),
          companies: z.array(z.string()),
        }),
      )
      .max(10)
      .parse(await this.gateway().request("/boss-batches"));
    return rows;
  }
  async refresh(id: string) {
    z.uuid().parse(id);
    const run = bossRun.parse(
      await this.gateway().request(`/boss-batch/${id}`),
    );
    if (run.id !== id) throw new Error("执行器返回了不同批次。");
    const old = this.workspace.store
      .list<typeof run>("boss-run")
      .find((r) => r.id === id);
    if (!old || old.updatedAt <= run.updatedAt)
      this.workspace.store.put("boss-run", run);
    return old && old.updatedAt > run.updatedAt ? old : run;
  }
  async pause(id: string) {
    z.uuid().parse(id);
    await this.gateway().request(`/boss-batch/${id}/stop`, {});
    return {
      id,
      requested: true,
      message: "已请求完成当前步骤后暂停；请重新读取状态。",
    };
  }
}
