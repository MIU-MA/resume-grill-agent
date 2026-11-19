import { useRef, useState, useSyncExternalStore } from "react";
import { moduleSettingsName } from "./branding.js";
import {
  capabilities,
  capabilityLabels,
  type Capability,
} from "../../shared/capabilities.js";

declare const __NATIVE_CSS__: string;

type Snapshot = {
  status: string;
  writable: boolean;
  revision?: number;
  value?: { disabledCapabilities?: Capability[] };
};

type SettingsScope = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => Snapshot;
  mutate: (
    changes: { op: "set"; path: string[]; value: Capability[] }[],
    revision?: number,
  ) => Promise<boolean>;
};

export function CapabilitySettings({ scope }: { scope: SettingsScope }) {
  const snapshot = useSyncExternalStore(
    scope.subscribe.bind(scope),
    scope.getSnapshot.bind(scope),
  );
  const [draft, setDraft] = useState<{
    disabled: Capability[];
    revision?: number;
  }>();
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const saved = snapshot.value?.disabledCapabilities;
  const disabled = draft?.disabled ?? saved ?? [];
  const available = snapshot.status === "ready" && Array.isArray(saved);

  return (
    <section className="rg-native rg-settings" aria-label={moduleSettingsName}>
      <style>{__NATIVE_CSS__}</style>
      <h3>{moduleSettingsName}</h3>
      <p className="rg-note">
        简历库、岗位读取和 JD 核对始终可用。模块设置在重启 DSH Profile 后生效。
      </p>
      {snapshot.status === "loading" && <p role="status">正在读取模块设置…</p>}
      {snapshot.status !== "loading" && !available && (
        <p>当前宿主未提供模块设置。请重启 DSH，或通过 Profile 配置修改。</p>
      )}
      {available && (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (!draft || submitting.current || !snapshot.writable) return;
            submitting.current = true;
            setSaving(true);
            setError("");
            setNotice("");
            try {
              const result = await scope.mutate(
                [
                  {
                    op: "set",
                    path: ["disabledCapabilities"],
                    value: draft.disabled,
                  },
                ],
                draft.revision,
              );
              if (!result) {
                setDraft(undefined);
                throw new Error("模块设置未保存。请核对当前设置后重试。");
              }
              setNotice("已保存。下次启动时应用。");
              setDraft(undefined);
            } catch (failure) {
              setError(
                failure instanceof Error
                  ? failure.message
                  : "模块设置保存失败。",
              );
            } finally {
              submitting.current = false;
              setSaving(false);
            }
          }}
        >
          {capabilities.map((id) => (
            <label key={id} className="rg-check">
              <input
                type="checkbox"
                checked={!disabled.includes(id)}
                disabled={saving || !snapshot.writable}
                onChange={(event) => {
                  setError("");
                  setNotice("");
                  const next = event.target.checked
                    ? disabled.filter((item) => item !== id)
                    : [...disabled, id];
                  setDraft({
                    disabled: next,
                    revision: draft ? draft.revision : snapshot.revision,
                  });
                }}
              />
              {capabilityLabels[id]}
            </label>
          ))}
          <button disabled={!draft || saving || !snapshot.writable}>
            保存模块设置
          </button>
          {draft && (
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setDraft(undefined);
                setError("");
              }}
            >
              取消修改
            </button>
          )}
        </form>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className="rg-error">
          {error}
        </p>
      )}
    </section>
  );
}
