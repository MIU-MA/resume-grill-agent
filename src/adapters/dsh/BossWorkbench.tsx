import { useWorkbenchPreference } from "./workbench-state.js";
import type { NativeView } from "./views.js";
import { bossBatchLimit, type BossBrowserChoice } from "../../domain/boss.js";
import {
  bossRecruitmentFilter,
  bossSearchQuery,
  classifyBossRecruitment,
  recruitmentLabels,
  type BossRecruitmentFilter,
} from "../../domain/boss-recruitment.js";
import type { BossShortlistItem } from "../../core/boss-shortlists.js";
import { BossDeliveryPanel } from "./BossDeliveryPanel.js";
import type { ReadResumeImage } from "./controls.js";
import { JobList, JobListRow } from "./JobList.js";
import { WorkbenchHeading } from "./WorkbenchHeading.js";
import { bossQueueStatus } from "./boss-task-view.js";
import { BossJobDescription } from "./BossJobDescription.js";

const browserOptions = [
  ["auto", "自动"],
  ["ego", "ego"],
  ["edge", "Edge"],
  ["chrome", "Chrome"],
] as const satisfies ReadonlyArray<readonly [BossBrowserChoice, string]>;

const shortlistLabels = {
  candidate: "符合筛选",
  needs_review: "待核对",
  excluded: "已排除",
  not_read: "未读 JD",
} as const;
const requirementLabels = {
  matched: "符合",
  mismatch: "不符",
  unknown: "待核对",
} as const;
const evidenceSources = { title: "岗位名称", list: "列表", jd: "JD", page: "BOSS 岗位信息" } as const;

