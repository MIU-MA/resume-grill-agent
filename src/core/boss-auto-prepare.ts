import { Boss } from "./boss.js";
import { BossDeliveries } from "./boss-deliveries.js";
import { BossGroups } from "./boss-groups.js";
import { BossShortlists } from "./boss-shortlists.js";
import type { Goal } from "./tasks.js";
import type { Workspace } from "./workspace.js";
import type { BossBrowserChoice, BossScan } from "../domain/boss.js";

const detailBudget = 5;
const batchSize = 3;

export class BossAutoPrepare {
  constructor(readonly workspace: Workspace) {}

  async run(input: {
    resumeId: string;
    query?: string;
    backend?: BossBrowserChoice;
    readCurrent?: boolean;
  }) {
    const { resumeId, query, backend, readCurrent } = input;
    const resume = this.workspace.resume(resumeId);
    if (resume.jobId)
      return { note: "请选一份主简历。岗位专用版本只用于它对应的岗位。" };

    const boss = new Boss(this.workspace);
    const previous = readCurrent
      ? this.workspace.store.list<BossScan>("boss-scan")
        .find((scan) => scan.resumeId === resumeId)
      : undefined;
    const found = readCurrent && boss.connected
      ? { scan: await boss.read(resumeId) }
      : await boss.findForResume(resumeId, query, backend);
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
      limit: saved?.limit ?? detailBudget,
    };
    const shortlist = await new BossShortlists(this.workspace)
      .collectForGoal(goal, scan.id, detailBudget);
    const candidates = shortlist.items
      .filter((item) => item.status === "candidate" || item.status === "needs_review")
      .sort((a, b) =>
        Number(b.status === "candidate") - Number(a.status === "candidate") ||
        b.evidence.length - a.evidence.length,
      );

    const deliveries = new BossDeliveries(this.workspace);
    const ids: string[] = [];
    let skipped = 0;
    for (const { jobId } of candidates) {
      if (ids.length >= batchSize) break;
      if (!jobId) continue;
      try {
        ids.push((await deliveries.prepare(resumeId, jobId)).id);
      } catch {
        skipped++;
      }
    }
    const note = skipped
      ? `${skipped} 个岗位未能准备附件，可打开岗位单独检查。`
      : !ids.length
        ? "这页没有符合条件、且能读到完整 JD 的岗位。"
        : undefined;
    if (!ids.length) return { note };
    const group = await new BossGroups(this.workspace).prepare(ids);
    return { groupFocus: group.id, note };
  }
}
