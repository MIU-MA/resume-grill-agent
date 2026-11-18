import { useState } from "react";
import type { NativeView } from "./views.js";
import { BossDeliveryPanel } from "./BossDeliveryPanel.js";
import type { ReadResumeImage } from "./controls.js";
import { JobList, JobListRow } from "./JobList.js";
import { WhaleMark } from "./WhaleMark.js";

export function BossWorkbench({
  view,
  busy,
  run,
  open,
  readResumeImage,
}: {
  view: Extract<NativeView, { kind: "boss" }>;
  busy: boolean;
  run: (input: any) => Promise<unknown>;
  open?: (input: any) => void;
  readResumeImage?: ReadResumeImage;
}) {
  const [query, setQuery] = useState("");
  const [selectedResume, setResume] = useState<string>();
  const resumes = view.resumes.filter((resume) => !resume.jobId);
  const suggestedResume = view.directionNeededFor ?? view.scans[0]?.resumeId;
  const resumeId =
    selectedResume ??
    resumes.find((resume) => resume.id === suggestedResume)?.id ??
    resumes[0]?.id ??
    "";
  const hasResume = resumes.some((resume) => resume.id === resumeId);
  const latest = view.scans[0];
  const needsDirection = hasResume && view.directionNeededFor === resumeId;
  const scan =
    !needsDirection && (!latest?.resumeId || latest.resumeId === resumeId)
      ? latest
      : undefined;
  const state = view.connected ? scan?.state : undefined;
  const resumeAction =
    state === "login"
      ? "登录后继续"
      : state === "verification"
        ? "验证后继续"
        : state === "loading"
          ? "查看搜索结果"
          : "找岗位并准备投递";
  const resumeSearch = (override?: string, readCurrent = false) =>
    void run({
      action: "boss-auto-prepare",
      resumeId,
      ...(override ? { query: override } : {}),
      ...(readCurrent ? { readCurrent: true } : {}),
    });
  const focusedDelivery = view.deliveries.find((d) => d.id === view.deliveryFocus);
  const focusedGroup = view.groups.find((g) => g.id === view.groupFocus);
  const hasDeliveryWork =
    view.deliveries.length > 0 || view.groups.some((g) => g.expiresAt !== 0) || view.runs.length > 0;
  if (focusedDelivery || focusedGroup) {
    return (
      <section aria-label="BOSS 投递核对">
        <button disabled={busy} onClick={() => void run({ action: "boss" })}>
          返回岗位
        </button>
        {!view.connected && (focusedDelivery?.status === "prepared" ||
          (focusedGroup?.status === "prepared" && focusedGroup.expiresAt > 0)) && (
          <button disabled={busy} onClick={() => void run({
            action: "boss-connect",
            ...(focusedGroup ? { groupFocus: focusedGroup.id } : { deliveryFocus: focusedDelivery?.id }),
          })}>
            连接浏览器
          </button>
        )}
        {view.note && <p role="status">{view.note}</p>}
        <BossDeliveryPanel
          key={focusedDelivery?.id ?? focusedGroup?.id}
          view={view}
          busy={busy}
          run={run}
          readResumeImage={readResumeImage}
        />
      </section>
    );
  }
  return (
    <section aria-label="BOSS 投递">
      <h3 className="rg-marked-heading">BOSS 投递 <WhaleMark /></h3>
      <div className="rg-boss-start">
      {resumes.length === 1 && <p>简历：{resumes[0].name}</p>}
      {resumes.length > 1 && (
        <label>
          简历
          <select
            disabled={busy}
            value={hasResume ? resumeId : ""}
            onChange={(e) => {
              setResume(e.target.value);
              setQuery("");
            }}
          >
            {resumes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {resumes.length === 0 && <p>先在简历库上传一份主简历。</p>}
      {needsDirection ? (
        <form onSubmit={(event) => {
          event.preventDefault();
          if (!busy && query.trim()) resumeSearch(query);
        }}>
          <label>简历里的方向不明确，你想找什么岗位？
            <input
              value={query}
              maxLength={120}
              placeholder="例如：数据分析实习"
              disabled={busy}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <button className="rg-primary" disabled={busy || !query.trim()}>找岗位并准备投递</button>
        </form>
      ) : hasResume ? (
        <button
          className="rg-primary"
          disabled={busy}
          onClick={() => {
            resumeSearch(
              scan?.blocked ? scan.requestedQuery ?? scan.query : undefined,
              state === "verification" || state === "loading",
            );
          }}
        >
          {busy ? "正在处理…" : resumeAction}
        </button>
      ) : null}
      {hasResume && !needsDirection && !scan && (
        <p className="rg-note">自动搜索并准备最多 3 个岗位，确认后投递。</p>
      )}
      </div>
      {view.note && <p role="status">{view.note}</p>}
      {scan && (
        <section className="rg-boss-results" aria-label="搜索结果">
          {scan.blocked ? (
            <p role="status">{scan.blocked}</p>
          ) : (
            <>
              <h4>岗位列表 <small>{scan.query ? `${scan.query} · ` : ""}{scan.jobs.length} 个</small></h4>
              <JobList>
                {scan.jobs.map((job) => (
                  <JobListRow
                    key={job.url}
                    title={job.title}
                    meta={[job.company, job.salary].filter(Boolean).join(" · ")}
                    action={
                      <button
                        disabled={busy || !view.connected}
                        onClick={() => {
                          const action = { action: "boss-detail", scanId: scan.id, url: job.url,
                            ...(hasResume ? { resumeId } : {}) };
                          open ? open(action) : void run(action);
                        }}
                      >
                        查看岗位
                      </button>
                    }
                  />
                ))}
              </JobList>
            </>
          )}
        </section>
      )}
      {hasDeliveryWork && (
        <section className="rg-boss-tasks" aria-label="投递任务">
          <h4>投递任务</h4>
          <BossDeliveryPanel view={view} busy={busy} run={run} readResumeImage={readResumeImage} />
        </section>
      )}
    </section>
  );
}