function BossMatchDetails({ item }: { item: BossShortlistItem }) {
  return (
    <details>
      <summary>查看筛选依据</summary>
      <ul>
        {item.recruitment?.evidence.map(({ source, quote }) => (
          <li key={source + quote}>{evidenceSources[source]}：「{quote}」</li>
        ))}
        {item.requirements?.map(({ label, quote, source, status, resumeQuote, resumeBasis }, index) => (
          <li key={`${label}-${index}`}>
            {label} · {requirementLabels[status]}
            {quote && <div>{evidenceSources[source ?? "jd"]}：「{quote}」</div>}
            {resumeQuote && <div>简历：「{resumeQuote}」</div>}
            {resumeBasis && <div>{resumeBasis}</div>}
          </li>
        ))}
        {item.skillMatches?.slice(0, 5).map(({ skill, quote, resumeQuote }) => (
          <li key={skill}>
            {skill}
            <div>JD：「{quote}」</div>
            <div>简历：「{resumeQuote}」</div>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function BossWorkbench({
  view,
  busy,
  run,
  readResumeImage,
}: {
  view: Extract<NativeView, { kind: "boss" }>;
  busy: boolean;
  run: (input: any) => Promise<unknown>;
  readResumeImage?: ReadResumeImage;
}) {
  const [query, setQuery] = useWorkbenchPreference<string>("boss-query", "");
  const [recruitment, setRecruitment] = useWorkbenchPreference<BossRecruitmentFilter>("boss-recruitment", "all");
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
  const shortlist = view.shortlists.find((item) => item.scanId === scan?.id && item.resumeId === resumeId);
  const assessed = new Map(shortlist?.items.map((item) => [item.url, item]));
  const visibleJobs = (scan?.jobs ?? [])
    .map((job) => {
      const item = assessed.get(job.url);
      const { kind } = item?.recruitment ?? classifyBossRecruitment(job.title, job.description);
      return { job, item, kind };
    })
    .filter(({ kind }) => recruitment === "all" || kind === "unknown" || kind === recruitment);
  const browser = view.browserState?.backend;
  const browserName = browserOptions.find(([value]) => value === browser)?.[1];
  const switchingBrowser = view.connected && browserChoice !== "auto" && browserChoice !== browser;
  const state = view.connected && !switchingBrowser ? scan?.state : undefined;
  const keyword = query.trim();
  const searchKeyword = bossSearchQuery(keyword, recruitment);
  const previousKeyword = scan?.requestedQuery ?? scan?.query;
  const readCurrent = (!searchKeyword || searchKeyword === previousKeyword) &&
    (state === "verification" || (state === "loading" && !scan?.searchDeferred));
  const resumeAction =
    state === "login"
      ? "登录后继续"
      : state === "verification"
        ? "验证后继续"
        : state === "loading" && (!searchKeyword || searchKeyword === previousKeyword)
          ? scan?.searchDeferred ? "继续搜索" : "查看搜索结果"
          : "找岗位并准备投递";
  const resumeSearch = (override?: string, readCurrent = false) =>
    void run({
      action: "boss-auto-prepare",
      resumeId,
      backend: browserChoice,
      recruitment,
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
      {hasResume && (
        <form onSubmit={(event) => {
          event.preventDefault();
          if (busy || (needsDirection && !keyword)) return;
          resumeSearch(keyword || (scan?.blocked ? previousKeyword : undefined), readCurrent);
        }}>
          <label>岗位关键词
            <input
              value={query}
              maxLength={120}
              placeholder={needsDirection ? "例如：数据分析实习" : "留空时根据简历搜索"}
              disabled={busy}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label>招聘类型
            <select value={recruitment} disabled={busy}
              onChange={(event) => setRecruitment(bossRecruitmentFilter.parse(event.target.value))}>
              {bossRecruitmentFilter.options.map((type) => (
                <option key={type} value={type}>{recruitmentLabels[type]}</option>
              ))}
            </select>
          </label>
          <button className="rg-primary" disabled={busy || (needsDirection && !keyword)}>
            {busy ? "正在处理…" : resumeAction}
          </button>
        </form>
      )}
      {view.connected && !switchingBrowser && (
        <button disabled={busy} onClick={() => void run({
          action: "boss-read",
          ...(hasResume ? { resumeId } : {}),
        })}>读取浏览器当前列表</button>
      )}
      {hasResume && !needsDirection && !scan && (
        <p className="rg-note">优先核对所选类型，从当前页最多读取 {bossBatchLimit} 份 JD。</p>
      )}
      </div>
      {view.note && <p role="status">{view.note}</p>}
      {scan && !switchingBrowser && (
        <section className="rg-boss-results" aria-label="搜索结果">
          {scan.blocked ? (
            <p role="status">{scan.blocked}</p>
          ) : (
            <>
              <h4>岗位列表 <small>{scan.query ? `${scan.query} · ` : ""}{visibleJobs.length} 个</small></h4>
              {view.canEditQueue && selected && !selected.hasPdf && <p className="rg-note">加入待投前，请选一份 PDF 简历。</p>}
              {!visibleJobs.length && <p className="rg-note">当前列表没有{recruitmentLabels[recruitment]}岗位。可切换类型或重新搜索。</p>}
              <JobList>
                {visibleJobs.map(({ job, item, kind }) => {
                  const queueStatus = bossQueueStatus(view, job.url);
                  const jd = item?.jobId ? view.jobDescriptions?.[item.jobId] : undefined;
                  return (
                  <JobListRow
                    key={job.url}
                    icon="boss"
                    title={job.title}
                    meta={<>
                      {queueStatus && <span className="rg-status" data-tone={queueStatus === "已投递" ? "success" : undefined}>{queueStatus}</span>}
                      <span className="rg-status" data-tone={item?.status === "candidate" ? "success" : item?.status === "needs_review" ? "warning" : undefined}>
                        {shortlistLabels[item?.status ?? "not_read"]}
                      </span>
                      {[job.company, job.salary, recruitmentLabels[kind]].filter(Boolean).join(" · ")}
                      {!!item?.reasons.length && <div>{item.reasons.join("；")}</div>}
                    </>}
                    details={jd ? <>
                      <BossJobDescription jd={jd} role={job.title} />
                      {item && !!(item.recruitment?.evidence.length || item.requirements?.length || item.skillMatches?.length) &&
                        <BossMatchDetails item={item} />}
                    </> : undefined}
                    action={<>
                      {item?.jobId && hasResume ? <button
                        disabled={busy}
                        onClick={() => void run({ action: "review", resumeId, jobId: item.jobId })}
                      >按 JD 改简历</button> : job.company.trim() ? <button
                        disabled={busy || !view.connected}
                        onClick={() => void run({
                          action: "boss-detail",
                          scanId: scan.id,
                          url: job.url,
                          ...(hasResume ? { resumeId } : {}),
                        })}
                      >
                        读取 JD
                      </button> : <a href={job.url} target="_blank" rel="noopener noreferrer">查看官网</a>}
                      {view.canEditQueue && !queueStatus && !!job.company.trim() && (
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
