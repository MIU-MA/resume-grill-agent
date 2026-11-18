import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Workspace } from "./workspace.js";
import { Boss } from "./boss.js";
import { BossDeliveries } from "./boss-deliveries.js";
import { matchesJob } from "../domain/job-search.js";
import type { BossScan } from "../domain/boss.js";
import type { Goal } from "./tasks.js";
const norm = (s: string) =>
  s.normalize("NFKC").replace(/\s/g, "").toLowerCase();
export type BossShortlist = {
  id: string;
  goalId: string;
  scanId: string;
  createdAt: number;
  detailsRead: number;
  budget: number;
  items: {
    url: string;
    title: string;
    company: string;
    jobId?: string;
    status: "candidate" | "needs_review" | "excluded" | "not_read";
    reasons: string[];
    evidence: string[];
  }[];
};
export class BossShortlists {
  constructor(readonly workspace: Workspace) {}
  async collect(goalId: string, scanId: string, budget = 5) {
    z.number().int().min(1).max(10).parse(budget);
    const goal = this.workspace.store.get<Goal>("goal", goalId),
      scan = this.workspace.store.get<BossScan>("boss-scan", scanId),
      resume = this.workspace.resume(goal.resumeId);
    if (scan.blocked) throw new Error(scan.blocked);
    const run: BossShortlist = {
      id: randomUUID(),
      goalId,
      scanId,
      createdAt: Date.now(),
      detailsRead: 0,
      budget,
      items: [],
    };
    let stopped = false;
    const sent = new BossDeliveries(this.workspace)
      .list()
      .filter((d) => d.status !== "prepared");
    for (const row of scan.jobs) {
      const item: BossShortlist["items"][number] = {
        url: row.url,
        title: row.title,
        company: row.company,
        status: "not_read",
        reasons: [],
        evidence: [],
      };
      run.items.push(item);
      if (
        sent.some(
          (d) =>
            d.url === row.url ||
            (goal.skipAppliedCompanies &&
              norm(d.company) === norm(row.company)),
        )
      ) {
        item.status = "excluded";
        item.reasons.push("已有投递或待核对记录");
        continue;
      }
      if (
        goal.exclude.some((t) =>
          norm(row.company + row.title + row.description).includes(norm(t)),
        )
      ) {
        item.status = "excluded";
        item.reasons.push("命中已保存排除条件");
        continue;
      }
      if (!matchesJob(row.title, row.description, goal.directions)) {
        item.status = "excluded";
        item.reasons.push("岗位名称与职责未匹配目标方向");
        continue;
      }
      if (stopped || run.detailsRead >= Math.min(budget, goal.limit)) {
        item.reasons.push(
          stopped
            ? "前一岗位读取失败，已停止后续读取"
            : "已达到本次详情读取上限",
        );
        continue;
      }
      try {
        run.detailsRead++;
        const job = await new Boss(this.workspace).detail(scanId, row.url);
        item.jobId = job.id;
        const content = norm(job.company + job.role + job.jd);
        if (
          goal.exclude.some((t) => content.includes(norm(t))) ||
          !matchesJob(job.role, job.jd, goal.directions)
        ) {
          item.status = "excluded";
          item.reasons.push("完整 JD 不符合方向或排除条件");
          continue;
        }
        const cities = goal.cities.filter((c) =>
          norm(job.jd).includes(norm(c)),
        );
        item.status = goal.cities.length ? "needs_review" : "candidate";
        item.reasons.push(
          "已核对完整 JD 与岗位身份",
          ...(goal.cities.length
            ? [
                cities.length
                  ? `JD 提及 ${cities.join("、")}；提及不等于实际工作地，请核对`
                  : "JD 未提供目标城市证据，请核对工作地点",
              ]
            : ["未限制城市"]),
        );
        const terms = [
          ...new Set(job.jd.match(/[a-z][a-z0-9+#.-]{1,30}/gi) ?? []),
        ];
        item.evidence = resume.text
          .split(/\n/)
          .map((s) => s.trim())
          .filter(
            (s) =>
              s &&
              terms.some((t) =>
                new RegExp(
                  `(?:^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z0-9])`,
                  "i",
                ).test(s),
              ),
          )
          .slice(0, 3);
        if (!item.evidence.length)
          item.reasons.push(
            "未找到可直接引用的英文技能证据，需结合简历核对；不代表不匹配",
          );
      } catch {
        item.status = "needs_review";
        item.reasons.push(
          "完整 JD 读取失败，请在浏览器检查登录、验证或页面变化",
        );
        stopped = true;
      } finally {
        this.workspace.store.put("boss-shortlist", run);
      }
    }
    this.workspace.store.put("boss-shortlist", run);
    return run;
  }
}
