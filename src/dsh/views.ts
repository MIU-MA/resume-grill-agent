import { Workspace, type Job, type Resume } from "../service.js";
import type { TailoringPlan } from "../domain/resume-tailoring.js";
import { Tasks, type Goal, type Batch } from "../tasks.js";
import { smtpConfigured } from "../smtp.js";
export type Proposal = {
  id: string;
  resumeId: string;
  jobId: string;
  plan: TailoringPlan;
};
export type NativeView =
  | ReturnType<typeof reviewView>
  | ReturnType<typeof applicationView>
  | ReturnType<typeof goalView>
  | ReturnType<typeof batchView>
  | ReturnType<typeof workspaceView>;
export function reviewView(
  workspace: Workspace,
  resumeId: string,
  jobId: string,
  proposalId?: string,
) {
  const resume = workspace.store.get<Resume>("resume", resumeId),
    job = workspace.store.get<Job>("job", jobId);
  const proposal = proposalId
    ? workspace.store.get<Proposal>("proposal", proposalId)
    : workspace.store
        .list<Proposal>("proposal")
        .find((p) => p.resumeId === resumeId && p.jobId === jobId);
  if (proposal && (proposal.resumeId !== resumeId || proposal.jobId !== jobId))
    throw new Error("建议与简历或岗位不一致。");
  return {
    v: 1 as const,
    kind: "review" as const,
    resumeId,
    jobId,
    sourceText: resume.text,
    job,
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
    sendingEnabled:
      process.env.RESUME_ALLOW_SEND === "1" &&
      !!workspace.send &&
      smtpConfigured(),
  };
}
export function goalView(workspace: Workspace, goalId: string) {
  return {
    v: 1 as const,
    kind: "goal" as const,
    goal: workspace.store.get<Goal>("goal", goalId),
    candidates: new Tasks(workspace).candidates(goalId),
  };
}
export function batchView(workspace: Workspace, id: string) {
  return {
    v: 1 as const,
    kind: "batch" as const,
    batch: workspace.store.get<Batch>("batch", id),
    jobs: workspace.store
      .list<Job>("job")
      .map(({ id, role, company }) => ({ id, role, company })),
  };
}
export function workspaceView(workspace: Workspace) {
  return {
    v: 1 as const,
    kind: "workspace" as const,
    resumes: workspace.store
      .list<Resume>("resume")
      .filter((r) => !r.parentId)
      .map(({ id, name }) => ({ id, name })),
    jobs: workspace.store
      .list<Job>("job")
      .map(({ id, role, company }) => ({ id, role, company })),
    goals: workspace.store.list<Goal>("goal"),
  };
}
export function viewFor(
  workspace: Workspace,
  operation: string,
  args: any,
  value: any,
): NativeView | undefined {
  if (operation === "review_context" || operation === "propose_resume_changes")
    return reviewView(
      workspace,
      args.resumeId,
      args.jobId,
      operation === "propose_resume_changes" ? value.id : undefined,
    );
  if (
    operation === "preview_application" ||
    operation === "prepare_application"
  )
    return applicationView(workspace, value.id);
  if (
    ["save_search_goal", "discover_jobs", "goal_candidates"].includes(operation)
  )
    return goalView(workspace, args.goalId ?? value.id);
  if (operation === "prepare_application_batch")
    return batchView(workspace, value.id);
  if (operation === "list_workspace") return workspaceView(workspace);
}
