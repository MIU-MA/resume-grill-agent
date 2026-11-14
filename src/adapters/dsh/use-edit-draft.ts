import { useEffect, useState } from "react";
/** Retain unsaved edits when opening the native file preview or switching jobs. */
export function useEditDraft(key: string, initial: string) {
  const storageKey = `resume-grill-edit:${key}`;
  const [value, setValue] = useState(() => {
    try {
      return sessionStorage.getItem(storageKey) ?? initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      if (value === initial) sessionStorage.removeItem(storageKey);
      else sessionStorage.setItem(storageKey, value);
    } catch {
      /* The editor remains usable when storage is unavailable. */
    }
  }, [value, initial, storageKey]);
  const clear = () => {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {}
  };
  return [value, setValue, clear] as const;
}
