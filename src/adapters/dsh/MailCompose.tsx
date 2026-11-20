import type { NativeView } from "./views.js";
import { useWorkbenchPreference } from "./workbench-state.js";

type Resumes = Extract<NativeView, { kind: "workspace" }>["resumes"];

export function MailCompose({ resumes, recipient, setRecipient, busy, prepare, openResumes }: {
  resumes: Resumes;
  recipient: string;
  setRecipient: (address: string) => void;
  busy: boolean;
  prepare: (resumeId: string, recipient: string) => Promise<boolean>;
  openResumes: () => void;
}) {
  const [selected, select] = useWorkbenchPreference<string>("mail-resume", "");
  const resumeId = resumes.find((resume) => resume.id === selected)?.id ?? resumes[0]?.id;

  if (!resumeId) return (
    <section aria-label="新建投递邮件">
      <p>先在简历库添加一份简历。</p>
      <button disabled={busy} onClick={openResumes}>去简历库</button>
    </section>
  );

  return (
    <form className="rg-mail-compose" aria-label="新建投递邮件" onSubmit={async (event) => {
      event.preventDefault();
      if (!busy && await prepare(resumeId, recipient.trim())) setRecipient("");
    }}>
      <label>
        投递简历
        <select disabled={busy} value={resumeId} onChange={(event) => select(event.target.value)}>
          {resumes.map((resume) => <option key={resume.id} value={resume.id}>{resume.name}</option>)}
        </select>
      </label>
      <label>
        收件邮箱
        <input type="email" required value={recipient} disabled={busy}
          onChange={(event) => setRecipient(event.target.value)} />
      </label>
      <button type="submit" className="rg-primary" disabled={busy || !recipient.trim()}>预览投递邮件</button>
    </form>
  );
}
