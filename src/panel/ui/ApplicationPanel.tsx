import { useState } from "react";
import type { Application, Job, Resume } from "../../service.js";
export const statusLabel: Record<string, string> = {
  prepared: "待核对",
  simulated: "仅检查，未发送",
  sending: "发送中／需核对",
  sent: "已提交邮箱",
  uncertain: "结果待核对",
};
export function ApplicationPanel({
  job,
  resume,
  application,
  enabled,
  busy,
  onPrepare,
  onCheck,
  onSend,
}: {
  job?: Job;
  resume?: Resume;
  application?: Application;
  enabled: boolean;
  busy: boolean;
  onPrepare: (input: {
    recipient: string;
    subject: string;
    body: string;
  }) => Promise<void>;
  onCheck: () => void;
  onSend: () => void;
}) {
  const [checked, setChecked] = useState(false),
    [confirmation, setConfirmation] = useState("");
  const editable =
    application && ["prepared", "simulated"].includes(application.status);
  return (
    <section>
      <div className="section-heading">
        <h2>投递核对</h2>
        {application && (
          <span className="badge">{statusLabel[application.status]}</span>
        )}
      </div>
      {!resume?.pdf || !job ? (
        <p className="muted">生成该岗位的 PDF 后，准备邮件。</p>
      ) : !application ? (
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            await onPrepare({
              recipient: String(d.get("recipient")),
              subject: String(d.get("subject")),
              body: String(d.get("body")),
            });
          }}
        >
          <label>
            收件邮箱
            <input
              name="recipient"
              type="email"
              required
              defaultValue={job.recipient ?? ""}
            />
          </label>
          <label>
            主题
            <input name="subject" required defaultValue={`应聘${job.role}`} />
          </label>
          <label>
            正文
            <textarea
              name="body"
              required
              rows={7}
              defaultValue={`您好：\n\n我想应聘${job.company || "贵公司"}的${job.role}岗位，附件是我的简历。\n\n感谢查看。`}
            />
          </label>
          <button className="primary" disabled={busy}>
            生成投递预览
          </button>
        </form>
      ) : (
        <>
          <dl>
            <dt>收件人</dt>
            <dd>{application.recipient}</dd>
            <dt>主题</dt>
            <dd>{application.subject}</dd>
            <dt>附件</dt>
            <dd>{resume.name} · PDF</dd>
          </dl>
          <p className="pre mail-body">{application.body}</p>
          {application.receipt && (
            <aside>
              <h3>邮箱服务回执</h3>
              <p className="pre">{application.receipt.response}</p>
              <p className="muted">
                {new Date(application.receipt.acceptedAt).toLocaleString()} ·
                不代表对方已读
              </p>
            </aside>
          )}
          {editable && (
            <>
              <button disabled={busy} onClick={onCheck}>
                仅检查附件，不发信
              </button>
              {!enabled && (
                <p className="warning">未配置真实发件账号，发送不可用。</p>
              )}
              <label className="check">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => setChecked(e.target.checked)}
                />
                我已核对收件人、正文和 PDF 附件
              </label>
              <label>
                输入“发送”确认本封邮件
                <input
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <button
                className="primary"
                disabled={
                  busy || !enabled || !checked || confirmation !== "发送"
                }
                onClick={onSend}
              >
                确认并真实发送
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}
