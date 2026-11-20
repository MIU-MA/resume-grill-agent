import { useWorkbenchPreference } from "./workbench-state.js";
import type { NativeView } from "./views.js";
import { bossBatchLimit, type BossBrowserChoice } from "../../domain/boss.js";
import { BossDeliveryPanel } from "./BossDeliveryPanel.js";
import type { ReadResumeImage } from "./controls.js";
import { JobList, JobListRow } from "./JobList.js";
import { WorkbenchHeading } from "./WorkbenchHeading.js";
import { bossQueueStatus } from "./boss-task-view.js";

const browserOptions = [
  ["auto", "自动"],
  ["ego", "ego"],
  ["edge", "Edge"],
  ["chrome", "Chrome"],
] as const satisfies ReadonlyArray<readonly [BossBrowserChoice, string]>;

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
  const [query, setQuery] = useWorkbenchPreference<string>("boss-query", "");
  const [browserChoice, setBrowserChoice] = useWorkbenchPreference<BossBrowserChoice>("boss-browser", "auto");
  const [selectedResume, setResume] = useWorkbenchPreference<string>("boss-resume", "");
  const [archivedOnly, setArchivedOnly] = useWorkbenchPreference<boolean>("boss-archived", false);
  const resumes = view.resumes.filter((resume) => !resume.jobId);
  const suggestedResume = view.directionNeededFor ?? view.scans[0]?.resumeId;
  const resumeId =
    resumes.find((resume) => resume.id === selectedResume)?.id ??
    resumes.find((resume) => resume.id === suggestedResume)?.id ??
    resumes[0]?.id ??
    "";
  const hasResume = resumes.some((resume) => resume.id === resumeId);
  const selected = resumes.find((resume) => resume.id === resumeId);
  const latest = view.scans[0];
  const needsDirection = hasResume && view.directionNeededFor === resumeId;
  const scan =
    !needsDirection && (!latest?.resumeId || latest.resumeId === resumeId)
      ? latest
      : undefined;
  const browser = view.browserState?.backend;
  const browserName = browserOptions.find(([value]) => value === browser)?.[1];
  const switchingBrowser = view.connected && browserChoice !== "auto" && browserChoice !== browser;
  const state = view.connected && !switchingBrowser ? scan?.state : undefined;
  const readCurrent = state === "verification" || (state === "loading" && !scan?.searchDeferred);
  const resumeAction =
    state === "login"
      ? "登录后继续"
      : state === "verification"
        ? "验证后继续"
        : state === "loading"
          ? scan?.searchDeferred ? "继续搜索" : "查看搜索结果"
          : "找岗位并准备投递";
  const resumeSearch = (override?: string, readCurrent = false) =>
    void run({
      action: "boss-auto-prepare",
      resumeId,
      backend: browserChoice,
      ...(override ? { query: override } : {}),
      ...(readCurrent ? { readCurrent: true } : {}),
    });
  const focusedDelivery = view.deliveries.find((d) => d.id === view.deliveryFocus);
  const focusedGroup = view.groups.find((g) => g.id === view.groupFocus);
  const focusedIsArchived = view.archivedTaskIds?.includes(focusedDelivery?.id ?? focusedGroup?.id ?? "");
  const hasDeliveryWork =
    view.deliveries.some((d) => !d.withdrawnAt) || view.groups.some((g) => g.expiresAt !== 0) || view.runs.length > 0;
  const pendingGroup = view.groups.find((g) => g.status === "prepared" && g.expiresAt !== 0 &&
    !view.archivedTaskIds?.includes(g.id) && g.items.every((item) => view.deliveries.some((d) =>
      d.id === item.deliveryId && d.status === "prepared" && !d.withdrawnAt && !view.archivedTaskIds?.includes(d.id))));
  const browserControls = (focus?: { groupFocus?: string; deliveryFocus?: string }) => (
    <div className="rg-boss-browser">
      <label>
        浏览器
        <select
          value={browserChoice}
          disabled={busy}
          onChange={(event) => setBrowserChoice(event.target.value as BossBrowserChoice)}
        >
          {browserOptions.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      {(!view.connected || switchingBrowser) && (
        <button disabled={busy} onClick={() => void run({
          action: "boss-connect",
          backend: browserChoice,
          ...focus,
        })}>
          {switchingBrowser ? "切换浏览器" : "打开 BOSS 浏览器"}
        </button>
      )}
      {view.connected && <p className="rg-note">已连接 {browserName ?? "BOSS 浏览器"}</p>}
    </div>
  );
  if (focusedDelivery || focusedGroup) {
    return (
      <section aria-label="BOSS 投递核对">
        <button disabled={busy} onClick={() => void run({ action: "boss" })}>
          返回岗位
        </button>
        {!focusedIsArchived && ((focusedDelivery?.status === "prepared" && !focusedDelivery.withdrawnAt) ||
          (focusedGroup?.status === "prepared" && focusedGroup.expiresAt > 0)) &&
          browserControls(focusedGroup ? { groupFocus: focusedGroup.id } : { deliveryFocus: focusedDelivery?.id })}
        {view.note && <p role="status">{view.note}</p>}
        <BossDeliveryPanel
          key={`${focusedDelivery?.id ?? focusedGroup?.id}:${browser ?? ""}`}
          view={view}
          busy={busy || switchingBrowser}
          run={run}
          readResumeImage={readResumeImage}
        />
      </section>
    );
  }
  return (
    <section aria-label="BOSS 投递">
      <WorkbenchHeading icon="boss" title="BOSS 投递" />
      <div className="rg-boss-start">
      {browserControls()}
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
              scan?.blocked || switchingBrowser ? scan?.requestedQuery ?? scan?.query ?? query : query,
              readCurrent,
            );
          }}
        >
          {busy ? "正在处理…" : resumeAction}
        </button>
      ) : null}
      {hasResume && !needsDirection && !scan && (
        <p className="rg-note">从当前页最多准备 {bossBatchLimit} 个匹配岗位，确认后投递。</p>
      )}
      </div>
      {view.note && <p role="status">{view.note}</p>}
      {scan && !switchingBrowser && (
        <section className="rg-boss-results" aria-label="搜索结果">
          {scan.blocked ? (
            <p role="status">{scan.blocked}</p>
          ) : (
            <>
              <h4>岗位列表 <small>{scan.query ? `${scan.query} · ` : ""}{scan.jobs.length} 个</small></h4>
              {view.canEditQueue && selected && !selected.hasPdf && <p className="rg-note">加入待投前，请选一份 PDF 简历。</p>}
              <JobList>
                {scan.jobs.map((job) => {
                  const queueStatus = bossQueueStatus(view, job.url);
                  return (
                  <JobListRow
                    key={job.url}
                    icon="boss"
                    title={job.title}
                    meta={<>
                      {queueStatus && <span className="rg-status" data-tone={queueStatus === "已投递" ? "success" : undefined}>{queueStatus}</span>}
                      {[job.company, job.salary].filter(Boolean).join(" · ")}
                    </>}
                    action={<>
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
                      {view.canEditQueue && !queueStatus && (
                        <button className="rg-quiet-action" disabled={busy || !view.connected || !selected?.hasPdf}
                          onClick={() => void run({
                            action: "boss-queue-add", scanId: scan.id, url: job.url, resumeId,
                            ...(pendingGroup && pendingGroup.items.length < bossBatchLimit ? { groupId: pendingGroup.id } : {}),
                          })}>
                          加入待投
                        </button>
                      )}
                    </>}
                  />
                  );
                })}
              </JobList>
            </>
          )}
        </section>
      )}
      {hasDeliveryWork && (
        <section className="rg-boss-tasks" aria-label="投递任务">
          <h4>投递任务</h4>
          <BossDeliveryPanel view={view} busy={busy} run={run} readResumeImage={readResumeImage}
            archiveFilter={{ archivedOnly, setArchivedOnly }} />
        </section>
      )}
    </section>
  );
}
