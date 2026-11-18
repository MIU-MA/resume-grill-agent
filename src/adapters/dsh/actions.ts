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
  bossView,
} from "./views.js";
import { Tasks, goalInput, type Goal } from "../../core/tasks.js";
import { mailSendingEnabled } from "../../infrastructure/smtp.js";
import { viewReference } from "./card-model.js";
import { applicationMail } from "../../domain/application-mail.js";
import { Careers } from "../../core/careers.js";
import { sourceUrlSchema } from "../../infrastructure/careers/contracts.js";
import { ResumeProfiles } from "../../core/resume-profiles.js";
import { Boss } from "../../core/boss.js";
import { BossDeliveries } from "../../core/boss-deliveries.js";
import { BossGroups } from "../../core/boss-groups.js";
import { BossShortlists } from "../../core/boss-shortlists.js";
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("boss-check") }).strict(),
  z
    .object({
      action: z.literal("boss-save-review"),
      resumeId: z.string(),
      jobId: z.string(),
      proposalId: z.string(),
      accepted: z.array(z.string()),
    })
    .strict(),
  z
    .object({
      action: z.literal("boss-shortlist"),
      goalId: z.string(),
      scanId: z.string(),
      budget: z.number().int().min(1).max(10),
    })
    .strict(),
  z
    .object({
      action: z.literal("boss-group-prepare"),
      ids: z.array(z.uuid()).min(1).max(10),
    })
    .strict(),
  z
    .object({
      action: z.literal("boss-group-confirm"),
      id: z.uuid(),
      digest: z.string(),
      acknowledged: z.literal(true),
      confirmation: z.literal("投递"),
    })
    .strict(),
  z.object({ action: z.literal("boss-group-pause"), id: z.uuid() }).strict(),
  z
    .object({ action: z.literal("boss-group-remaining"), id: z.uuid() })
    .strict(),
  z.object({ action: z.literal("boss") }).strict(),
  z
    .object({ action: z.literal("boss-link"), link: z.string().max(2000) })
    .strict(),
  z.object({ action: z.literal("boss-unlink") }).strict(),
  z.object({ action: z.literal("boss-connect") }).strict(),
  z
    .object({
      action: z.literal("boss-search"),
      query: z.string().min(1).max(120),
    })
    .strict(),
  z.object({ action: z.literal("boss-read") }).strict(),
  z
    .object({
      action: z.literal("boss-detail"),
      scanId: z.string(),
      url: z.string(),
      resumeId: z.string().optional(),
    })
    .strict(),
  z
    .object({ action: z.literal("boss-refresh"), id: z.string().uuid() })
    .strict(),
  z.object({ action: z.literal("boss-pause"), id: z.string().uuid() }).strict(),
  z
    .object({
      action: z.literal("boss-prepare"),
      resumeId: z.string(),
      jobId: z.string(),
    })
    .strict(),
  z
    .object({
      action: z.literal("boss-delivery-refresh"),
      id: z.string().uuid(),
    })
    .strict(),
  z
    .object({ action: z.literal("boss-delivery-pause"), id: z.string().uuid() })
    .strict(),
  z
    .object({ action: z.literal("boss-preview"), id: z.string().uuid() })
    .strict(),
  z
    .object({
      action: z.literal("boss-confirm"),
      id: z.string().uuid(),
      digest: z.string(),
      acknowledged: z.literal(true),
      confirmation: z.literal("投递"),
    })
    .strict(),
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
export async function humanAction(
  workspace: Workspace,
  value: unknown,
  tasks = new Tasks(workspace),
) {
  const input = actionSchema.parse(value);
  const boss = new Boss(workspace);
  const groups = new BossGroups(workspace);
  if (input.action === "boss-shortlist") {
    await new BossShortlists(workspace).collect(
      input.goalId,
      input.scanId,
      input.budget,
    );
    return bossView(workspace);
  }
  if (input.action === "boss-group-prepare") {
    await groups.prepare(input.ids);
    return bossView(workspace);
  }
  if (input.action === "boss-group-confirm") {
    await groups.start(input.id, input.digest);
    return bossView(workspace);
  }
  if (input.action === "boss-group-pause") {
    await groups.pause(input.id);
    return bossView(workspace);
  }
  if (input.action === "boss-group-remaining") {
    await groups.remaining(input.id);
    return bossView(workspace);
  }
  const deliveries = new BossDeliveries(workspace);
  if (input.action === "boss-save-review") {
    const saved = await humanAction(workspace, {
      ...input,
      action: "save-version",
    });
    if (saved?.kind !== "resume") throw new Error("未能保存岗位简历。");
    await deliveries.prepare(saved.resume.id, input.jobId);
    return bossView(workspace);
  }
  if (input.action === "boss-prepare") {
    await deliveries.prepare(input.resumeId, input.jobId);
    return bossView(workspace);
  }
  if (input.action === "boss-delivery-refresh") {
    await deliveries.refresh(input.id);
    return bossView(workspace);
  }
  if (input.action === "boss-delivery-pause") {
    await deliveries.pause(input.id);
    return bossView(workspace);
  }
  if (input.action === "boss-preview") {
    await deliveries.preview(deliveries.get(input.id));
    return bossView(workspace);
  }
  if (input.action === "boss-confirm") {
    await deliveries.confirm(input.id, input.digest);
    return bossView(workspace);
  }
  if (input.action === "boss") return bossView(workspace);
  if (input.action === "boss-link") {
    boss.connect(input.link);
    try {
      await boss.status();
    } catch (error) {
      boss.disconnect();
      throw error;
    }
    return bossView(workspace);
  }
  if (input.action === "boss-check") {
    await boss.status();
    return bossView(workspace);
  }
  if (input.action === "boss-unlink") {
    boss.disconnect();
    return bossView(workspace);
  }
  if (input.action === "boss-connect") {
    await boss.browserConnect();
    return bossView(workspace);
  }
  if (input.action === "boss-search") {
    await boss.search(input.query);
    return bossView(workspace);
  }
  if (input.action === "boss-read") {
    await boss.read();
    return bossView(workspace);
  }
  if (input.action === "boss-detail") {
    const job = await boss.detail(input.scanId, input.url);
    return input.resumeId
      ? reviewView(workspace, input.resumeId, job.id)
      : bossView(workspace);
  }
  if (input.action === "boss-refresh") {
    await boss.refresh(input.id);
    return bossView(workspace);
  }
  if (input.action === "boss-pause") {
    await boss.pause(input.id);
    return bossView(workspace);
  }
  if (input.action === "workspace") return workspaceView(workspace);
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
      ![
        "workspace",
        "boss",
        "goal",
        "review",
        "application",
        "batch-view",
        "resume",
        "profile",
      ].includes(parsed.action)
    )
      throw new Error("恢复引用只能查询记录。");
    return humanAction(workspace, parsed);
  }
  const view = await humanAction(workspace, value);
  const reference = viewReference(view);
  if (reference) workspace.store.put("dsh-card", { id, reference });
  return view;
}
