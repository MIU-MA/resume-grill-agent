import { z } from "zod";
import { createHash } from "node:crypto";
import { Workspace } from "../../core/workspace.js";
import {
  applicationView,
  batchView,
  goalView,
  reviewView,
  workspaceView,
  resumeView,
  profileView,
  type NativeView,
} from "./views.js";
import { Tasks, goalInput, type Goal } from "../../core/tasks.js";
import { mailSendingEnabled } from "../../infrastructure/smtp.js";
import { viewReference } from "./card-model.js";
import { applicationMail } from "../../domain/application-mail.js";
import { Careers } from "../../core/careers.js";
import { sourceUrlSchema } from "../../infrastructure/careers/contracts.js";
import { ResumeProfiles } from "../../core/resume-profiles.js";
import { bossAction, bossActionSchema } from "./boss-actions.js";
import { ApplicationFollowups, followupChannel, followupFields } from "../../core/application-followups.js";
import {
  hasCapability,
  capabilityLabels,
  type Capability,
} from "../../shared/capabilities.js";
const actionSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("record-website-submission"),
    resumeId: z.uuid(), jobId: z.uuid(), goalId: z.uuid().optional(),
  }),
  z.strictObject({
    action: z.literal("save-application-followup"), channel: followupChannel,
    applicationId: z.string().min(1).max(128), revision: z.number().int().min(0), data: followupFields,
  }),
  z.object({ action: z.literal("workspace") }).strict(),
  z.object({ action: z.literal("resume"), id: z.string() }).strict(),
  z
    .object({
      action: z.literal("profile"),
      resumeId: z.string(),
      jobId: z.string().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("confirm-profile"),
      id: z.string(),
      data: z.unknown(),
      jobId: z.string().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("create-resume"),
      name: z.string(),
      text: z.string(),
    })
    .strict(),
  z
    .object({
      action: z.literal("rename-resume"),
      id: z.string(),
      name: z.string(),
    })
    .strict(),
  z.object({ action: z.literal("duplicate-resume"), id: z.string() }).strict(),
  z.object({ action: z.literal("trash-resume"), id: z.string() }).strict(),
  z.object({ action: z.literal("restore-resume"), id: z.string() }).strict(),
  z
    .object({
      action: z.literal("save-resume"),
      resumeId: z.string(),
      jobId: z.string().optional(),
      text: z.string(),
    })
    .strict(),
  z
    .object({
      action: z.literal("save-version"),
      resumeId: z.string(),
      jobId: z.string(),
      proposalId: z.string(),
      accepted: z.array(z.string()),
    })
    .strict(),
  z
    .object({
      action: z.literal("scan-site"),
      url: sourceUrlSchema,
      keywords: z.array(z.string().min(1).max(80)).max(8).default([]),
    })
    .strict(),
  z
    .object({
      action: z.literal("read-job"),
      url: sourceUrlSchema,
      resumeId: z.string().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("update-jd"),
      id: z.string(),
      resumeId: z.string(),
      jd: z.string().min(1).max(20000),
    })
    .strict(),
  z.object({ action: z.literal("import"), path: z.string().min(1) }).strict(),
  z.object({ action: z.literal("goal"), goalId: z.string() }).strict(),
  z.object({ action: z.literal("discover"), goal: goalInput }).strict(),
  z
    .object({
      action: z.literal("review"),
      resumeId: z.string(),
      jobId: z.string(),
      goalId: z.string().optional(),
    })
    .strict(),
  z.object({ action: z.literal("application"), id: z.string() }).strict(),
  z.strictObject({
    action: z.literal("prepare-direct-mail"),
    resumeId: z.uuid(),
    recipient: z.string().trim().pipe(applicationMail.shape.recipient),
  }),
  z
    .object({
      action: z.literal("revise"),
      id: z.string(),
      digest: z.string(),
      ...applicationMail.shape,
    })
    .strict(),
  z.object({ action: z.literal("batch-view"), id: z.string() }).strict(),
  z
    .object({
      action: z.literal("prepare"),
      resumeId: z.string(),
      jobId: z.string(),
      proposalId: z.string(),
      accepted: z.array(z.string()),
      goalId: z.string().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("batch"),
      goalId: z.string(),
      choices: z.unknown(),
    })
    .strict(),
  z.object({ action: z.literal("check"), id: z.string() }).strict(),
  z
    .object({
      action: z.literal("send"),
      id: z.string(),
      digest: z.string(),
      acknowledged: z.literal(true),
      confirmation: z.literal("发送"),
    })
    .strict(),
]);
const mailActions = new Set([
  "application",
  "prepare-direct-mail",
  "revise",
  "batch-view",
  "prepare",
  "batch",
  "check",
  "send",
]);
const actionName = z.object({ action: z.string() });

