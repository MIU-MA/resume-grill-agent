import type { NativeView } from "./views.js";

export function groupedBossDeliveryIds(
  view: Pick<Extract<NativeView, { kind: "boss" }>, "groups">,
) {
  return new Set(
    view.groups
      .filter((group) => group.expiresAt !== 0)
      .flatMap((group) => group.items.map((item) => item.deliveryId)),
  );
}
