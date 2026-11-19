import type { BossRun } from "../domain/boss.js";
import type { BossDelivery } from "./boss-deliveries.js";
import type { BossGroup } from "./boss-groups.js";
import type { Workspace } from "./workspace.js";

export const bossTaskKinds = ["delivery", "group", "run"] as const;
export type BossTaskKind = typeof bossTaskKinds[number];
type Archive = { id: string; taskId: string; archived: boolean };

export class BossArchives {
  constructor(private workspace: Workspace) {}

  ids() {
    return new Set(this.workspace.store.list<Archive>("boss-archive")
      .filter((entry) => entry.archived).map((entry) => entry.taskId));
  }

  requireCurrent(id: string) {
    if (this.ids().has(id)) throw new Error("任务已归档，请先恢复再继续。");
  }

  requireCurrentDelivery(id: string) {
    const archived = this.ids();
    if (archived.has(id)) throw new Error("任务已归档，请先恢复再继续。");
    if (!archived.size) return;
    const groups = this.workspace.store.list<BossGroup>("boss-group")
      .filter((group) => group.expiresAt !== 0 && group.items.some((item) => item.deliveryId === id));
    if (groups.length && groups.every((group) => archived.has(group.id)))
      throw new Error("岗位所在批次已归档，请先恢复再继续。");
  }

  set(kind: BossTaskKind, id: string, archived: boolean) {
    const { store } = this.workspace;
    store.transaction(() => {
      const task = store.get<BossDelivery | BossGroup | BossRun>(`boss-${kind}`, id);
      if (archived) {
        const status = "status" in task ? task.status : task.state;
        const activeMember = kind === "group" && (task as BossGroup).items.some(({ deliveryId }) => {
          const delivery = store.get<BossDelivery>("boss-delivery", deliveryId);
          return delivery.status === "running" || delivery.status === "submitting";
        });
        if (status === "running" || status === "submitting" || activeMember)
          throw new Error("任务仍在执行，请等回执更新后再归档。");
      }
      store.put("boss-archive", { id: `boss-archive:${id}`, taskId: id, archived });
    });
  }
}
