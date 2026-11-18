import { useId, useState } from "react";
import type { NativeView } from "./views.js";
import { BossDeliveryPanel } from "./BossDeliveryPanel.js";
import type {
  BossBrowserBackend,
  BossBrowserChoice,
} from "../../domain/boss.js";
const browsers: Record<BossBrowserBackend, string> = {
  ego: "ego",
  edge: "Microsoft Edge",
  chrome: "Google Chrome",
};

export function BossWorkbench({
  view,
  busy,
  run,
  open,
  openFile,
}: {
  view: Extract<NativeView, { kind: "boss" }>;
  busy: boolean;
  run: (input: any) => Promise<unknown>;
  open?: (input: any) => void;
  openFile: (path: string) => void;
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
  const [backend, setBackend] = useState<BossBrowserChoice | undefined>();
  const browserSelectId = useId();
  const activeBrowser =
    browsers[view.browserState?.backend as BossBrowserBackend];
  const [goalId, setGoal] = useState(view.goals[0]?.id ?? ""),
    [budget, setBudget] = useState(5);
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
      backend: backend ?? view.browserPreference,
      ...(override ? { query: override } : {}),
      ...(readCurrent ? { readCurrent: true } : {}),
    });
  const readCurrent = () =>
    void run({ action: "boss-read", ...(hasResume ? { resumeId } : {}) });
  const focusedDelivery = view.deliveries.find((d) => d.id === view.deliveryFocus);
  const focusedGroup = view.groups.find((g) => g.id === view.groupFocus);
  const hasDeliveryWork =
    view.deliveries.length > 0 || view.groups.length > 0 || view.runs.length > 0;
  if (focusedDelivery || focusedGroup) {
    return (
      <section aria-label="BOSS 投递核对">
        <button disabled={busy} onClick={() => void run({ action: "boss" })}>
          返回岗位
        </button>
        {view.note && <p role="status">{view.note}</p>}
        <BossDeliveryPanel
          key={focusedDelivery?.id ?? focusedGroup?.id}
          view={view}
          busy={busy}
          run={run}
          openFile={openFile}
        />
      </section>
    );
  }
  return (
    <section aria-label="BOSS 投递">
      <h3>BOSS 投递</h3>
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
          <button disabled={busy || !query.trim()}>找岗位并准备投递</button>
        </form>
      ) : hasResume ? (
        <button
          disabled={busy}
          onClick={() => {
            resumeSearch(
              scan?.blocked ? scan.query : undefined,
              state === "verification" || state === "loading",
            );
          }}
        >
          {busy ? "正在处理…" : resumeAction}
        </button>
      ) : null}
      {hasResume && !needsDirection && !scan && (
        <p>自动找岗位、读 JD，准备最多 3 份投递。核对后才会发送。</p>
      )}
      {view.note && <p role="status">{view.note}</p>}
      <details>
        <summary>更多选项</summary>
        {view.connected && activeBrowser && <p>已连接 {activeBrowser}</p>}
        {view.connected ? (
          <button
            disabled={busy}
            onClick={() => void run({ action: "boss-unlink" })}
          >
            断开浏览器
          </button>
        ) : (
          <>
          <label htmlFor={browserSelectId}>浏览器</label>
          <select
            id={browserSelectId}
            disabled={busy}
            value={backend ?? view.browserPreference}
            onChange={(e) => setBackend(e.target.value as BossBrowserChoice)}
          >
            <option value="auto">自动</option>
            {Object.entries(browsers).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button
            disabled={busy}
            onClick={() =>
              void run({
                action: "boss-connect",
                backend: backend ?? view.browserPreference,
              })
            }
          >
            连接浏览器
          </button>
          </>
        )}
        {!needsDirection && hasResume && <form onSubmit={(event) => {
          event.preventDefault();
          if (!busy && query.trim()) resumeSearch(query);
        }}>
          <label>
            更换搜索方向
            <input
              value={query}
              maxLength={120}
              placeholder={scan?.query}
              disabled={busy}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <button disabled={busy || !query.trim()}>搜索</button>
        </form>}
        {view.connected && (
          <button disabled={busy} onClick={readCurrent}>
            读取当前列表
          </button>
        )}
      {scan && !scan.blocked && view.goals.length > 0 && (
        <details>
          <summary>按已保存的求职条件筛选</summary>
          <label>
            已保存目标
            <select
              value={goalId}
              disabled={busy}
              onChange={(e) => setGoal(e.target.value)}
            >
              <option value="">选择目标</option>
              {view.goals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.directions.join("、")} ·{" "}
                  {g.cities.join("、") || "不限城市"}
                </option>
              ))}
            </select>
          </label>
          <label>
            本次最多读取详情
            <input
              type="number"
              min={1}
              max={10}
              disabled={busy}
              value={budget}
              onChange={(e) => setBudget(Number(e.target.value))}
            />
          </label>
          <button
            disabled={
              busy ||
              !view.connected ||
              !goalId ||
              !Number.isInteger(budget) ||
              budget < 1 ||
              budget > 10
            }
            onClick={() =>
              void run({
                action: "boss-shortlist",
                goalId,
                scanId: scan.id,
                budget,
              })
            }
          >
            筛选并读取完整 JD
          </button>
        </details>
      )}
      {view.shortlists.filter((s) => s.scanId === scan?.id).slice(0, 1).map((s) => (
        <section key={s.id}>
          <h4>
            筛选结果 · 已读取 {s.detailsRead}/{s.budget} 个详情
          </h4>
          {s.items.map((i) => (
            <article key={i.url}>
              <strong>
                {i.company} · {i.title}
              </strong>
              <p>
                {
                  {
                    candidate: "可进一步核对",
                    needs_review: "待核对",
                    excluded: "已排除",
                    not_read: "未读取详情",
                  }[i.status]
                }{" "}
                · {i.reasons.join("；")}
              </p>
              {i.evidence.map((e, n) => (
                <blockquote key={n}>{e}</blockquote>
              ))}
              {i.jobId && hasResume && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void run({ action: "review", resumeId, jobId: i.jobId })
                  }
                >
                  结合完整 JD 核对简历
                </button>
              )}
            </article>
          ))}
        </section>
      ))}
      </details>
      {scan && (
        <section aria-label="搜索结果">
          {scan.blocked ? (
            <p role="status">{scan.blocked}</p>
          ) : (
            <>
              <p>{scan.query ? `${scan.query} · ` : ""}{scan.jobs.length} 个岗位</p>
              {scan.jobs.map((job) => (
                <article key={job.url}>
                  <h4>{job.title}</h4>
                  <p>{[job.company, job.salary].filter(Boolean).join(" · ")}</p>
                  <button
                    disabled={busy || !view.connected}
                    onClick={() => {
                      const action = {
                        action: "boss-detail",
                        scanId: scan.id,
                        url: job.url,
                        ...(hasResume ? { resumeId } : {}),
                      };
                      open ? open(action) : void run(action);
                    }}
                  >
                    查看岗位
                  </button>
                </article>
              ))}
            </>
          )}
        </section>
      )}
      {hasDeliveryWork && (
        <details>
          <summary>投递任务</summary>
          <BossDeliveryPanel view={view} busy={busy} run={run} openFile={openFile} />
        </details>
      )}
    </section>
  );
}
