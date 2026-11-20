import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Workspace } from "./workspace.js";
import { Boss } from "./boss.js";
import { BossDeliveries } from "./boss-deliveries.js";
import { isGenericJobTitle, matchesJob } from "../domain/job-search.js";
import {
  bossDirection,
  bossDirectionConflict,
  bossSkillEvidence,
  checkBossRequirements,
  classifyBossRecruitment,
  recruitmentLabels,
  type BossRecruitmentFilter,
  type BossRequirement,
  type Recruitment,
} from "../domain/boss-recruitment.js";
import type { BossScan } from "../domain/boss.js";
import type { Goal } from "./tasks.js";

const norm = (s: string) => s.normalize("NFKC").replace(/\s/g, "").toLowerCase();

export type BossShortlistItem = {
  url: string;
  title: string;
  company: string;
  jobId?: string;
  status: "candidate" | "needs_review" | "excluded" | "not_read";
  reasons: string[];
  evidence: string[];
  recruitment?: Recruitment;
  requirements?: BossRequirement[];
  skillMatches?: ReturnType<typeof bossSkillEvidence>;
};

export type BossShortlist = {
  id: string;
  goalId: string;
  scanId: string;
  resumeId?: string;
  recruitment?: BossRecruitmentFilter;
  createdAt: number;
  detailsRead: number;
  budget: number;
  items: BossShortlistItem[];
};

export class BossShortlists {
  constructor(readonly workspace: Workspace) {}

  async collect(goalId: string, scanId: string, budget = 5, recruitment: BossRecruitmentFilter = "all") {
    const goal = this.workspace.store.get<Goal>("goal", goalId);
    return this.collectForGoal(goal, scanId, budget, recruitment);
  }

  async collectForGoal(goal: Goal, scanId: string, budget = 5, recruitment: BossRecruitmentFilter = "all") {
    z.number().int().min(1).max(10).parse(budget);
    const scan = this.workspace.store.get<BossScan>("boss-scan", scanId);
    const resume = this.workspace.resume(goal.resumeId);
    if (scan.blocked) throw new Error(scan.blocked);
    const rows = scan.jobs.map((row) => {
      const hint = classifyBossRecruitment(row.title, row.description);
      const item: BossShortlistItem = {
        url: row.url,
        title: row.title,
        company: row.company,
        status: "not_read",
        reasons: [],
        evidence: [],
        recruitment: hint,
      };
      return { row, item, kind: hint.kind };
    });
    const run: BossShortlist = {
      id: randomUUID(),
      goalId: goal.id,
      scanId,
      resumeId: resume.id,
      recruitment,
      createdAt: Date.now(),
      detailsRead: 0,
      budget,
      items: rows.map(({ item }) => item),
    };
    const directions = goal.directions.map(bossDirection);
    const rank = (kind: Recruitment["kind"]) =>
      recruitment === "all" || kind === recruitment ? 0 : kind === "unknown" ? 1 : 2;
    rows.sort((a, b) => rank(a.kind) - rank(b.kind));
    const boss = new Boss(this.workspace);
    const sent = new BossDeliveries(this.workspace).list().filter((d) => d.status !== "prepared");
    let stopped = false;

    for (const { row, item } of rows) {
      if (sent.some((d) =>
        d.url === row.url || (goal.skipAppliedCompanies && norm(d.company) === norm(row.company)),
      )) {
        item.status = "excluded";
        item.reasons.push("已有投递或待核对记录");
        continue;
      }
      if (goal.exclude.some((t) => norm(row.company + row.title + row.description).includes(norm(t)))) {
        item.status = "excluded";
        item.reasons.push("命中已保存排除条件");
        continue;
      }
      if (!isGenericJobTitle(row.title) && !matchesJob(row.title, row.description, directions)) {
        item.status = "excluded";
        item.reasons.push("岗位名称与职责未匹配目标方向");
        continue;
      }
      if (!row.company.trim()) {
        item.status = "needs_review";
        item.reasons.push("列表未显示公司名称，暂无法核对岗位身份");
        continue;
      }
      if (stopped || run.detailsRead >= Math.min(budget, goal.limit)) {
        item.reasons.push(stopped ? "前一岗位读取失败，已停止后续读取" : "已达到本次详情读取上限");
        continue;
      }
      try {
        run.detailsRead++;
        const job = await boss.detail(scanId, row.url);
        item.jobId = job.id;
        item.recruitment = classifyBossRecruitment(job.role, row.description, job.jd, job.facts);
        const { kind, conflict } = item.recruitment;
        item.requirements = checkBossRequirements(job.jd, resume.text, goal.cities, kind, {
          title: job.role, facts: job.facts,
        });
        const otherRole = bossDirectionConflict(job.jd, directions);
        if (otherRole) {
          item.requirements.push({ label: "岗位职责", quote: otherRole, status: "unknown" });
          item.reasons.push("JD 中写的招聘岗位与标题方向不一致");
        }
        item.skillMatches = bossSkillEvidence(job.jd, resume.text);
        item.evidence = [...new Set(item.skillMatches.map((match) => match.resumeQuote))].slice(0, 3);

        if (goal.exclude.some((t) => norm(job.company + job.role + job.jd).includes(norm(t))) ||
            !matchesJob(job.role, job.jd, directions)) {
          item.status = "excluded";
          item.reasons.push("完整 JD 不符合方向或排除条件");
          continue;
        }
        const mismatches = item.requirements.filter(({ status }) => status === "mismatch");
        const unknown = item.requirements.filter(({ status }) => status === "unknown");
        const differentType = recruitment !== "all" && kind !== "unknown" && kind !== recruitment;
        item.status = differentType || mismatches.length ? "excluded"
          : kind === "unknown" || unknown.length ? "needs_review" : "candidate";

        if (differentType) item.reasons.push(`岗位类型为${recruitmentLabels[kind]}，本轮搜索选了${recruitmentLabels[recruitment]}`);
        if (kind === "unknown")
          item.reasons.push(conflict ? "招聘类型的描述有冲突" : "完整 JD 和岗位名称未能确认招聘类型");
        if (mismatches.length) item.reasons.push([...new Set(mismatches.map(({ label }) => label))].join("、") + "与已知条件不符");
        if (unknown.length) item.reasons.push([...new Set(unknown.map(({ label }) => label))].join("、") + "缺少明确依据");
      } catch {
        item.status = "needs_review";
        item.reasons.push("完整 JD 读取失败，请在浏览器检查登录、验证或页面变化");
        stopped = true;
      } finally {
        this.workspace.store.put("boss-shortlist", run);
      }
    }
    this.workspace.store.put("boss-shortlist", run);
    return run;
  }
}
