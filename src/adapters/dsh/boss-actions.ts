import { z } from "zod";
import type { Workspace } from "../../core/workspace.js";
import { bossView, reviewView, type NativeView } from "./views.js";
import { Boss } from "../../core/boss.js";
import { BossDeliveries } from "../../core/boss-deliveries.js";
import { BossGroups } from "../../core/boss-groups.js";
import { BossShortlists } from "../../core/boss-shortlists.js";
import { BossAutoPrepare } from "../../core/boss-auto-prepare.js";
import { BossArchives, bossTaskKinds } from "../../core/boss-archives.js";
import { bossBatchLimit, bossBrowserChoice } from "../../domain/boss.js";

export const bossActionSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("boss-queue-add"), scanId: z.string().min(1), url: z.string().min(1),
    resumeId: z.string().min(1), groupId: z.uuid().optional(),
  }),
  z.strictObject({
    action: z.literal("boss-queue-resume"), deliveryId: z.uuid(), resumeId: z.string().min(1),
    groupId: z.uuid().optional(),
  }),
  z.strictObject({
    action: z.literal("boss-queue-move"), id: z.uuid(), deliveryId: z.uuid(), step: z.literal([-1, 1]),
  }),
  z.strictObject({ action: z.literal("boss-queue-remove"), id: z.uuid() }),
  z.strictObject({
    action: z.literal("boss-archive-task"),
    kind: z.enum(bossTaskKinds),
    id: z.uuid(),
    archived: z.boolean(),
  }),
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
      ids: z.array(z.uuid()).min(1).max(bossBatchLimit),
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
  z.object({ action: z.literal("boss-group-view"), id: z.uuid() }).strict(),
  z.object({
    action: z.literal("boss-group-remove"),
    id: z.uuid(),
    deliveryId: z.uuid(),
  }).strict(),
  z
    .object({ action: z.literal("boss-group-remaining"), id: z.uuid() })
    .strict(),
  z.object({
    action: z.literal("boss"),
    deliveryFocus: z.uuid().optional(),
    groupFocus: z.uuid().optional(),
  }).strict().refine((input) => !(input.deliveryFocus && input.groupFocus)),
  z
    .object({ action: z.literal("boss-link"), link: z.string().max(2000) })
    .strict(),
  z.object({ action: z.literal("boss-unlink") }).strict(),
  z
    .object({
      action: z.literal("boss-connect"),
      backend: bossBrowserChoice.optional(),
      deliveryFocus: z.uuid().optional(),
      groupFocus: z.uuid().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("boss-search"),
      query: z.string().min(1).max(120),
    })
    .strict(),
  z
    .object({
      action: z.literal("boss-find"),
      resumeId: z.string().min(1),
      query: z.string().trim().min(1).max(120).optional(),
      backend: bossBrowserChoice.optional(),
    })
    .strict(),
  z.object({ action: z.literal("boss-read"), resumeId: z.string().min(1).optional() }).strict(),
  z.object({
    action: z.literal("boss-auto-prepare"),
    resumeId: z.string().min(1),
    query: z.string().trim().min(1).max(120).optional(),
    backend: bossBrowserChoice.optional(),
    readCurrent: z.boolean().optional(),
  }).strict(),
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
  if (input.action === "boss-queue-add") {
    const job = await boss.detail(input.scanId, input.url);
    await groups.add(input.resumeId, job.id, input.groupId);
    return bossView(workspace, { note: `已加入待投：${job.company} · ${job.role}` });
  }
  if (input.action === "boss-queue-resume") {
    const group = await groups.replaceResume(input.deliveryId, input.resumeId, input.groupId);
    return bossView(workspace, { groupFocus: group.id });
  }
  if (input.action === "boss-queue-move") {
    const group = await groups.move(input.id, input.deliveryId, input.step);
    return bossView(workspace, { groupFocus: group.id });
  }
  if (input.action === "boss-queue-remove") {
    groups.removeStandalone(input.id);
    return bossView(workspace, { note: "已移出待投。" });
  }
  if (input.action === "boss-archive-task") {
    if (input.kind === "group") groups.get(input.id);
    new BossArchives(workspace).set(input.kind, input.id, input.archived);
    return bossView(workspace);
  }
  if (input.action === "boss-shortlist") {
    await new BossShortlists(workspace).collect(
      input.goalId,
      input.scanId,
      input.budget,
    );
    return bossView(workspace);
  }
  if (input.action === "boss-group-prepare") {
    const group = await groups.prepare(input.ids);
    return bossView(workspace, { groupFocus: group.id });
  }
  if (input.action === "boss-group-confirm") {
    await groups.start(input.id, input.digest);
    return bossView(workspace, { groupFocus: input.id });
  }
  if (input.action === "boss-group-pause") {
    await groups.pause(input.id);
    return bossView(workspace, { groupFocus: input.id });
  }
  if (input.action === "boss-group-view") {
    return bossView(workspace, { groupFocus: groups.get(input.id).id });
  }
  if (input.action === "boss-group-remove") {
    const group = await groups.removeItem(input.id, input.deliveryId);
    return bossView(workspace, group ? { groupFocus: group.id } : { note: "已移出待投。" });
  }
  if (input.action === "boss-group-remaining") {
    const group = await groups.remaining(input.id);
    return bossView(workspace, { groupFocus: group.id });
  }
  const deliveries = new BossDeliveries(workspace);
  if (input.action === "boss-save-review") {
    const saved = await saveVersion({
      ...input,
      action: "save-version",
    });
    if (saved?.kind !== "resume") throw new Error("未能保存岗位简历。");
    const delivery = await deliveries.prepare(saved.resume.id, input.jobId);
    return bossView(workspace, { deliveryFocus: delivery.id });
  }
  if (input.action === "boss-prepare") {
    const delivery = await deliveries.prepare(input.resumeId, input.jobId);
    return bossView(workspace, { deliveryFocus: delivery.id });
  }
  if (input.action === "boss-delivery-refresh") {
    await deliveries.refresh(input.id);
    return bossView(workspace, { deliveryFocus: input.id });
  }
  if (input.action === "boss-delivery-pause") {
    await deliveries.pause(input.id);
    return bossView(workspace, { deliveryFocus: input.id });
  }
  if (input.action === "boss-preview") {
    await deliveries.preview(deliveries.get(input.id));
    return bossView(workspace, { deliveryFocus: input.id });
  }
  if (input.action === "boss-confirm") {
    await deliveries.confirm(input.id, input.digest);
    return bossView(workspace, { deliveryFocus: input.id });
  }
  if (input.action === "boss") {
    const { deliveryFocus, groupFocus } = input;
    const delivery = deliveries.list().find((d) => d.id === deliveryFocus);
    const pendingGroups = delivery?.status === "prepared" ? groups.list().filter(
      (group) => group.expiresAt !== 0 && group.status === "prepared" &&
        group.items.some((item) => item.deliveryId === delivery.id),
    ) : [];
    const archived = new BossArchives(workspace).ids();
    const pendingGroup = pendingGroups.find((group) => !archived.has(group.id)) ?? pendingGroups[0];
    return bossView(workspace, {
      ...(pendingGroup ? { groupFocus: pendingGroup.id } : delivery ? { deliveryFocus } : {}),
      ...(groupFocus && groups.list().some((g) => g.id === groupFocus) ? { groupFocus } : {}),
    });
  }
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
    await boss.browserDisconnect();
    return bossView(workspace);
  }
  if (input.action === "boss-connect") {
    await boss.browserConnect(input.backend);
    return bossView(workspace, {
      ...(input.groupFocus
        ? { groupFocus: input.groupFocus }
        : input.deliveryFocus ? { deliveryFocus: input.deliveryFocus } : {}),
    });
  }
  if (input.action === "boss-search") {
    await boss.search(input.query);
    return bossView(workspace);
  }
  if (input.action === "boss-find") {
    const result = await boss.findForResume(input.resumeId, input.query, input.backend);
    return bossView(
      workspace,
      result.needsDirection ? { directionNeededFor: input.resumeId } : undefined,
    );
  }
  if (input.action === "boss-auto-prepare") {
    return bossView(workspace, await new BossAutoPrepare(workspace).run(input));
  }
  if (input.action === "boss-read") {
    await boss.read(input.resumeId);
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
