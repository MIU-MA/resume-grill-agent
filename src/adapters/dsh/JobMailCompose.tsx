import { useState } from "react";
import type { NativeView } from "./views.js";

export function JobMailCompose({ view, accepted, busy, run }: {
  view: Extract<NativeView, { kind: "review" }>;
  accepted: string[];
  busy: boolean;
  run: (action: unknown) => Promise<boolean>;
}) {
  const [recipient, setRecipient] = useState(view.job.recipient ?? "");
  const proposal = accepted.length > 0 ? view.proposal : undefined;
  return (
    <form className="rg-mail-compose" aria-label="岗位邮箱投递" onSubmit={(event) => {
      event.preventDefault();
      if (busy || !recipient.trim()) return;
      void run({
        action: "prepare",
        resumeId: view.resumeId,
        jobId: view.jobId,
        ...(view.goalId ? { goalId: view.goalId } : {}),
        ...(recipient.trim() === view.job.recipient ? {} : { recipient: recipient.trim() }),
        ...(proposal
          ? { proposalId: proposal.id, accepted }
          : { keepOriginal: true, accepted: [] }),
      });
    }}>
      <label>收件邮箱
        <input type="email" required value={recipient} disabled={busy}
          onChange={(event) => setRecipient(event.target.value)} />
      </label>
      <button type="submit" disabled={busy || !recipient.trim()}>
        {proposal ? "用所选修改准备邮件" : "用当前简历正文准备邮件"}
      </button>
    </form>
  );
}
