import { Workspace, type Job, type Resume } from "../../core/workspace.js";
import type { TailoringPlan } from "../../domain/resume-tailoring.js";
import { Tasks, type Batch, type Goal, type SearchRun } from "../../core/tasks.js";
import { mailSendingEnabled } from "../../infrastructure/smtp.js";
import { careerSites } from "../../infrastructure/careers/sites.js";
import type { CareerScan } from "../../core/careers.js";
import { ResumeProfiles } from "../../core/resume-profiles.js";
import type { FormRun } from "../../core/form-runs.js";
import { Boss } from "../../core/boss.js";
import { isBossSource, type BossScan, type BossRun } from "../../domain/boss.js";
import { BossDeliveries } from "../../core/boss-deliveries.js";
import { BossGroups } from "../../core/boss-groups.js";
import { BossArchives } from "../../core/boss-archives.js";
import type { BossShortlist } from "../../core/boss-shortlists.js";
import { hasCapability } from "../../shared/capabilities.js";
import { ApplicationFollowups } from "../../core/application-followups.js";
import { ResumeGrillService } from "../../core/resume-grill.js";
import { auditResumeRisks } from "../../domain/resume-risk-audit.js";
import { buildInterviewGrill } from "../../domain/interview-grill.js";
export type Proposal = {
  id: string;
  resumeId: string;
  jobId: string;
  plan: TailoringPlan;
};
export type NativeView =
  | ReturnType<typeof bossView>
  | ReturnType<typeof profileView>
  | ReturnType<typeof resumeView>
  | ReturnType<typeof reviewView>
  | ReturnType<typeof applicationView>
  | ReturnType<typeof goalView>
  | ReturnType<typeof batchView>
  | ReturnType<typeof workspaceView>;
