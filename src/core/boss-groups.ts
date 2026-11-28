import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Workspace } from "./workspace.js";
import { BossDeliveries, type BossDelivery } from "./boss-deliveries.js";
import { BossArchives } from "./boss-archives.js";
import { bossBatchLimit } from "../domain/boss.js";

export type BossGroup = {
  id: string;
  digest: string;
  createdAt: number;
  updatedAt: number;
  status: "prepared" | "running" | "paused" | "finished";
  expiresAt: number;
  ownerPid?: number;
  ownerInstance?: string;
  leaseExpiresAt?: number;
  stopRequested?: boolean;
  items: {
    deliveryId: string;
    digest: string;
    state: "queued" | "running" | "finished" | "needs_review";
  }[];
  error?: string;
};
type Edit = { groupId?: string; draft?: BossDelivery; standaloneId?: string; adding?: boolean };
type Control = { stop: boolean; done?: Promise<void> };
const PROCESS_INSTANCE_ID = randomUUID();
const GROUP_LEASE_MS = 60_000;
const workers = new Map<string, Control>();
const key = (w: Workspace, id: string) => `${w.store.home}:${id}`;
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
export class BossGroups {
  constructor(
    readonly workspace: Workspace,
    readonly pollMs = 1000,
    readonly maxPolls = 120,
  ) {}
  private save(g: BossGroup) {
    const previous = this.workspace.store
      .list<BossGroup>("boss-group")
      .find((v) => v.id === g.id);
    if (previous?.stopRequested) g.stopRequested = true;
    g.updatedAt = Math.max(Date.now(), g.updatedAt + 1);
    this.workspace.store.put("boss-group", g);
    return g;
  }
  list() {
    return this.workspace.store.list<BossGroup>("boss-group").map((g) => {
      let alive = false;
      const leaseValid =
        g.leaseExpiresAt === undefined || g.leaseExpiresAt > Date.now();
      if (
        leaseValid &&
        g.ownerPid &&
        g.ownerPid !== process.pid &&
        g.ownerInstance !== PROCESS_INSTANCE_ID
      ) {
        try {
          process.kill(g.ownerPid, 0);
          alive = true;
        } catch {}
      }
      if (
        g.status === "running" &&
        !workers.has(key(this.workspace, g.id)) &&
        !alive
      ) {
        g.status = "paused";
        g.error = "宿主曾退出，已停止后续任务；读取当前回执，不自动恢复发送。";
        this.save(g);
      }
      return g;
    });
  }
  get(id: string) {
    this.list();
    return this.workspace.store.get<BossGroup>("boss-group", id);
  }
  prepare(ids: string[]) {
    return this.prepareGroup(ids);
  }
  private requireEditable(id: string) {
    new BossArchives(this.workspace).requireCurrent(id);
    const group = this.get(id);
    const deliveries = new BossDeliveries(this.workspace);
    if (group.status !== "prepared" || group.expiresAt === 0 || group.items.some((item) => {
      const delivery = deliveries.get(item.deliveryId);
      return delivery.status !== "prepared" || delivery.withdrawnAt;
    }))
      throw new Error("原批次已经变化，请先查看当前状态。");
    return group;
  }
  private requireStandalone(id: string) {
    new BossArchives(this.workspace).requireCurrentDelivery(id);
    const delivery = new BossDeliveries(this.workspace).get(id);
    if (delivery.status !== "prepared" || delivery.withdrawnAt || this.inGroup(id))
      throw new Error("这条任务已变更，请从当前待投清单打开。");
    return delivery;
  }
  private inGroup(id: string) {
    return this.workspace.store.list<BossGroup>("boss-group").some((group) =>
      group.expiresAt !== 0 && group.items.some((item) => item.deliveryId === id));
  }
  private withdrawUnused(ids: string[]) {
    const deliveries = new BossDeliveries(this.workspace);
    for (const id of ids) {
      const delivery = deliveries.get(id);
      if (delivery.status === "prepared" && !this.inGroup(id))
        this.workspace.store.put("boss-delivery", { ...delivery, withdrawnAt: Date.now() });
    }
  }
  private async prepareGroup(ids: string[], edit: Edit = {}) {
    z.array(z.uuid())
      .min(1)
      .max(bossBatchLimit)
      .refine((a) => new Set(a).size === a.length)
      .parse(ids);
    const deliveries = new BossDeliveries(this.workspace);
    const items: BossGroup["items"] = [];
    const archives = new BossArchives(this.workspace);
    const getDelivery = (id: string) => edit.draft?.id === id ? edit.draft : deliveries.get(id);
    const urls = new Set<string>();
    for (const id of ids) {
      archives.requireCurrentDelivery(id);
      const d = getDelivery(id);
      if (d.status !== "prepared" || d.withdrawnAt)
        throw new Error("只选择尚未执行的岗位；已执行或待核对记录不能重发。");
      if (urls.has(d.url))
        throw new Error("同一岗位不能选择多个版本重复联系。");
      urls.add(d.url);
      await deliveries.validate(d);
      items.push({
        deliveryId: id,
        digest: d.digest,
        state: "queued",
      });
    }
    return this.workspace.store.transaction(() => {
      const replaced = edit.groupId ? this.requireEditable(edit.groupId) : undefined;
      const standalone = edit.standaloneId ? this.requireStandalone(edit.standaloneId) : undefined;
      const draft = edit.draft;
      if (draft && deliveries.list().some((d) => d.url === draft.url &&
        (d.status !== "prepared" || (edit.adding && !d.withdrawnAt))))
        throw new Error("这个岗位已有待投或执行记录，请先查看现有任务。");
      for (const item of items) {
        archives.requireCurrentDelivery(item.deliveryId);
        const delivery = getDelivery(item.deliveryId);
        if (delivery.status !== "prepared" || delivery.withdrawnAt || delivery.digest !== item.digest)
          throw new Error("岗位任务已经变化，请重新查看。");
      }
      const archived = archives.ids();
      const digest = hash(items.map((i) => [i.deliveryId, i.digest]));
      const existing = replaced || draft ? undefined : this.list().find(
        (g) =>
          g.digest === digest &&
          !archived.has(g.id) &&
          g.status === "prepared" &&
          g.expiresAt > Date.now(),
      );
      if (draft) this.workspace.store.put("boss-delivery", draft);
      const now = Date.now();
      const group = existing ?? this.save({
        id: randomUUID(),
        digest,
        createdAt: now,
        updatedAt: now,
        status: "prepared",
        expiresAt: now + 15 * 60 * 1000,
        items,
      });
      if (replaced) this.save({ ...replaced, expiresAt: 0 });
      this.withdrawUnused([
        ...(replaced?.items.filter((item) => !ids.includes(item.deliveryId)).map((item) => item.deliveryId) ?? []),
        ...(standalone ? [standalone.id] : []),
      ]);
      return group;
    });
  }
  async add(resumeId: string, jobId: string, groupId?: string) {
    const group = groupId ? this.requireEditable(groupId) : undefined;
    if (group && group.items.length >= bossBatchLimit)
      throw new Error(`每批最多 ${bossBatchLimit} 个岗位，请先处理当前批次。`);
    const ids = group?.items.map((item) => item.deliveryId) ?? [];
    return new BossDeliveries(this.workspace).withDraft(resumeId, jobId, (draft) =>
      this.prepareGroup([...ids, draft.id], { groupId, draft, adding: true }));
  }
  async replaceResume(deliveryId: string, resumeId: string, groupId?: string) {
    const group = groupId ? this.requireEditable(groupId) : undefined;
    if (group && !group.items.some((item) => item.deliveryId === deliveryId))
      throw new Error("这个岗位不在当前批次。");
    const deliveries = new BossDeliveries(this.workspace);
    const delivery = group ? deliveries.get(deliveryId) : this.requireStandalone(deliveryId);
    if (delivery.status !== "prepared" || delivery.withdrawnAt || delivery.resumeId === resumeId)
      throw new Error("请为待确认岗位选择另一份简历。");
    return deliveries.withDraft(resumeId, delivery.jobId, (draft) => this.prepareGroup(
      group?.items.map((item) => item.deliveryId === deliveryId ? draft.id : item.deliveryId) ?? [draft.id],
      { groupId, draft, standaloneId: group ? undefined : deliveryId },
    ));
  }
  async move(id: string, deliveryId: string, step: -1 | 1) {
    const ids = this.requireEditable(id).items.map((item) => item.deliveryId);
    const index = ids.indexOf(deliveryId);
    if (index < 0 || index + step < 0 || index + step >= ids.length)
      throw new Error("这个岗位不能继续调整顺序。");
    [ids[index], ids[index + step]] = [ids[index + step], ids[index]];
    return this.prepareGroup(ids, { groupId: id });
  }
  removeStandalone(id: string) {
    this.workspace.store.transaction(() => {
      this.requireStandalone(id);
      this.withdrawUnused([id]);
    });
  }
  async removeItem(id: string, deliveryId: string) {
    const archives = new BossArchives(this.workspace);
    archives.requireCurrent(id);
    const group = this.get(id);
    if (
      group.status !== "prepared" ||
      group.expiresAt === 0 ||
      !group.items.some((item) => item.deliveryId === deliveryId)
    )
      throw new Error("当前批次不能移出这个岗位。");
    if (group.items.length === 1) {
      this.workspace.store.transaction(() => {
        const current = this.requireEditable(id);
        const delivery = new BossDeliveries(this.workspace).get(deliveryId);
        if (delivery.status !== "prepared") throw new Error("岗位任务已经变化，请重新查看。");
        this.save({ ...current, expiresAt: 0 });
        this.withdrawUnused([deliveryId]);
      });
      return;
    }
    return this.prepareGroup(
      group.items.filter((item) => item.deliveryId !== deliveryId)
        .map((item) => item.deliveryId),
      { groupId: id },
    );
  }
  /** Human confirmation covers these exact frozen items, never future search results. */
  async start(id: string, digest: string) {
    const archives = new BossArchives(this.workspace);
    const requireCurrent = () => {
      archives.requireCurrent(id);
      const group = this.get(id);
      if (
        group.status !== "prepared" ||
        group.digest !== digest ||
        group.expiresAt <= Date.now()
      )
        throw new Error("整批核对已过期或已经执行，请重新核对未执行岗位。");
      return group;
    };
    const review = requireCurrent();
    const deliveries = new BossDeliveries(this.workspace);
    for (const i of review.items) {
      archives.requireCurrentDelivery(i.deliveryId);
      const d = deliveries.get(i.deliveryId);
      if (d.status !== "prepared" || d.withdrawnAt || d.digest !== i.digest)
        throw new Error("其中的岗位已执行或附件已变化。");
      await deliveries.validate(d);
    }
    const g = this.workspace.store.transaction(() => {
      const current = requireCurrent();
      if (this.list().some((o) => o.status === "running"))
        throw new Error("已有批次执行中，或本批已确认。");
      for (const item of current.items) {
        archives.requireCurrentDelivery(item.deliveryId);
        const d = deliveries.get(item.deliveryId);
        if (d.status !== "prepared" || d.withdrawnAt || d.digest !== item.digest)
          throw new Error("其中的岗位已执行或附件已变化。");
      }
      current.status = "running";
      current.ownerPid = process.pid;
      current.ownerInstance = PROCESS_INSTANCE_ID;
      current.leaseExpiresAt = Date.now() + GROUP_LEASE_MS;
      return this.save(current);
    });
    const control: Control = { stop: false };
    workers.set(key(this.workspace, id), control);
    control.done = this.execute(g, control).finally(() =>
      workers.delete(key(this.workspace, id)),
    );
    void control.done.catch(() => {});
    return g;
  }
  private async execute(g: BossGroup, c: Control) {
    const deliveries = new BossDeliveries(this.workspace);
    try {
      for (const item of g.items) {
        if (
          c.stop ||
          this.get(g.id).stopRequested ||
          g.expiresAt <= Date.now()
        ) {
          g.status = "paused";
          g.error = c.stop
            ? "已暂停，未执行的岗位保持待确认。"
            : "本次授权时间已结束，请重新核对未执行岗位。";
          this.save(g);
          return;
        }
        let d = deliveries.get(item.deliveryId);
        if (d.status !== "prepared" || d.digest !== item.digest)
          throw new Error("下一岗位已执行或版本改变，已停止。");
        item.state = "running";
        g.leaseExpiresAt = Date.now() + GROUP_LEASE_MS;
        this.save(g);
        // Refresh only the executor's expiring ticket, never the approved PDF or JD.
        await deliveries.preview(d);
        if (c.stop || this.get(g.id).stopRequested) {
          item.state = "queued";
          g.status = "paused";
          this.save(g);
          return;
        }
        d = await deliveries.confirm(d.id, item.digest);
        for (
          let n = 0;
          d.status === "running" || d.status === "submitting";
          n++
        ) {
          if (n >= this.maxPolls) {
            await deliveries.pause(d.id);
            throw new Error("等待回执已达上限，已请求暂停，请人工核对。");
          }
          if (c.stop || this.get(g.id).stopRequested)
            await deliveries.pause(d.id);
          await new Promise((r) => setTimeout(r, this.pollMs));
          d = await deliveries.refresh(d.id);
        }
        if (d.status !== "finished") {
          item.state = "needs_review";
          g.status = "paused";
          g.error = "当前岗位需要核对，未执行后续岗位。";
          this.save(g);
          return;
        }
        item.state = "finished";
        this.save(g);
      }
      g.status = "finished";
      delete g.error;
      this.save(g);
    } catch (error) {
      const active = g.items.find((i) => i.state === "running");
      if (active) active.state = "needs_review";
      g.status = "paused";
      g.error = error instanceof Error ? error.message : "批次已暂停，请核对。";
      this.save(g);
    }
  }
  async pause(id: string) {
    const g = this.get(id),
      c = workers.get(key(this.workspace, id));
    if (g.status === "running") {
      g.stopRequested = true;
      this.save(g);
    }
    if (c) {
      c.stop = true;
      const active = g.items.find((i) => i.state === "running");
      if (active) {
        const d = new BossDeliveries(this.workspace).get(active.deliveryId);
        if (d.status === "running" || d.status === "submitting")
          await new BossDeliveries(this.workspace).pause(d.id);
      }
    }
    return this.get(id);
  }
  async wait(id: string) {
    await workers.get(key(this.workspace, id))?.done;
    return this.get(id);
  }
  async remaining(id: string) {
    new BossArchives(this.workspace).requireCurrent(id);
    const g = this.get(id);
    if (g.status === "running") throw new Error("请先暂停当前批次。");
    return this.prepare(
      g.items
        .filter(
          (i) =>
            i.state === "queued" &&
            new BossDeliveries(this.workspace).get(i.deliveryId).status ===
              "prepared",
        )
        .map((i) => i.deliveryId),
    );
  }
}
