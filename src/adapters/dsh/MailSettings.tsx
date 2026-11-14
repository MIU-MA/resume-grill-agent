import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  defaultMailSettings,
  mailCredentialRef,
  type MailSettings as Settings,
} from "../../shared/mail-settings.js";
import { selectedSessionId } from "./controls.js";

declare const __NATIVE_CSS__: string;
export function MailSettings({
  scope,
  credentials,
  useSessions,
  testMail,
}: any) {
  const snapshot: any = useSyncExternalStore(
    scope.subscribe.bind(scope),
    scope.getSnapshot.bind(scope),
  );
  const sessionId = useSessions(selectedSessionId);
  const [draft, setDraft] = useState<Settings>(defaultMailSettings),
    [revision, setRevision] = useState<number>(),
    [code, setCode] = useState(""),
    [configured, setConfigured] = useState(false),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const lock = useRef(false),
    id = useId();
  useEffect(() => {
    if (!dirty && snapshot.value) {
      setDraft(snapshot.value);
      setRevision(snapshot.revision);
    }
  }, [snapshot, dirty]);
  const ref = mailCredentialRef(draft.address, draft.provider);
  useEffect(() => {
    let live = true;
    setConfigured(false);
    void credentials
      .describe([ref])
      .then((result: any) => {
        if (!result.ok) throw new Error(result.error.message);
        if (live) setConfigured(!!result.value[ref]?.configured);
      })
      .catch(() => {
        if (live) setError("无法读取授权码状态，请检查 DSH 连接。");
      });
    return () => {
      live = false;
    };
  }, [ref, credentials]);
  const run = async (operation: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await operation();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败。");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const change = (value: Partial<Settings>) => {
    setDraft({ ...draft, ...value });
    setDirty(true);
    setMessage("");
  };
  return (
    <section className="rg-native rg-settings" aria-label="求职邮箱设置">
      <style>{__NATIVE_CSS__}</style>
      <h3>发件邮箱</h3>
      <p className="rg-note">
        授权码由 DSH 凭据服务保存。保存后立即生效，不需要重启。
      </p>
      {snapshot.status !== "ready" && <p role="status">正在连接设置服务…</p>}
      <form
        className="rg-mail-editor"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            if (code.trim()) {
              const result = await credentials.set(ref, code.trim());
              if (!result.ok) throw new Error(result.error.message);
            }
            const info = await credentials.describe([ref]);
            if (!info.ok) throw new Error(info.error.message);
            if (draft.enabled && !info.value[ref]?.configured)
              throw new Error("请先填写 SMTP 授权码。");
            const saved = await scope.mutate(
              Object.entries(draft).map(([key, value]) => ({
                op: "set",
                path: [key],
                value,
              })),
              revision,
            );
            if (saved === false)
              throw new Error(
                "设置未保存，可能已在其他窗口更改。请重新打开设置核对。",
              );
            setConfigured(!!info.value[ref]?.configured);
            setCode("");
            setDirty(false);
            setMessage("已保存。新设置立即生效。");
          });
        }}
      >
        <label htmlFor={`${id}-provider`}>邮箱类型</label>
        <select
          id={`${id}-provider`}
          value={draft.provider}
          disabled={busy}
          onChange={(e) =>
            change({ provider: e.target.value as Settings["provider"] })
          }
        >
          <option value="qq">QQ 邮箱</option>
          <option value="163">163 邮箱</option>
          <option value="126">126 邮箱</option>
        </select>
        <label htmlFor={`${id}-address`}>发件邮箱</label>
        <input
          id={`${id}-address`}
          type="email"
          required
          value={draft.address}
          disabled={busy}
          onChange={(e) => change({ address: e.target.value.trim() })}
        />
        <label htmlFor={`${id}-code`}>SMTP 授权码</label>
        <input
          id={`${id}-code`}
          type="password"
          autoComplete="new-password"
          value={code}
          disabled={busy}
          placeholder={
            configured
              ? "已保存；留空保留，填写则替换"
              : "填写邮箱的 SMTP 授权码"
          }
          onChange={(e) => {
            setCode(e.target.value);
            setDirty(true);
          }}
        />
        <p className="rg-note">
          {configured ? "此邮箱的授权码已保存。" : "此邮箱还没有保存授权码。"}{" "}
          邮箱登录密码不能代替授权码。
        </p>
        <label className="rg-check">
          <input
            type="checkbox"
            checked={draft.enabled}
            disabled={busy}
            onChange={(e) => change({ enabled: e.target.checked })}
          />
          允许在核对邮件后真实发送
        </label>
        <button
          type="submit"
          disabled={busy || !snapshot.writable || snapshot.status !== "ready"}
        >
          保存邮箱设置
        </button>
        <button
          type="button"
          disabled={busy || dirty || !configured || !sessionId}
          onClick={() =>
            void run(async () => {
              const result = await testMail(sessionId);
              setMessage(result.message);
            })
          }
        >
          测试连接，不发信
        </button>
        <button
          type="button"
          disabled={busy || dirty || !configured}
          onClick={() =>
            void run(async () => {
              const result = await credentials.unset(ref);
              if (!result.ok) throw new Error(result.error.message);
              setConfigured(false);
              setMessage("授权码已移除，发送已停用。");
            })
          }
        >
          移除授权码
        </button>
        {!sessionId && (
          <p className="rg-note">
            打开一个会话后可测试邮箱连接；保存设置不受影响。
          </p>
        )}
      </form>
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="rg-error">
          {error}
        </p>
      )}
    </section>
  );
}
