import { useId, useState } from "react";
import type { NativeView } from "./views.js";
import type { ApplicationMail } from "../../domain/application-mail.js";
import { applicationStatusLabel } from "../../shared/presentation/application-status.js";

export function ApplicationReview({
  view,
  busy,
  run,
  openFile,
}: {
  view: Extract<NativeView, { kind: "application" }>;
  busy: boolean;
  run: (input: unknown) => Promise<boolean>;
  openFile: (path: string) => void;
}) {
  const { application: item, job, sendingEnabled } = view;
  const mailId = useId();
  const [draft, setDraft] = useState<ApplicationMail | null>(null),
    [ack, setAck] = useState(false),
    [confirmation, setConfirmation] = useState("");
  const editable = ["prepared", "simulated"].includes(item.status);
  return (
    <>
      <h3>核对投递 · {job.role}</h3>
      <p>{applicationStatusLabel[item.status]}</p>
      {draft ? (
        <form
          className="rg-mail-editor"
          onSubmit={async (event) => {
            event.preventDefault();
            if (
              await run({
                action: "revise",
                id: item.id,
                digest: item.digest,
                ...draft,
              })
            )
              setDraft(null);
          }}
        >
          <div>
            <label htmlFor={`${mailId}-recipient`}>收件邮箱</label>
            <input
              id={`${mailId}-recipient`}
              type="email"
              required
              value={draft.recipient}
              disabled={busy}
              onChange={(e) =>
                setDraft({ ...draft, recipient: e.target.value })
              }
            />
          </div>
          <div>
            <label htmlFor={`${mailId}-subject`}>主题</label>
            <input
              id={`${mailId}-subject`}
              required
              maxLength={200}
              value={draft.subject}
              disabled={busy}
              onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor={`${mailId}-body`}>正文</label>
            <textarea
              id={`${mailId}-body`}
              required
              rows={10}
              maxLength={20000}
              value={draft.body}
              disabled={busy}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            />
          </div>
          <p className="rg-note">
            保存后沿用当前 PDF，重新核对邮件。旧预览不能再发送。
          </p>
          <button type="submit" disabled={busy}>
            保存邮件
          </button>
          <button type="button" disabled={busy} onClick={() => setDraft(null)}>
            取消修改
          </button>
        </form>
      ) : (
        <>
          <dl>
            <dt>收件人</dt>
            <dd>{item.recipient}</dd>
            <dt>主题</dt>
            <dd>{item.subject}</dd>
          </dl>
          <p className="rg-pre rg-mail">{item.body}</p>
          {editable && (
            <button
              disabled={busy}
              onClick={() => {
                setAck(false);
                setConfirmation("");
                setDraft({
                  recipient: item.recipient,
                  subject: item.subject,
                  body: item.body,
                });
              }}
            >
              修改邮件
            </button>
          )}
        </>
      )}
      <button disabled={busy} onClick={() => openFile(item.attachment)}>
        打开实际 PDF 附件
      </button>
      <details>
        <summary>附件校验与发送回执</summary>
        <p className="rg-pre">附件 SHA-256：{item.attachmentHash}</p>
        {item.receipt && (
          <p className="rg-pre">{JSON.stringify(item.receipt, null, 2)}</p>
        )}
      </details>
      {editable && !draft && (
        <>
          <button
            disabled={busy}
            onClick={() => void run({ action: "check", id: item.id })}
          >
            检查附件，不发信
          </button>
          <label className="rg-check">
            <input
              type="checkbox"
              checked={ack}
              disabled={busy}
              onChange={(e) => setAck(e.target.checked)}
            />
            我已核对收件人、邮件正文和实际附件
          </label>
          <label>
            输入“发送”确认
            <input
              value={confirmation}
              disabled={busy || !sendingEnabled}
              onChange={(e) => setConfirmation(e.target.value)}
              autoComplete="off"
            />
          </label>
          <button
            disabled={
              busy || !sendingEnabled || !ack || confirmation !== "发送"
            }
            onClick={() =>
              void run({
                action: "send",
                id: item.id,
                digest: item.digest,
                acknowledged: true,
                confirmation,
              })
            }
          >
            确认并真实发送
          </button>
          {!sendingEnabled && (
            <p className="rg-note">
              未启用真实发送。需在插件进程配置发件邮箱及 RESUME_ALLOW_SEND=1。
            </p>
          )}
        </>
      )}
      {item.status === "superseded" && item.replacedBy && (
        <button
          disabled={busy}
          onClick={() =>
            void run({ action: "application", id: item.replacedBy })
          }
        >
          打开修改后的邮件
        </button>
      )}
      <button
        disabled={busy || !!draft}
        onClick={() => void run({ action: "application", id: item.id })}
      >
        核对最新状态
      </button>
    </>
  );
}