export function requireCapability(
  workspace: Workspace,
  capability: Capability,
) {
  if (!hasCapability(workspace.capabilities, capability))
    throw new Error(capabilityLabels[capability] + "模块未启用。");
}

/** Human command surface only. This function is never registered as an agent tool. */
export async function humanAction(
  workspace: Workspace,
  value: unknown,
  tasks = new Tasks(workspace),
): Promise<NativeView> {
  const { action } = actionName.parse(value);
  if (action === "boss" || action.startsWith("boss-")) {
    requireCapability(workspace, "boss");
    const parsed = bossActionSchema.safeParse(value);
    if (!parsed.success) {
      if (parsed.error.issues.some((issue) => issue.path[0] === "action"))
        throw new Error("当前插件后端不支持这个 BOSS 操作。请完全退出 DSH 后重新打开，再回到投递任务。");
      throw new Error("这次 BOSS 操作的参数不完整。请重新打开任务后再试。");
    }
    return bossAction(workspace, parsed.data, (request) =>
      humanAction(workspace, request),
    );
  }
  const input = actionSchema.parse(value);
  if (mailActions.has(input.action)) requireCapability(workspace, "mail");
  if (input.action === "profile" || input.action === "confirm-profile")
    requireCapability(workspace, "website");
  if (input.action === "workspace") return workspaceView(workspace);
  if (input.action === "prepare-direct-mail") {
    const application = await workspace.prepareDirectMail(input.resumeId, input.recipient);
    return applicationView(workspace, workspace.latestApplication(application.id).id);
  }
  if (input.action === "record-website-submission") {
    requireCapability(workspace, "website");
    const { resumeId, jobId, goalId } = input;
    reviewView(workspace, resumeId, jobId, undefined, goalId);
    new ApplicationFollowups(workspace).recordWebsiteSubmission(jobId);
    return reviewView(workspace, resumeId, jobId, undefined, goalId);
  }
  if (input.action === "save-application-followup") {
    requireCapability(workspace, input.channel);
    new ApplicationFollowups(workspace).save(input.channel, input.applicationId, input.revision, input.data);
    return workspaceView(workspace);
  }
  if (input.action === "resume") return resumeView(workspace, input.id);
  if (input.action === "profile")
    return profileView(workspace, input.resumeId, input.jobId);
  if (input.action === "confirm-profile") {
    const profile = new ResumeProfiles(workspace).confirm(input.id, input.data);
    return profileView(workspace, profile.resumeId, input.jobId);
  }
  if (input.action === "create-resume")
    return resumeView(
      workspace,
      (await workspace.createResume(input.name, input.text)).id,
    );
  if (input.action === "rename-resume") {
    workspace.renameResume(input.id, input.name);
    return workspaceView(workspace);
  }
  if (input.action === "duplicate-resume") {
    return resumeView(workspace, workspace.duplicateResume(input.id).id);
  }
  if (input.action === "trash-resume") {
    workspace.trashResume(input.id);
    return workspaceView(workspace);
  }
  if (input.action === "restore-resume") {
    workspace.restoreResume(input.id);
    return workspaceView(workspace);
  }
  if (input.action === "save-resume") {
    const version = await workspace.saveEditedResume(
      input.resumeId,
      input.text,
      input.jobId,
    );
    return resumeView(workspace, version.id);
  }
  if (input.action === "scan-site") {
    await new Careers(workspace).scan(input.url, input.keywords);
    return workspaceView(workspace);
  }
  if (input.action === "read-job") {
    const job = await new Careers(workspace).read(input.url);
    return input.resumeId
      ? reviewView(workspace, input.resumeId, job.id)
      : workspaceView(workspace);
  }
  if (input.action === "update-jd") {
    const old = workspace.store.get<any>("job", input.id);
    const { id, ...data } = old;
    const job = workspace.addJob({ ...data, jd: input.jd });
    return reviewView(workspace, input.resumeId, job.id);
  }
  if (input.action === "save-version") {
    const view = reviewView(
      workspace,
      input.resumeId,
      input.jobId,
      input.proposalId,
    );
    const latest = workspace.store
      .list<{ id: string; resumeId: string; jobId: string }>("proposal")
      .find((p) => p.resumeId === input.resumeId && p.jobId === input.jobId);
    if (latest?.id !== input.proposalId)
      throw new Error("建议已更新，请重新核对。");
    const version = await workspace.saveVersion(
      input.resumeId,
      input.jobId,
      view.proposal!.plan,
      input.accepted,
    );
    return resumeView(workspace, version.id);
  }
  if (input.action === "import") {
    await workspace.importResume(input.path);
    return workspaceView(workspace);
  }
  if (input.action === "goal") return goalView(workspace, input.goalId);
  if (input.action === "discover") {
    const goal = tasks.saveGoal(input.goal);
    await tasks.discover(goal.id);
    return goalView(workspace, goal.id);
  }
  if (input.action === "review")
    return reviewView(
      workspace,
      input.resumeId,
      input.jobId,
      undefined,
      input.goalId,
    );
  if (input.action === "application")
    return applicationView(workspace, input.id);
  if (input.action === "revise") {
    const { id, digest, action: _, ...mail } = input;
    const application = await workspace.reviseApplication(id, digest, mail);
    return applicationView(workspace, application.id);
  }
  if (input.action === "batch-view") return batchView(workspace, input.id);
  if (input.action === "batch") {
    const batch = await new Tasks(workspace).prepareBatch(
      input.goalId,
      input.choices,
    );
    return batchView(workspace, batch.id);
  }
  if (input.action === "prepare") {
    const view = reviewView(
      workspace,
      input.resumeId,
      input.jobId,
      input.proposalId,
      input.goalId,
    );
    const latest = workspace.store
      .list<{ id: string; resumeId: string; jobId: string }>("proposal")
      .find((p) => p.resumeId === input.resumeId && p.jobId === input.jobId);
    if (latest?.id !== input.proposalId)
      throw new Error("建议已更新，请重新核对再选择。");
    if (!view.job.recipient)
      throw new Error("尚无明确招聘邮箱，请先让助手核对投递渠道。");
    const goal = input.goalId
      ? workspace.store.get<Goal>("goal", input.goalId)
      : (workspace.store
          .list<Goal>("goal")
          .find(
            (g) =>
              g.resumeId === input.resumeId &&
              g.directions.length === 1 &&
              g.directions[0] === view.job.role &&
              !g.cities.length &&
              !g.exclude.length &&
              !g.skipAppliedCompanies,
          ) ??
        new Tasks(workspace).saveGoal({
          resumeId: input.resumeId,
          directions: [view.job.role],
          skipAppliedCompanies: false,
        }));
    const batch = await new Tasks(workspace).prepareBatch(goal.id, [
      {
        jobId: input.jobId,
        proposalId: input.proposalId,
        accepted: input.accepted,
      },
    ]);
    const item = batch.items[0];
    if (!item?.applicationId)
      throw new Error(
        batch.status === "preparing"
          ? "这批投递正在准备，请稍后核对结果。"
          : (item?.reason ?? "邮件未准备。"),
      );
    return applicationView(workspace, item.applicationId);
  }
  if (input.action === "check") {
    await workspace.execute(input.id, true);
    return applicationView(workspace, input.id);
  }
  // One immutable preview, checked before the one-use approval is created.
  if (!mailSendingEnabled(workspace))
    throw new Error("未启用真实发送或邮箱配置不完整。");
  workspace.approve(input.id, input.digest);
  await workspace.execute(input.id, false);
  return applicationView(workspace, input.id);
}

