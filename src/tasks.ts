import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import type { Workspace, Resume, Job, Application } from "./service.js";
import { readCareerPage } from "./careers/public-page.js";
import { sourceUrlSchema, type CareerPage } from "./careers/contracts.js";
import { crawlCareerSites } from "./careers/sites.js";
import { matchesJob } from "./domain/job-search.js";
import {
  tailoringSections,
  groundedTailoringSchema,
  tailoredOriginalResumeText,
  tailoringChangeKey,
} from "./domain/resume-tailoring.js";

export const goalInput = z
  .object({
    resumeId: z.string(),
    directions: z.array(z.string().trim().min(1).max(80)).min(1).max(8),
    cities: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
    exclude: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
    sources: z.array(sourceUrlSchema).max(12).default([]),
    limit: z.number().int().min(1).max(20).default(10),
    skipAppliedCompanies: z.boolean().default(true),
  })
  .strict();
export type Goal = z.infer<typeof goalInput> & {
  id: string;
  createdAt: number;
};
export type Candidate = {
  jobId: string;
  reasons: string[];
  locationVerified: boolean;
  emailReady: boolean;
};
export type SearchRun = {
  id: string;
  goalId: string;
  createdAt: number;
  status: "running" | "complete" | "partial";
  candidates: Candidate[];
  sources: Array<{
    url: string;
    status: "read" | "failed" | "pending";
    error?: string;
  }>;
  notes: string[];
};
export type BatchItem = {
  jobId: string;
  status: "prepared" | "blocked" | "already_sent";
  applicationId?: string;
  applicationStatus?: Application["status"];
  reason?: string;
};
export type Batch = {
  id: string;
  goalId: string;
  createdAt: number;
  status: "preparing" | "prepared" | "needs_input";
  items: BatchItem[];
};
export const batchChoice = z
  .object({
    jobId: z.string(),
    proposalId: z.string().optional(),
    accepted: z.array(z.string()).default([]),
    keepOriginal: z.boolean().default(false),
  })
  .strict();
const normalized = (s: string) =>
  s.normalize("NFKC").replace(/\s/g, "").toLowerCase();

const pendingBatches = new Map<string, Promise<Batch>>();

