import type { NativeView } from "./views.js";
export function viewReference(view: NativeView) {
  return view.kind === "application"
    ? { action: "application", id: view.application.id }
    : view.kind === "review"
      ? {
          action: "review",
          resumeId: view.resumeId,
          jobId: view.jobId,
          ...(view.goalId ? { goalId: view.goalId } : {}),
        }
      : view.kind === "goal"
        ? { action: "goal", goalId: view.goal.id }
        : view.kind === "batch"
          ? { action: "batch-view", id: view.batch.id }
          : { action: "workspace" };
}
/** Read only the current turn's indexed tool results, keeping selector references stable. */
export function turnCardSelector(turn: number) {
  let previous: any[] = [];
  return (snapshot: any) => {
    const cards = new Map<string, any>();
    for (const key of snapshot.locations.getTurn(turn)) {
      const node = snapshot.nodes.get(key);
      if (node?.kind !== "tool-call") continue;
      const root = node.data?.root,
        view = root?.meta?.resumeGrill;
      if (root?.isError || view?.v !== 1) continue;
      const identity =
        view.kind === "review"
          ? `review:${view.resumeId}:${view.jobId}`
          : view.kind === "application"
            ? `application:${view.application.id}`
            : view.kind === "goal"
              ? `goal:${view.goal.id}`
              : view.kind === "batch"
                ? `batch:${view.batch.id}`
                : "workspace";
      cards.set(identity, root);
    }
    const next = [...cards.values()];
    if (
      next.length === previous.length &&
      next.every((node, index) => node === previous[index])
    )
      return previous;
    return (previous = next);
  };
}