const restorableActions = new Set([
  "workspace",
  "boss",
  "goal",
  "review",
  "application",
  "batch-view",
  "resume",
  "profile",
]);

export async function restoreView(workspace: Workspace, reference: unknown) {
  if (!reference) return null;
  const { action } = actionName.parse(reference);
  if (!restorableActions.has(action)) throw new Error("恢复引用只能查询记录。");
  if (action === "profile") {
    requireCapability(workspace, "website");
    const input = actionSchema.parse(reference);
    if (
      input.action !== "profile" ||
      !new ResumeProfiles(workspace).current(input.resumeId)
    )
      throw new Error("简历资料已变更，请重新解析并核对。");
  }
  return humanAction(workspace, reference);
}

/** Persist only a domain reference for each conversation card, never an approval. */
export async function cardAction(
  workspace: Workspace,
  sessionId: string,
  cardId: string,
  value: any,
) {
  z.string().min(1).max(200).parse(sessionId);
  z.string().min(1).max(200).parse(cardId);
  const id = createHash("sha256")
    .update(JSON.stringify([sessionId, cardId]))
    .digest("hex");
  if (value?.action === "restore") {
    const saved = workspace.store
      .list<{ id: string; reference: unknown }>("dsh-card")
      .find((item) => item.id === id);
    return restoreView(workspace, saved?.reference ?? value.reference);
  }
  const view = await humanAction(workspace, value);
  const reference = viewReference(view);
  if (reference) workspace.store.put("dsh-card", { id, reference });
  return view;
}