export class Tasks {
  constructor(
    readonly workspace: Workspace,
    readonly read: typeof readCareerPage = readCareerPage,
  ) {}
  saveGoal(value: unknown) {
    const data = goalInput.parse(value);
    this.workspace.store.get<Resume>("resume", data.resumeId);
    const goal = { ...data, id: randomUUID(), createdAt: Date.now() };
    this.workspace.store.put("goal", goal);
    return goal;
  }
  private applied(job: Job, goal: Goal) {
    const store = this.workspace.store;
    return this.workspace.history().some((item) => {
      if (!["sent", "sending", "uncertain"].includes(item.status)) return false;
      const previous = store.get<Job>("job", item.jobId);
      return (
        (previous.sourceUrl === job.sourceUrl &&
          normalized(previous.role) === normalized(job.role)) ||
        (goal.skipAppliedCompanies &&
          !!job.company.trim() &&
          normalized(previous.company) === normalized(job.company))
      );
    });
  }
  private assess(job: Job, goal: Goal): Candidate | undefined {
    const haystack = normalized(`${job.company}\n${job.role}\n${job.jd}`);
    if (
      goal.exclude.some((term) => haystack.includes(normalized(term))) ||
      !matchesJob(job.role, job.jd, goal.directions) ||
      this.applied(job, goal)
    )
      return;
    const city = goal.cities.find((city) =>
      normalized(job.jd).includes(normalized(city)),
    );
    return {
      jobId: job.id,
      reasons: [
        `岗位名称或职责命中：${goal.directions.filter((direction) => matchesJob(job.role, job.jd, [direction])).join("、")}`,
        city
          ? `岗位正文出现：${city}`
          : goal.cities.length
            ? "未取得工作地点证据，需核对"
            : "未限制城市",
        job.recipient
          ? "已保存投递邮箱，发送前请核对来源"
          : "尚未确认投递邮箱，保留官网渠道",
      ],
      locationVerified: !goal.cities.length || !!city,
      emailReady: !!job.recipient,
    };
  }
  async discover(goalId: string) {
    const store = this.workspace.store,
      goal = store.get<Goal>("goal", goalId);
    const urls = [
      ...new Set(
        goal.sources.length
          ? goal.sources
          : crawlCareerSites.map((site) => site.url),
      ),
    ];
    const run: SearchRun = {
      id: randomUUID(),
      goalId,
      createdAt: Date.now(),
      status: "running",
      candidates: [],
      sources: urls.map((url) => ({ url, status: "pending" })),
      notes: [],
    };
    store.put("search", run);
    const deadline = Date.now() + 40000;
    let pages = 0;
    const seen = new Set<string>();
    const consume = (page: CareerPage) => {
      const rows = page.jobs?.length
        ? page.jobs
        : page.role && page.jobDescription
          ? [
              {
                role: page.role,
                company: page.company,
                jobDescription: page.jobDescription,
                recommendedEmail: page.recommendedEmail,
                emailAmbiguous: page.emails.length !== 1,
              },
            ]
          : [];
      for (const row of rows) {
        if (!row.jobDescription?.trim() || run.candidates.length >= goal.limit)
          continue;
        // Multiple embedded positions do not have stable detail URLs in every site.
        const sourceUrl = page.url;
        const recipient =
          !row.emailAmbiguous && row.recommendedEmail
            ? row.recommendedEmail
            : undefined;
        const provisional = {
          id: "",
          company: row.company || page.company,
          role: row.role,
          jd: row.jobDescription,
          sourceUrl,
          ...(recipient ? { recipient } : {}),
        };
        const candidate = this.assess(provisional, goal);
        if (!candidate) continue;
        const key = `${sourceUrl}\n${normalized(row.role)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const job = this.workspace.addJob(provisionalWithoutId(provisional));
        run.candidates.push({ ...candidate, jobId: job.id });
      }
    };
    for (const source of run.sources.slice(0, 6)) {
      if (
        Date.now() >= deadline ||
        pages >= 10 ||
        run.candidates.length >= goal.limit
      )
        break;
      try {
        const host = new URL(source.url).hostname.replace(/^www\./, "");
        const sameHost = (url: string) =>
          new URL(url).hostname.replace(/^www\./, "") === host;
        pages++;
        const page = await this.read(
          source.url,
          0,
          Math.min(deadline, Date.now() + 6000),
          sameHost,
        );
        source.status = "read";
        consume(page);
        for (const link of (page.links ?? [])
          .filter(
            (link) =>
              link.kind === "job" &&
              sameHost(link.url) &&
              matchesJob(link.label, "", goal.directions),
          )
          .slice(0, 2)) {
          if (
            pages >= 10 ||
            Date.now() >= deadline ||
            run.candidates.length >= goal.limit
          )
            break;
          try {
            pages++;
            const detail = await this.read(
              link.url,
              0,
              Math.min(deadline, Date.now() + 6000),
              sameHost,
            );
            consume(detail);
          } catch (error) {
            run.notes.push(
              `详情读取失败：${link.url}（${error instanceof Error ? error.message : "未知错误"}）`,
            );
          }
        }
      } catch (error) {
        source.status = "failed";
        source.error = error instanceof Error ? error.message : "读取失败";
      }
      store.put("search", run);
    }
    run.status =
      run.notes.length || run.sources.some((source) => source.status !== "read")
        ? "partial"
        : "complete";
    run.notes.push(
      "仅使用公开网页实际提取的 JD；不把搜索摘要或招聘入口当成具体岗位。动态列表及登录页可能无法读取。",
    );
    if (!run.candidates.length)
      run.notes.push(
        "本次没有取得满足条件的具体岗位；查看读取范围和失败原因，可让宿主浏览器读取其他官网后导入。",
      );
    store.put("search", run);
    return run;
  }
  candidates(goalId: string) {
    const goal = this.workspace.store.get<Goal>("goal", goalId),
      seen = new Set<string>();
    return this.workspace.store
      .list<Job>("job")
      .flatMap((job) => {
        const key = `${job.sourceUrl}\n${normalized(job.role)}`;
        if (seen.has(key)) return [];
        seen.add(key);
        const assessment = this.assess(job, goal);
        return assessment ? [{ ...assessment, job }] : [];
      })
      .slice(0, goal.limit);
  }
  async prepareBatch(goalId: string, choices: unknown) {
    const selected = z
      .array(batchChoice)
      .min(1)
      .max(20)
      .refine(
        (items) => new Set(items.map((i) => i.jobId)).size === items.length,
        "岗位不能重复",
      )
      .parse(choices);
    const requestHash = createHash("sha256")
      .update(
        JSON.stringify({
          goalId,
          selected: selected
            .map((choice) => ({
              ...choice,
              accepted: [...new Set(choice.accepted)].sort(),
            }))
            .sort((a, b) => a.jobId.localeCompare(b.jobId)),
        }),
      )
      .digest("hex");
    const key = JSON.stringify([this.workspace.store.home, requestHash]);
    const pending = pendingBatches.get(key);
    if (pending) return pending;
    const task = this.buildBatch(goalId, selected, requestHash);
    pendingBatches.set(key, task);
    try {
      return await task;
    } finally {
      if (pendingBatches.get(key) === task) pendingBatches.delete(key);
    }
  }
  batchSnapshot(id: string) {
    const batch = this.workspace.store.get<Batch>("batch", id);
    return {
      ...batch,
      items: batch.items.map((item) => ({
        ...item,
        ...(item.applicationId
          ? {
              applicationStatus: this.workspace.preview(item.applicationId)
                .status,
            }
          : {}),
      })),
    };
  }
  private async buildBatch(
    goalId: string,
    selected: z.infer<typeof batchChoice>[],
    requestHash: string,
  ) {
    const store = this.workspace.store,
      goal = store.get<Goal>("goal", goalId),
      source = store.get<Resume>("resume", goal.resumeId);
    const { batch, owned } = store.transaction(() => {
      const existing = store
        .list<Batch & { requestHash: string }>("batch")
        .find((item) => item.requestHash === requestHash);
      if (existing && existing.status !== "needs_input")
        return { batch: existing, owned: false };
      const batch: Batch & { requestHash: string } = existing ?? {
        requestHash,
        id: randomUUID(),
        goalId,
        createdAt: Date.now(),
        status: "preparing",
        items: [],
      };
      batch.status = "preparing";
      store.put("batch", batch);
      return { batch, owned: true };
    });
    if (!owned) return batch;
    for (const choice of selected) {
      const previous = batch.items.find((item) => item.jobId === choice.jobId);
      if (previous && previous.status !== "blocked") continue;
      const item: BatchItem = { jobId: choice.jobId, status: "blocked" };
      if (previous) batch.items[batch.items.indexOf(previous)] = item;
      else batch.items.push(item);
      try {
        const job = store.get<Job>("job", choice.jobId);
        if (this.applied(job, goal)) {
          item.status = "already_sent";
          item.reason = "已有提交或待核对的投递，不重复准备。";
          continue;
        }
        const candidate = this.assess(job, goal);
        if (!candidate) throw new Error("岗位不符合当前目标或命中排除条件。");
        if (!candidate.locationVerified)
          throw new Error("JD 尚无目标城市证据，请核对地点后再准备。");
        if (!job.recipient)
          throw new Error("尚无明确招聘邮箱；需核对投递渠道，不猜测邮箱。");
        let plan: unknown;
        if (choice.keepOriginal) {
          if (choice.accepted.length)
            throw new Error("保留原文与接受修改不能同时选择。");
          plan = {
            company: "",
            role: "",
            sectionOrder: tailoringSections(source.text).map((s) => s.id),
            changes: [],
            highlights: [],
            gaps: [],
          };
        } else {
          if (!choice.proposalId)
            throw new Error("先查看岗位修改建议，或明确选择保留原文。");
          const proposal = store.get<{
            resumeId: string;
            jobId: string;
            plan: unknown;
          }>("proposal", choice.proposalId);
          if (proposal.resumeId !== goal.resumeId || proposal.jobId !== job.id)
            throw new Error("建议与当前简历或岗位不一致。");
          plan = proposal.plan;
        }
        const validated = groundedTailoringSchema(source.text, job.jd).parse(
          plan,
        );
        const keys = new Set(validated.changes.map(tailoringChangeKey));
        if (choice.accepted.some((key) => !keys.has(key)))
          throw new Error("接受项不属于这份修改建议。");
        const targetText = tailoredOriginalResumeText(
          source.text,
          tailoringSections(source.text),
          validated,
          new Set(choice.accepted),
        );
        const version =
          store
            .list<Resume>("resume")
            .find(
              (item) =>
                item.parentId === goal.resumeId &&
                item.jobId === job.id &&
                item.text === targetText,
            ) ??
          (await this.workspace.saveVersion(
            goal.resumeId,
            job.id,
            validated,
            choice.accepted,
          ));
        const application = await this.workspace.prepare(
          job.id,
          version.id,
          job.recipient,
          `应聘${job.role}`,
          `您好：\n\n我想应聘${job.company || "贵公司"}的${job.role}岗位。附件是针对该岗位整理的简历。\n\n感谢查看。`,
        );
        item.status = "prepared";
        item.applicationId = application.id;
      } catch (error) {
        item.reason = error instanceof Error ? error.message : "准备失败";
      } finally {
        store.put("batch", batch);
      }
    }
    batch.status = batch.items.every(
      (item) => item.status === "prepared" || item.status === "already_sent",
    )
      ? "prepared"
      : "needs_input";
    store.put("batch", batch);
    return batch;
  }
}
function provisionalWithoutId({ id, ...job }: Job) {
  return job;
}
