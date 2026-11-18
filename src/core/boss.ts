import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import type { Workspace } from "./workspace.js";
import { BossGateway } from "../infrastructure/boss-gateway.js";
import {
  bossInspection,
  bossJob,
  bossRun,
  bossUrl,
  type BossScan,
} from "../domain/boss.js";

// Connection codes rotate with the executor. Never store them in SQLite or cards.
const connections = new WeakMap<Workspace, BossGateway>();
const statuses = new WeakMap<
  Workspace,
  { ready: boolean; phase: string; backend?: string; error: string }
>();
export class Boss {
  constructor(readonly workspace: Workspace) {}
  connect(link: string) {
    connections.set(this.workspace, BossGateway.fromLink(link));
  }
  disconnect() {
    connections.delete(this.workspace);
    statuses.delete(this.workspace);
  }
  get connected() {
    return connections.has(this.workspace);
  }
  get browserState() {
    return statuses.get(this.workspace);
  }
  gateway() {
    const gateway = connections.get(this.workspace);
    if (!gateway)
      throw new Error("先在 BOSS 页面粘贴本机执行器的本次连接链接。");
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
      error: state.error ? "执行器有诊断信息，请在网页工作台查看。" : "",
    };
    statuses.set(this.workspace, result);
    return result;
  }
  async browserConnect() {
    await this.gateway().request("/connect", {});
  }
  async search(query: string) {
    await this.gateway().request("/search", {
      query: z.string().trim().min(1).max(120).parse(query),
    });
    return { searched: query, next: "搜索已打开，待列表就绪后读取岗位。" };
  }
  async read() {
    const data = z
      .object({
        readId: z.string().min(1),
        jobs: z.array(bossJob).max(30),
        needsLogin: z.boolean(),
        needsVerification: z.boolean(),
      })
      .parse(await this.gateway().request("/jobs"));
    const scan: BossScan = {
      id: randomUUID(),
      readId: data.readId,
      createdAt: Date.now(),
      jobs: data.jobs,
      ...(data.needsLogin || data.needsVerification
        ? {
            blocked: data.needsLogin
              ? "请在浏览器登录后重新读取。"
              : "请在浏览器完成验证后重新读取。",
          }
        : {}),
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
