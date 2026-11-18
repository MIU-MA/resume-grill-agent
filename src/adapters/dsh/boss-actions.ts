import { z } from "zod";
import type { Workspace } from "../../core/workspace.js";
import { bossView, reviewView, type NativeView } from "./views.js";
import { Boss } from "../../core/boss.js";
import { BossDeliveries } from "../../core/boss-deliveries.js";
import { BossGroups } from "../../core/boss-groups.js";
import { BossShortlists } from "../../core/boss-shortlists.js";

export const bossActionSchema = z.discriminatedUnion("action", [
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
]);

export async function bossAction(
  workspace: Workspace,
  input: z.infer<typeof bossActionSchema>,
  saveVersion: (input: unknown) => Promise<NativeView>,
): Promise<NativeView> {
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
    const saved = await saveVersion({
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
  throw new Error("未知 BOSS 操作。");
}