export function bossView(
  workspace: Workspace,
  options: {
    directionNeededFor?: string;
    deliveryFocus?: string;
    groupFocus?: string;
    note?: string;
  } = {},
) {
  const boss = new Boss(workspace);
  const browserState = boss.browserState;
  const browserSessionId = boss.browserSessionId;
  const scans = workspace.store.list<BossScan>("boss-scan")
    .filter((scan) => !browserSessionId || scan.browserSessionId === browserSessionId)
    .slice(0, 5);
  const shortlists = workspace.store.list<BossShortlist>("boss-shortlist", 5);
  const groups = new BossGroups(workspace).list();
  const deliveries = new BossDeliveries(workspace).list().map(({ previewId, ...d }) => d);
  const focusedItems = groups.find(({ id }) => id === options.groupFocus)?.items ?? [];
  const jobIds = new Set<string>();
  if (options.groupFocus || options.deliveryFocus) {
    for (const delivery of deliveries) {
      if (delivery.id === options.deliveryFocus || focusedItems.some(({ deliveryId }) => deliveryId === delivery.id))
        jobIds.add(delivery.jobId);
    }
  } else {
    for (const shortlist of shortlists.filter(({ scanId }) => scanId === scans[0]?.id)) {
      for (const { jobId } of shortlist.items) if (jobId) jobIds.add(jobId);
    }
  }
  const jobDescriptions = Object.fromEntries([...jobIds].flatMap((id) => {
    try {
      return [[id, workspace.store.get<Job>("job", id).jd] as const];
    } catch {
      return [];
    }
  }));
  return {
    v: 1 as const,
    kind: "boss" as const,
    ...options,
    goals: workspace.store.list<Goal>("goal"),
    shortlists,
    jobDescriptions,
    groups,
    archivedTaskIds: [...new BossArchives(workspace).ids()],
    canEditQueue: true,
    connected: boss.connected,
    browserPreference: boss.browserPreference,
    ...(browserState ? { browserState } : {}),
    resumes: workspace.listResumes().map((r) => ({
      id: r.id,
      name: r.name,
      hasPdf: (r.pdf ?? r.original).toLowerCase().endsWith(".pdf"),
      ...(r.jobId ? { jobId: r.jobId } : {}),
    })),
    scans,
    runs: workspace.store.list<BossRun>("boss-run"),
    deliveries,
  };
}
export function profileView(
  workspace: Workspace,
  resumeId: string,
  jobId?: string,
  goalId?: string,
) {
  return {
    v: 1 as const,
    kind: "profile" as const,
    resume: workspace.resume(resumeId),
    profile: new ResumeProfiles(workspace).draft(resumeId),
    jobId,
    ...(goalId ? { goalId } : {}),
  };
}
export function resumeView(
  workspace: Workspace,
  id: string,
  options: { allowTrashed?: boolean } = {},
) {
  const resume = options.allowTrashed
    ? workspace.store.get<Resume>("resume", id)
    : workspace.resume(id);
  const riskAudit = auditResumeRisks(resume.text);
  const interviewGrill = buildInterviewGrill({
    resumeText: resume.text,
    riskAudit,
  });
  return {
    v: 1 as const,
    kind: "resume" as const,
    capabilities: workspace.capabilities,
    resume,
    riskAudit,
    interviewGrill,
  };
}
export function reviewView(
  workspace: Workspace,
  resumeId: string,
  jobId: string,
  proposalId?: string,
  goalId?: string,
  websiteNotice?: string,
  websiteApprovalId?: string,
  options: { applicationId?: string } = {},
) {
  const resume = options.applicationId
      ? workspace.store.get<Resume>("resume", resumeId)
      : workspace.resume(resumeId),
    job = workspace.store.get<Job>("job", jobId);
  const channel = isBossSource(job.sourceUrl) ? "boss" : "website";
  const website =
    channel === "website" &&
    hasCapability(workspace.capabilities, "website") &&
    !resume.deletedAt;
  const profile = website
    ? new ResumeProfiles(workspace).current(resumeId)
    : undefined;
  const formRun = website
    ? workspace.store
        .list<FormRun>("form-run")
        .find((r) => r.resumeId === resumeId && r.jobId === jobId)
    : undefined;
  const websiteSubmission = website ? new ApplicationFollowups(workspace).websiteSubmission(job) : undefined;
  const proposal = proposalId
    ? workspace.store.get<Proposal>("proposal", proposalId)
    : workspace.store
        .list<Proposal>("proposal")
        .find((p) => p.resumeId === resumeId && p.jobId === jobId);
  if (proposal && (proposal.resumeId !== resumeId || proposal.jobId !== jobId))
    throw new Error("建议与简历或岗位不一致。");
  if (goalId && workspace.store.get<Goal>("goal", goalId).resumeId !== resumeId)
    throw new Error("目标与当前简历不一致。");
  const grill = new ResumeGrillService(workspace).prepareInterviewGrill({
    resumeId,
    jobId,
    ...(options.applicationId ? { applicationId: options.applicationId } : {}),
    ...(proposal ? { proposalId: proposal.id } : {}),
  });
  return {
    v: 1 as const,
    kind: "review" as const,
    channel,
    capabilities: workspace.capabilities,
    resumeId,
    jobId,
    sourceText: resume.text,
    job,
    riskAudit: grill.riskAudit,
    ...(grill.jdGapAnalysis ? { jdGapAnalysis: grill.jdGapAnalysis } : {}),
    interviewGrill: grill.interviewGrill,
    ...(profile ? { profile } : {}),
    ...(formRun ? { formRun } : {}),
    canRecordWebsiteSubmission: website,
    ...(websiteSubmission ? { websiteSubmissionAt: websiteSubmission.submittedAt } : {}),
    ...(websiteNotice ? { websiteNotice } : {}),
    ...(websiteApprovalId ? { websiteApprovalId } : {}),
    ...(goalId ? { goalId } : {}),
    ...(proposal ? { proposal } : {}),
  };
}
export function applicationView(workspace: Workspace, id: string) {
  const application = workspace.preview(id);
  const job = application.jobId ? workspace.store.get<Job>("job", application.jobId) : undefined;
  return {
    v: 1 as const,
    kind: "application" as const,
    application,
    job,
    sendingEnabled: mailSendingEnabled(workspace),
  };
}
export function goalView(workspace: Workspace, goalId: string) {
  return {
    v: 1 as const,
    kind: "goal" as const,
    capabilities: workspace.capabilities,
    goal: workspace.store.get<Goal>("goal", goalId),
    candidates: new Tasks(workspace).candidates(goalId),
    search: workspace.store
      .list<SearchRun>("search")
      .find((run) => run.goalId === goalId),
  };
}
export function batchView(workspace: Workspace, id: string) {
  return {
    v: 1 as const,
    kind: "batch" as const,
    batch: new Tasks(workspace).batchSnapshot(id),
    jobs: workspace.store
      .list<Job>("job")
      .map(({ id, role, company }) => ({ id, role, company })),
  };
}
export function workspaceView(workspace: Workspace) {
  const followups = new ApplicationFollowups(workspace);
  const resumes = workspace.store
    .list<Resume>("resume")
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  const summarizeResume = (resume: Resume) => {
    const job = resume.jobId
      ? workspace.store.get<Job>("job", resume.jobId)
      : undefined;
    return {
      id: resume.id,
      name: resume.name,
      parentId: resume.parentId,
      pdf: resume.pdf,
      original: resume.original,
      createdAt: resume.createdAt,
      updatedAt: resume.updatedAt,
      deletedAt: resume.deletedAt,
      summary: resume.text.slice(0, 160),
      parentName: resumes.find((item) => item.id === resume.parentId)?.name,
      job: job
        ? { id: job.id, role: job.role, company: job.company }
        : undefined,
    };
  };
  return {
    v: 1 as const,
    kind: "workspace" as const,
    capabilities: workspace.capabilities,
    sendingEnabled: hasCapability(workspace.capabilities, "mail") && mailSendingEnabled(workspace),
    resumes: resumes.filter((item) => !item.deletedAt).map(summarizeResume),
    deletedResumes: resumes
      .filter((item) => item.deletedAt)
      .map(summarizeResume),
    jobs: workspace.store
      .list<Job>("job")
      .filter((job) => !isBossSource(job.sourceUrl))
      .filter(
        (job, index, all) =>
          index ===
          all.findIndex(
            (other) =>
              other.sourceUrl === job.sourceUrl && other.role === job.role,
          ),
      )
      .map(({ id, role, company }) => ({ id, role, company })),
    goals: workspace.store.list<Goal>("goal"),
    sites: [
      ...new Map(
        careerSites.map(({ company, url }) => [url, { company, url }]),
      ).values(),
    ],
    scans: workspace.store
      .list<CareerScan>("career-scan")
      .filter(
        (scan, index, all) =>
          index === all.findIndex((other) => other.url === scan.url),
      )
      .map((scan) => ({
        ...scan,
        result: scan.result
          ? {
              ...scan.result,
              pages: scan.result.pages?.map((page) => ({
                ...page,
                jobDescription: undefined,
                jobs: undefined,
              })),
            }
          : undefined,
      })),
    mailBatches: hasCapability(workspace.capabilities, "mail")
      ? workspace.store.list<Batch>("batch").map(({ id, goalId, createdAt, items }) => ({
          id, goalId, createdAt, count: items.length,
        }))
      : [],
    applications: hasCapability(workspace.capabilities, "mail")
      ? workspace.history().filter((item) => item.status !== "superseded")
      : [],
    applicationFollowups: followups.list().filter(({ channel }) => hasCapability(workspace.capabilities, channel)),
    ...(hasCapability(workspace.capabilities, "website") ? { websiteSubmissions: followups.websiteSubmissions() } : {}),
    ...(hasCapability(workspace.capabilities, "boss")
      ? {
          bossDeliveries: new BossDeliveries(workspace)
            .list()
            .filter((d) => d.status !== "prepared"),
        }
      : {}),
  };
}
export function viewFor(
  workspace: Workspace,
  operation: string,
  args: any,
  value: any,
): NativeView | undefined {
  if (operation.startsWith("boss_")) return bossView(workspace);
  if (operation === "review_context" || operation === "propose_resume_changes")
    return reviewView(
      workspace,
      args.resumeId,
      args.jobId,
      operation === "propose_resume_changes" ? value.id : undefined,
      args.goalId,
    );
  if (
    operation === "preview_application" ||
    operation === "prepare_application" ||
    operation === "revise_application"
  )
    return applicationView(workspace, value.id);
  if (
    ["save_search_goal", "discover_jobs", "goal_candidates"].includes(operation)
  )
    return goalView(workspace, args.goalId ?? value.id);
  if (operation === "prepare_application_batch")
    return batchView(workspace, value.id);
  if (operation === "list_workspace") return workspaceView(workspace);
  if (operation === "read_recruiting_site" || operation === "read_job_detail")
    return workspaceView(workspace);
  if (operation === "add_job" || operation === "import_resume")
    return workspaceView(workspace);
}
