import { useState } from "react";
import type { NativeView } from "./views.js";

type View = Extract<NativeView, { kind: "boss" }>;
export function BossResumeSwitch({ view, delivery, busy, run, groupId }: {
  view: View;
  delivery: View["deliveries"][number];
  busy: boolean;
  run: (input: unknown) => Promise<unknown>;
  groupId?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [resumeId, setResumeId] = useState("");
  const choices = view.resumes.filter((resume) => resume.hasPdf && resume.id !== delivery.resumeId &&
    (!resume.jobId || resume.jobId === delivery.jobId));
  if (!choices.length) return null;
  if (!editing) return <button disabled={busy} onClick={() => setEditing(true)}>换简历</button>;
  return (
    <form className="rg-boss-resume-switch" onSubmit={(event) => {
      event.preventDefault();
      if (!busy && resumeId) void run({ action: "boss-queue-resume", deliveryId: delivery.id, resumeId,
        ...(groupId ? { groupId } : {}),
      });
    }}>
      <label>
        为「{delivery.role}」选择简历
        <select aria-label={`为「${delivery.role}」选择简历`} disabled={busy} value={resumeId} onChange={(e) => setResumeId(e.target.value)}>
          <option value="">选择 PDF 简历</option>
          {choices.map((resume) => <option key={resume.id} value={resume.id}>{resume.name}</option>)}
        </select>
      </label>
      <button className="rg-primary" type="submit" disabled={busy || !resumeId}>保存并重新核对</button>
      <button type="button" disabled={busy} onClick={() => setEditing(false)}>取消</button>
    </form>
  );
}
