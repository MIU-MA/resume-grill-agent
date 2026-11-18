import { Workspace, type Job, type Resume } from "../../core/workspace.js";
import type { TailoringPlan } from "../../domain/resume-tailoring.js";
import { Tasks, type Goal, type SearchRun } from "../../core/tasks.js";
import { mailSendingEnabled } from "../../infrastructure/smtp.js";
import { careerSites } from "../../infrastructure/careers/sites.js";
import type { CareerScan } from "../../core/careers.js";
import { ResumeProfiles } from "../../core/resume-profiles.js";
import type { FormRun } from "../../core/form-runs.js";
import { Boss } from "../../core/boss.js";
import type { BossScan, BossRun } from "../../domain/boss.js";
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
export function bossView(workspace: Workspace) {
  return {v:1 as const,kind:"boss" as const,connected:new Boss(workspace).connected,resumes:workspace.listResumes().map(r=>({id:r.id,name:r.name})),scans:workspace.store.list<BossScan>("boss-scan").slice(0,5),runs:workspace.store.list<BossRun>("boss-run")};
}
export function profileView(
  workspace: Workspace,
  resumeId: string,
  jobId?: string,
) {
  return {
    v: 1 as const,
    kind: "profile" as const,
    resume: workspace.resume(resumeId),
    profile: new ResumeProfiles(workspace).draft(resumeId),
    jobId,
  };
}
export function resumeView(workspace: Workspace, id: string) {
  return {
    v: 1 as const,
    kind: "resume" as const,
    resume: workspace.resume(id),
  };
}
export function reviewView(
  workspace: Workspace,
  resumeId: string,
  jobId: string,
  proposalId?: string,
  goalId?: string,
) {
  const resume = workspace.resume(resumeId),
    job = workspace.store.get<Job>("job", jobId);
  const profile = new ResumeProfiles(workspace).current(resumeId);
  const formRun = workspace.store
    .list<FormRun>("form-run")
    .find((r) => r.resumeId === resumeId && r.jobId === jobId);
  const proposal = proposalId
    ? workspace.store.get<Proposal>("proposal", proposalId)
    : workspace.store
        .list<Proposal>("proposal")
        .find((p) => p.resumeId === resumeId && p.jobId === jobId);
  if (proposal && (proposal.resumeId !== resumeId || proposal.jobId !== jobId))
    throw new Error("建议与简历或岗位不一致。");
  if (goalId && workspace.store.get<Goal>("goal", goalId).resumeId !== resumeId)
    throw new Error("目标与当前简历不一致。");
  return {
    v: 1 as const,
    kind: "review" as const,
    resumeId,
    jobId,
    sourceText: resume.text,
    job,
    ...(profile ? { profile } : {}),
    ...(formRun ? { formRun } : {}),
    ...(goalId ? { goalId } : {}),
    ...(proposal ? { proposal } : {}),
  };
}
export function applicationView(workspace: Workspace, id: string) {
  const application = workspace.preview(id),
    job = workspace.store.get<Job>("job", application.jobId);
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
    resumes: resumes.filter((item) => !item.deletedAt).map(summarizeResume),
    deletedResumes: resumes
      .filter((item) => item.deletedAt)
      .map(summarizeResume),
    jobs: workspace.store
      .list<Job>("job")
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
    applications: workspace
      .history()
      .filter((item) => item.status !== "superseded"),
  };
}
export function viewFor(
  workspace: Workspace,
  operation: string,
  args: any,
  value: any,
): NativeView | undefined {
  if(operation.startsWith("boss_")) return bossView(workspace);
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
