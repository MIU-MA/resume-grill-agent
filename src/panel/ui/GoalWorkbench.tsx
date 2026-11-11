import { useState } from "react";
import { api, type Snapshot } from "./api.js";
import type { Goal, SearchRun, Batch } from "../../tasks.js";
import { RevisionChanges } from "./RevisionChanges.js";
const terms = (value: string) =>
  value
    .split(/[,，、\n]/)
    .map((v) => v.trim())
    .filter(Boolean);
export function GoalWorkbench({
  data,
  busy,
  onRun,
  onRefresh,
  onOpen,
}: {
  data: Snapshot;
  busy: boolean;
  onRun: (fn: () => Promise<void>) => Promise<void>;
  onRefresh: () => Promise<Snapshot>;
  onOpen: (id: string) => void;
}) {
  const [goalId, setGoalId] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [choices, setChoices] = useState<
      Record<
        string,
        { accepted: string[]; keepOriginal: boolean; proposalId?: string }
      >
    >({});
  const goal = data.goals.find((g) => g.id === goalId) ?? data.goals[0],
    run = data.searches.find((r) => r.goalId === goal?.id),
    batch = data.batches.find((b) => b.goalId === goal?.id);
  const candidateRows = goal ? (data.goalCandidates[goal.id] ?? []) : [];
  const candidates = candidateRows.map((row) => row.job);
  const visibleSelected = selected.filter((id) =>
    candidates.some((job) => job.id === id),
  );
  const source = data.resumes.find((r) => r.id === goal?.resumeId);
  const choiceFor = (jobId: string) => {
    const proposal = data.proposals.find(
      (p) => p.jobId === jobId && p.resumeId === goal?.resumeId,
    );
    const old = choices[jobId];
    return old?.proposalId === proposal?.id
      ? (old ?? { accepted: [], keepOriginal: false, proposalId: proposal?.id })
      : {
          accepted: [],
          keepOriginal: old?.keepOriginal ?? false,
          proposalId: proposal?.id,
        };
  };
  const change = (
    jobId: string,
    value: Partial<{ accepted: string[]; keepOriginal: boolean }>,
  ) =>
    setChoices((items) => ({
      ...items,
      [jobId]: { ...choiceFor(jobId), ...value },
    }));
  return (
    <main className="goal-workbench">
      <section className="goal-settings">
        <h1>求职任务</h1>
        <p className="muted">记住目标，读取官网，集中准备待确认的投递。</p>
        {data.goals.length > 0 && (
          <label>
            已有目标
            <select
              value={goal?.id ?? ""}
              disabled={busy}
              onChange={(e) => {
                setGoalId(e.target.value);
                setSelected([]);
                setChoices({});
              }}
            >
              {data.goals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.directions.join(" / ")} ·{" "}
                  {g.cities.join(" / ") || "不限城市"}
                </option>
              ))}
            </select>
          </label>
        )}
        <details open={!goal}>
          <summary>{goal ? "调整目标或新建" : "设置求职目标"}</summary>
          <form
            key={goal?.id ?? "new"}
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void onRun(async () => {
                const g = await api<Goal>("goals", {
                  resumeId: String(f.get("resume")),
                  directions: terms(String(f.get("directions"))),
                  cities: terms(String(f.get("cities"))),
                  exclude: terms(String(f.get("exclude"))),
                  sources: terms(String(f.get("sources"))),
                  limit: Number(f.get("limit")),
                });
                await onRefresh();
                setGoalId(g.id);
                setSelected([]);
                setChoices({});
              });
            }}
          >
            <label>
              主简历
              <select name="resume" required defaultValue={goal?.resumeId}>
                {data.resumes
                  .filter((r) => !r.parentId)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              岗位方向
              <input
                name="directions"
                required
                placeholder="全栈、产品经理、数据分析…"
                defaultValue={goal?.directions.join("、")}
              />
            </label>
            <label>
              城市（可选）
              <input
                name="cities"
                placeholder="杭州、上海"
                defaultValue={goal?.cities.join("、")}
              />
            </label>
            <label>
              排除词（可选）
              <input
                name="exclude"
                placeholder="外包、劳务派遣、公司名称"
                defaultValue={goal?.exclude.join("、")}
              />
            </label>
            <label>
              本批最多岗位数
              <input
                name="limit"
                type="number"
                min="1"
                max="20"
                defaultValue={goal?.limit ?? 10}
              />
            </label>
            <details>
              <summary>指定招聘官网（可选）</summary>
              <textarea
                name="sources"
                placeholder="每行一个 HTTPS 招聘页面；留空使用内置官网"
                defaultValue={goal?.sources.join("\n")}
              />
            </details>
            <button className="primary" disabled={busy || !data.resumes.length}>
              保存目标
            </button>
          </form>
        </details>
        {goal && (
          <>
            <p>
              <strong>{goal.directions.join(" / ")}</strong>
              <br />
              {goal.cities.join(" / ") || "不限城市"} ·{" "}
              {data.resumes.find((r) => r.id === goal.resumeId)?.name}
            </p>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void onRun(async () => {
                  await api<SearchRun>("discover", { goalId: goal.id });
                  await onRefresh();
                  setSelected([]);
                })
              }
            >
              读取招聘官网
            </button>
            <p className="muted">
              最多读取 6 个来源，单次约 40
              秒。动态列表可能无法读取，失败会保留原因。
            </p>
          </>
        )}
        {run && (
          <details>
            <summary>
              本次查找范围 ·{" "}
              {run.sources.filter((s) => s.status === "read").length}/
              {run.sources.length} 已读取
            </summary>
            {run.sources.map((s) => (
              <p key={s.url}>
                <a href={s.url} target="_blank" rel="noreferrer">
                  {new URL(s.url).hostname}
                </a>{" "}
                ·{" "}
                {s.status === "read"
                  ? "已读取"
                  : s.status === "failed"
                    ? s.error
                    : "未读取"}
              </p>
            ))}
            {run.notes.map((n, i) => (
              <p key={i}>{n}</p>
            ))}
          </details>
        )}
      </section>
      <section className="goal-results">
        <div className="section-heading">
          <h2>待决定</h2>
          <span className="badge">{candidates.length} 个岗位</span>
        </div>
        {candidates.map((job) => {
          const proposal = data.proposals.find(
              (p) => p.jobId === job.id && p.resumeId === goal?.resumeId,
            ),
            choice = choiceFor(job.id),
            candidate = candidateRows.find((c) => c.jobId === job.id);
          return (
            <article className="candidate" key={job.id}>
              <label className="check">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={selected.includes(job.id)}
                  onChange={(e) =>
                    setSelected((items) =>
                      e.target.checked
                        ? [...items, job.id]
                        : items.filter((id) => id !== job.id),
                    )
                  }
                />
                <strong>
                  {job.role} · {job.company || "公司待核对"}
                </strong>
              </label>
              <p className="muted">
                {candidate?.reasons.join(" · ") ??
                  "来自已保存岗位，准备时重新核对目标与重复记录。"}
              </p>
              <a href={job.sourceUrl} target="_blank" rel="noreferrer">
                查看招聘来源 ↗
              </a>
              <details>
                <summary>查看岗位正文</summary>
                <p className="pre">{job.jd}</p>
              </details>
              {proposal ? (
                <>
                  <h3>核对这份岗位简历</h3>
                  <RevisionChanges
                    text={source?.text ?? ""}
                    plan={proposal.plan}
                    accepted={choice.accepted}
                    disabled={busy || choice.keepOriginal}
                    onChange={(accepted) => change(job.id, { accepted })}
                  />
                </>
              ) : (
                <p className="warning">
                  还没有岗位修改建议。让助手分析后刷新，或明确选择保留原文。
                </p>
              )}
              <label className="check">
                <input
                  type="checkbox"
                  checked={choice.keepOriginal}
                  disabled={busy}
                  onChange={(e) =>
                    change(job.id, {
                      keepOriginal: e.target.checked,
                      accepted: [],
                    })
                  }
                />
                这份岗位简历保留原文，不接受修改
              </label>
            </article>
          );
        })}
        {!candidates.length && (
          <div className="empty">
            <h2>{goal ? "暂时没有可核对的岗位" : "先保存求职目标"}</h2>
            <p>
              {goal
                ? "读取招聘官网，或让助手通过浏览器读取岗位后保存。不会用招聘入口凑数。"
                : "还没有简历时，请先到“准备投递”导入。"}
            </p>
          </div>
        )}
        {goal && visibleSelected.length > 0 && (
          <>
            <p className="muted">
              生成的岗位 PDF
              采用文本排版，不保留原布局和照片。此操作只准备内容，不发送邮件。
            </p>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void onRun(async () => {
                  await api<Batch>("batch", {
                    goalId: goal.id,
                    choices: visibleSelected.map((jobId) => ({
                      jobId,
                      ...choiceFor(jobId),
                    })),
                  });
                  await onRefresh();
                })
              }
            >
              准备所选 {visibleSelected.length} 个岗位
            </button>
          </>
        )}
        {batch && (
          <aside className="batch-results">
            <h2>本批待执行</h2>
            {batch.items.map((item) => (
              <div key={item.jobId}>
                <strong>
                  {data.jobs.find((j) => j.id === item.jobId)?.role}
                </strong>
                <p>
                  {item.status === "prepared"
                    ? "简历与邮件已准备"
                    : item.reason}
                </p>
                {item.applicationId && (
                  <button onClick={() => onOpen(item.applicationId!)}>
                    核对邮件与附件
                  </button>
                )}
              </div>
            ))}
          </aside>
        )}
      </section>
    </main>
  );
}
