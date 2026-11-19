import type { NativeView } from "./views.js";
type BossView = Extract<NativeView, { kind: "boss" }>;

export function groupedBossDeliveryIds(
  view: Pick<Extract<NativeView, { kind: "boss" }>, "groups">,
) {
  return new Set(
    view.groups
      .filter((group) => group.expiresAt !== 0)
      .flatMap((group) => group.items.map((item) => item.deliveryId)),
  );
}

export function bossQueueStatus(view: BossView, url: string) {
  const tasks = view.deliveries.filter((delivery) => delivery.url === url && !delivery.withdrawnAt);
  if (tasks.some((task) => task.status === "finished")) return "已投递";
  if (tasks.some((task) => task.status === "running" || task.status === "submitting")) return "执行中";
  if (tasks.some((task) => task.status === "paused" || task.status === "uncertain")) return "待核对";
  if (!tasks.length) return undefined;
  const archived = new Set(view.archivedTaskIds ?? []);
  const active = tasks.some((task) => {
    const groups = view.groups.filter((group) => group.expiresAt !== 0 &&
      group.items.some((item) => item.deliveryId === task.id));
    return !archived.has(task.id) && (!groups.length || groups.some((group) => !archived.has(group.id)));
  });
  return active ? "已加入" : "已归档";
}
