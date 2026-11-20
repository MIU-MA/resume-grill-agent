import { useState, type ReactNode } from "react";
import { useWorkbenchPreference } from "./workbench-state.js";
import type { Followup, FollowupFields, FollowupChannel } from "../../core/application-followups.js";
import { applicationStatusLabel } from "../../shared/presentation/application-status.js";
import type { NativeView } from "./views.js";
import { JobList, JobListRow } from "./JobList.js";
import { WorkbenchHeading } from "./WorkbenchHeading.js";

type Snapshot = Extract<NativeView, { kind: "workspace" }>;
const stageLabel = { waiting: "等回复", interview: "已约面", closed: "已结束" };
const bossStatus = {
  prepared: "待确认", submitting: "请求已发出", running: "执行中", finished: "已投递并核验",
  paused: "已暂停", uncertain: "结果待核对，不重发",
};
const rowIcon = { boss: "boss", mail: "pending", website: "jobs" } as const;
type Row = {
  channel: FollowupChannel;
  id: string;
  title: string;
  status: string;
  at: number;
  meta: ReactNode;
  successful: boolean;
  warning?: boolean;
  canFollowUp: boolean;
  sourceUrl?: string;
};

function applicationRows(data: Snapshot, pending: boolean) {
  const rows: Row[] = [];
  for (const d of data.bossDeliveries ?? []) {
    if (pending && !["submitting", "running", "uncertain", "paused"].includes(d.status)) continue;
    rows.push({ channel: "boss", id: d.id, title: `${d.company} · ${d.role}`, status: bossStatus[d.status],
      at: d.createdAt, meta: <>BOSS · {d.resumeName}</>, successful: d.status === "finished",
      warning: d.status === "uncertain", canFollowUp: ["finished", "uncertain", "paused"].includes(d.status) });
  }
  for (const mail of data.applications) {
    if (pending && !["prepared", "simulated"].includes(mail.status)) continue;
    rows.push({ channel: "mail", id: mail.id, title: mail.subject, status: applicationStatusLabel[mail.status],
      at: mail.receipt?.acceptedAt ?? mail.createdAt, meta: <>邮件 · <span>{mail.recipient}</span></>,
      successful: mail.status === "sent", warning: mail.status === "uncertain",
      canFollowUp: ["sent", "uncertain"].includes(mail.status) });
  }
  if (!pending) for (const submission of data.websiteSubmissions ?? []) {
    rows.push({ channel: "website", id: submission.id, title: [submission.company, submission.role].filter(Boolean).join(" · "),
      status: "手动记录已提交", at: submission.submittedAt, meta: "官网", sourceUrl: submission.sourceUrl,
      successful: true, canFollowUp: true });
  }
  return rows.sort((a, b) => b.at - a.at);
}

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function FollowupEditor({ current, busy, save, cancel }: {
  current?: Followup;
  busy: boolean;
  save: (data: FollowupFields) => void;
  cancel: () => void;
}) {
  const [stage, setStage] = useState<FollowupFields["stage"]>(current?.stage ?? "waiting");
  const [dueDate, setDueDate] = useState(current?.dueDate ?? "");
  const [note, setNote] = useState(current?.note ?? "");
  return (
    <form className="rg-followup-editor" onSubmit={(event) => {
      event.preventDefault();
      if (!busy) save({ stage, dueDate, note });
    }}>
      <div className="rg-followup-fields">
        <label>跟进进展
          <select aria-label="跟进进展" value={stage} disabled={busy} onChange={(event) => setStage(event.target.value as FollowupFields["stage"])}>
            {Object.entries(stageLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        {stage !== "closed" && <label>下次跟进日期
          <input aria-label="下次跟进日期" type="date" value={dueDate} disabled={busy} onChange={(event) => setDueDate(event.target.value)} />
        </label>}
      </div>
      <label>跟进备注
        <textarea aria-label="跟进备注" rows={3} value={note} maxLength={1000} disabled={busy} onChange={(event) => setNote(event.target.value)} />
      </label>
      <button className="rg-primary" type="submit" disabled={busy}>保存跟进</button>
      <button type="button" disabled={busy} onClick={cancel}>取消</button>
    </form>
  );
}

export function ApplicationHistory({ data, pending, busy, open, save }: {
  data: Snapshot;
  pending: boolean;
  busy: boolean;
  open: (action: unknown) => void;
  save: (action: unknown) => Promise<boolean>;
}) {
  const [dueOnly, setDueOnly] = useWorkbenchPreference<boolean>(pending ? "pending-due" : "history-due", false);
  const [editing, setEditing] = useState<string>();
  const today = localDate();
  const followups = new Map((data.applicationFollowups ?? []).map((item) => [`${item.channel}:${item.applicationId}`, item]));
  const rows = applicationRows(data, pending).map((row) => {
    const key = `${row.channel}:${row.id}`;
    const followup = followups.get(key);
    const due = !!followup?.dueDate && followup.dueDate <= today && followup.stage !== "closed";
    return { row, key, followup, due };
  });
  const dueCount = rows.filter((entry) => entry.due).length;
  const visible = dueOnly ? rows.filter((entry) => entry.due) : rows;
  return (
    <>
      <WorkbenchHeading icon={pending ? "pending" : "history"} title={pending ? "待确认邮件" : "投递记录"}
        meta={`${visible.length} 条`} action={!pending && data.applicationFollowups && (
          <button aria-pressed={dueOnly} className={dueOnly ? "rg-quiet-action" : undefined}
            onClick={() => { setDueOnly(!dueOnly); setEditing(undefined); }}>到期跟进 {dueCount}</button>
        )} />
      {visible.length ? (
        <JobList>
          {visible.map(({ row, key, followup, due }) => (
            <JobListRow key={key} icon={rowIcon[row.channel]} title={row.title} meta={<>
              <span className="rg-status" data-tone={row.successful ? "success" : row.warning ? "warning" : undefined}>{row.status}</span>
              <span>{row.meta} · {new Date(row.at).toLocaleString()}</span>
              {!pending && (followup || row.successful) && (
                <div className="rg-followup-summary">
                  <strong>{stageLabel[followup?.stage ?? "waiting"]}</strong>
                  {followup?.dueDate && <span data-due={due}>{due ? "到期" : "下次跟进"} {followup.dueDate}</span>}
                  {followup?.note && <p>{followup.note}</p>}
                </div>
              )}
            </>} action={<>
              {!pending && row.canFollowUp && data.applicationFollowups && (
                <button className="rg-quiet-action" disabled={busy} onClick={() => setEditing(key)}>{followup ? "编辑跟进" : "记录跟进"}</button>
              )}
              {row.channel === "website" ? <a href={row.sourceUrl} target="_blank" rel="noreferrer">打开官网</a> : (
                <button disabled={busy} onClick={() => open(row.channel === "boss"
                  ? { action: "boss", deliveryFocus: row.id }
                  : { action: "application", id: row.id })}>
                  {row.channel === "boss" ? "查看图片与执行记录" : "查看邮件与附件"}
                </button>
              )}
            </>} details={editing === key && (
              <FollowupEditor key={`${key}:${followup?.revision ?? 0}`} current={followup} busy={busy}
                cancel={() => setEditing(undefined)} save={(fields) => {
                  void save({ action: "save-application-followup", channel: row.channel,
                    applicationId: row.id, revision: followup?.revision ?? 0, data: fields,
                  }).then((saved) => { if (saved) setEditing(undefined); });
                }} />
            )} />
          ))}
        </JobList>
      ) : (
        <p className="rg-note">{dueOnly ? "没有到期的跟进。" : pending ? "没有待确认的邮件。" : "还没有投递记录。"}</p>
      )}
    </>
  );
}
