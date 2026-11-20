import { createContext, useContext, useState } from "react";
import type { viewReference } from "./card-model.js";

type Preference = string | boolean;
type Reference = ReturnType<typeof viewReference>;
export const WorkbenchSession = createContext<string | undefined>(undefined);

function storageKey(sessionId: string, key: string) {
  return `resume-grill-workbench:${encodeURIComponent(sessionId)}:${key}`;
}

function read(sessionId: string | undefined, key: string): unknown {
  if (!sessionId) return undefined;
  try {
    return JSON.parse(sessionStorage.getItem(storageKey(sessionId, key)) ?? "null");
  } catch {
    return undefined;
  }
}

function write(sessionId: string | undefined, key: string, value: unknown) {
  if (!sessionId) return;
  try {
    const storage = storageKey(sessionId, key);
    if (value == null) sessionStorage.removeItem(storage);
    else sessionStorage.setItem(storage, JSON.stringify(value));
  } catch {
    // Session storage can be unavailable in the host.
  }
}

export function useWorkbenchPreference<T extends Preference>(key: string, initial: T) {
  const sessionId = useContext(WorkbenchSession);
  const [value, setValue] = useState(() => {
    const saved = read(sessionId, key);
    return typeof saved === typeof initial ? saved as T : initial;
  });
  return [value, (next: T) => {
    setValue(next);
    write(sessionId, key, next);
  }] as const;
}

export function rememberPage(sessionId: string, tab: string, reference?: Reference) {
  write(sessionId, `detail:${tab}`, reference);
}

export function rememberedPage(sessionId: string, tab: string) {
  // The host validates the reference against its read-only restore actions.
  return read(sessionId, `detail:${tab}`);
}
