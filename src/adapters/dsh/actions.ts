import { z } from "zod";
import { createHash } from "node:crypto";
import { Workspace } from "../../core/workspace.js";
import {
  applicationView,
  batchView,
  goalView,
  reviewView,
  workspaceView,
} from "./views.js";
import { Tasks, type Goal } from "../../core/tasks.js";
import { smtpConfigured } from "../../infrastructure/smtp.js";
import { viewReference } from "./card-model.js";
import { applicationMail } from "../../domain/application-mail.js";
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("workspace") }).strict(),
  z.object({ action: z.literal("goal"), goalId: z.string() }).strict(),
  z
    .object({
      action: z.literal("review"),
      resumeId: z.string(),
      jobId: z.string(),
      goalId: z.string().optional(),
    })
    .strict(),
  z.object({ action: z.literal("application"), id: z.string() }).strict(),
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
/** Human command surface only. This function is never registered as an agent tool. */
export async function humanAction(workspace: Workspace, value: unknown) {
  const input = actionSchema.parse(value);
  if (input.action === "workspace") return workspaceView(workspace);
  if (input.action === "goal") return goalView(workspace, input.goalId);
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
  if (
    process.env.RESUME_ALLOW_SEND !== "1" ||
    !workspace.send ||
    !smtpConfigured()
  )
    throw new Error("未启用真实发送或邮箱配置不完整。");
  workspace.approve(input.id, input.digest);
  await workspace.execute(input.id, false);
  return applicationView(workspace, input.id);
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
    const reference = saved?.reference ?? value.reference;
    if (!reference) return null;
    const parsed = actionSchema.parse(reference);
    if (
      !["workspace", "goal", "review", "application", "batch-view"].includes(
        parsed.action,
      )
    )
      throw new Error("恢复引用只能查询记录。");
    return humanAction(workspace, parsed);
  }
  const view = await humanAction(workspace, value);
  const reference = viewReference(view);
  if (reference) workspace.store.put("dsh-card", { id, reference });
  return view;
}
