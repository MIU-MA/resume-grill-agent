import { Boss } from "./boss.js";
import { BossDeliveries } from "./boss-deliveries.js";
import { BossGroups } from "./boss-groups.js";
import { BossShortlists } from "./boss-shortlists.js";
import type { Goal } from "./tasks.js";
import type { Workspace } from "./workspace.js";
import { bossBatchLimit, type BossBrowserChoice, type BossScan } from "../domain/boss.js";
import { bossSearchQuery, type BossRecruitmentFilter } from "../domain/boss-recruitment.js";
import { extname } from "node:path";

export class BossAutoPrepare {
  constructor(readonly workspace: Workspace) {}

  async run(input: {
    resumeId: string;
    query?: string;
    backend?: BossBrowserChoice;
    readCurrent?: boolean;
    recruitment?: BossRecruitmentFilter;
  }) {
    const { resumeId, query, backend, readCurrent, recruitment } = input;
    const resume = this.workspace.resume(resumeId);
    if (resume.jobId)
      return { note: "请选一份主简历。岗位专用版本只用于它对应的岗位。" };
    const hasPdf = extname(resume.pdf ?? resume.original).toLowerCase() === ".pdf";

    const boss = new Boss(this.workspace);
    const previous = readCurrent
      ? this.workspace.store.list<BossScan>("boss-scan")
        .find((scan) => scan.resumeId === resumeId)
      : undefined;
    const found = readCurrent && !boss.needsBrowserConnection(backend)
      ? { scan: await boss.read(resumeId, query ? bossSearchQuery(query, recruitment) : previous?.requestedQuery ?? previous?.query) }
      : await boss.findForResume(resumeId, query ?? previous?.requestedQuery, backend, recruitment);
    if (!found.scan) return { directionNeededFor: resumeId };
    const scan = found.scan;
    if (scan.blocked || !scan.jobs.length)
      return scan.blocked ? {} : { note: "当前页没有可准备的岗位。" };
    const saved = this.workspace.store.list<Goal>("goal")
      .find((goal) => goal.resumeId === resumeId);
    const keyword = scan.query || query || previous?.query;
    const directions = keyword ? [keyword] : saved?.directions;
    if (!directions?.length)
      return { note: "当前页面没有搜索方向，请按简历重新搜索。" };
    const goal: Goal = {
      id: saved?.id ?? scan.id,
      resumeId,
      createdAt: saved?.createdAt ?? scan.createdAt,
      directions,
      cities: saved?.cities ?? [],
      exclude: saved?.exclude ?? [],
      sources: [],
      skipAppliedCompanies: saved?.skipAppliedCompanies ?? true,
      limit: saved?.limit ?? bossBatchLimit,
    };
    const shortlist = await new BossShortlists(this.workspace)
      .collectForGoal(goal, scan.id, bossBatchLimit, recruitment);
    if (!hasPdf) return { note: "岗位筛选结果已更新。添加待投附件需要 PDF，可上传 PDF 或保存岗位版 PDF。" };

    const candidates = shortlist.items
      .filter((item) => item.status === "candidate")
      .sort((a, b) => (b.skillMatches?.length ?? 0) - (a.skillMatches?.length ?? 0));

    const deliveries = new BossDeliveries(this.workspace);
    const seen = new Set(deliveries.list().map((delivery) => delivery.url));
    const ids: string[] = [];
    let skipped = 0;
    for (const { jobId, url } of candidates) {
      if (!jobId || seen.has(url)) continue;
      try {
        ids.push((await deliveries.prepare(resumeId, jobId)).id);
      } catch {
        skipped++;
      }
    }
    const resultNote = skipped
      ? `${skipped} 个岗位未能准备附件，可打开岗位单独检查。`
      : !ids.length
        ? candidates.some(({ url }) => seen.has(url))
          ? "这页匹配的岗位已有待投或处理记录，可在列表中查看。"
          : "这页没有符合条件、且能读到完整 JD 的岗位。"
        : undefined;
    const pending = shortlist.items.filter((item) => item.status === "needs_review").length;
    const note = [resultNote, pending ? `${pending} 个岗位待核对，可在岗位列表查看原因。` : undefined]
      .filter(Boolean).join(" ") || undefined;
    if (!ids.length) return { note };
    const group = await new BossGroups(this.workspace).prepare(ids);
    return { groupFocus: group.id, note };
  }
}
