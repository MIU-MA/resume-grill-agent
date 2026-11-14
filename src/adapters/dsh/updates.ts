type WorkspaceUpdate = { error?: string };
const listeners = new Map<string, Set<(event: WorkspaceUpdate) => void>>();
export function notifyWorkspaceChanged(sessionId: string, event: WorkspaceUpdate = {}) {
  for (const listener of listeners.get(sessionId) ?? []) listener(event);
}
export function onWorkspaceChanged(sessionId: string, listener: (event: WorkspaceUpdate) => void) {
  const group = listeners.get(sessionId) ?? new Set();
  group.add(listener);
  listeners.set(sessionId, group);
  return () => {
    group.delete(listener);
    if (!group.size) listeners.delete(sessionId);
  };
}
