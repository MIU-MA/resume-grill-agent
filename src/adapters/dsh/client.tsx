import { useEffect, useMemo, useRef, useState } from "react";
import type { NativeView } from "./views.js";
import { ApplicationReview } from "./ApplicationReview.js";
import { RevisionChanges } from "../../shared/ui/RevisionChanges.js";
import { turnCardSelector, viewReference } from "./card-model.js";
import {
  applicationStatusLabel,
  batchItemLabel,
} from "../../shared/presentation/application-status.js";
declare const __NATIVE_CSS__: string;
export const inject = ["slots", "remote", "remote.commands", "sessions"];
type Action = (input: unknown) => Promise<NativeView | null>;
type Props = {
  callId: string;
  block: any;
  act: Action;
  ask: (text: string) => Promise<unknown>;
  openFile: (path: string) => void;
};
function NativeCard({
  initial,
  act,
  ask,
  openFile,
}: {
  initial: NativeView;
  act: Action;
  ask: Props["ask"];
  openFile: Props["openFile"];
}) {
  const lock = useRef(true);
  const [view, setView] = useState(initial),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [accepted, setAccepted] = useState<string[]>([]),
    [selected, setSelected] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    void act({ action: "restore", reference: viewReference(initial) })
      .then((value) => {
        if (live && value) setView(value);
      })
      .catch((e) => {
        if (live) setError(e instanceof Error ? e.message : "无法恢复卡片。");
      })
      .finally(() => {
        if (live) {
          lock.current = false;
          setBusy(false);
        }
      });
    return () => {
      live = false;
    };
  }, []);
  const run = async (input: unknown) => {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const value = await act(input);
      if (value) setView(value);
      setSelected((items) =>
        value?.kind === "goal"
          ? items.filter((id) =>
              value.candidates.some((candidate) => candidate.jobId === id),
            )
          : [],
      );
      setAccepted([]);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败。");
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const question = async (text: string) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await ask(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "未能提交给助手。");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <section className="rg-native" aria-label="Resume Grill 求职卡片">
      <style>{__NATIVE_CSS__}</style>
      {view.kind === "review" && (
        <>
          <h3>
            {view.job.role} · {view.job.company || "公司待核对"}
          </h3>
          <p>按岗位核对简历</p>
          <details>
            <summary>岗位要求与来源</summary>
            <a href={view.job.sourceUrl} target="_blank" rel="noreferrer">
              招聘原文 ↗
            </a>
            <p className="rg-pre">{view.job.jd}</p>
          </details>
          {view.proposal ? (
            <>
              <RevisionChanges
                text={view.sourceText}
                plan={view.proposal.plan}
                accepted={accepted}
                onChange={setAccepted}
                disabled={busy}
              />
              <p className="rg-note">
                只应用勾选的修改。新 PDF
                为文本排版，不含原布局和照片，原文件会保留。
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  void run({
                    action: "prepare",
                    resumeId: view.resumeId,
                    jobId: view.jobId,
                    proposalId: view.proposal!.id,
                    accepted,
                    ...(view.goalId ? { goalId: view.goalId } : {}),
                  })
                }
              >
                用所选修改准备邮件
              </button>
            </>
          ) : (
            <>
              <p>还没有这份简历的岗位修改建议。</p>
              <button
                disabled={busy}
                onClick={() =>
                  void question(
                    `请用 resume_grill_review_context 读取简历 ${view.resumeId} 和岗位 ${view.jobId}${view.goalId ? `，保留 goalId ${view.goalId}` : ""}，依据原文给出逐条建议，调用 resume_grill_propose_resume_changes 保存并展示核对卡。不要代我接受修改或发送邮件。`,
                  )
                }
              >
                请助手给出修改建议
              </button>
            </>
          )}
          <button
            disabled={busy}
            onClick={() =>
              void run({
                action: "review",
                resumeId: view.resumeId,
                jobId: view.jobId,
                ...(view.goalId ? { goalId: view.goalId } : {}),
              })
            }
          >
            重新读取建议
          </button>
          {view.goalId && (
            <button
              disabled={busy}
              onClick={() => void run({ action: "goal", goalId: view.goalId })}
            >
              返回岗位清单
            </button>
          )}
        </>
      )}
      {view.kind === "application" && (
        <ApplicationReview
          key={`${view.application.id}:${view.application.status}`}
          view={view}
          busy={busy}
          run={run}
          openFile={openFile}
        />
      )}
      {view.kind === "goal" && (
        <>
          <h3>
            {view.goal.directions.join(" / ")} ·{" "}
            {view.goal.cities.join(" / ") || "不限城市"}
          </h3>
          <p>已保存目标，以下岗位来自实际 JD。先选岗位，再让助手逐份分析。</p>
          {view.candidates.map((c) => (
            <article key={c.jobId}>
              <label className="rg-check">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={selected.includes(c.jobId)}
                  onChange={(e) =>
                    setSelected((ids) =>
                      e.target.checked
                        ? [...ids, c.jobId]
                        : ids.filter((id) => id !== c.jobId),
                    )
                  }
                />
                <strong>
                  {c.job.role} · {c.job.company || "公司待核对"}
                </strong>
              </label>
              <p className="rg-note">{c.reasons.join(" · ")}</p>
              <a href={c.job.sourceUrl} target="_blank" rel="noreferrer">
                招聘来源 ↗
              </a>
              <button
                disabled={busy}
                onClick={() =>
                  void run({
                    action: "review",
                    resumeId: view.goal.resumeId,
                    jobId: c.jobId,
                    goalId: view.goal.id,
                  })
                }
              >
                核对简历
              </button>
            </article>
          ))}
          {!view.candidates.length && (
            <p>尚无符合规则的岗位，可让助手继续读取其他来源。</p>
          )}
          <button
            disabled={busy || !selected.length}
            onClick={() =>
              void question(
                `求职目标 ${view.goal.id}，主简历 ${view.goal.resumeId}，我选择岗位 ${selected.join("、")}。逐个读取 review_context、分析原简历与 JD，并用 resume_grill_propose_resume_changes 保存和展示修改核对卡；暂不发送。`,
              )
            }
          >
            分析所选 {selected.length} 个岗位
          </button>
          <button
            disabled={busy}
            onClick={() => void run({ action: "goal", goalId: view.goal.id })}
          >
            核对当前清单
          </button>
        </>
      )}
      {view.kind === "batch" && (
        <>
          <h3>这批投递的准备结果</h3>
          {view.batch.items.map((item) => (
            <article key={item.jobId}>
              <strong>
                {view.jobs.find((j) => j.id === item.jobId)?.role ?? "岗位"}
              </strong>
              <p>{batchItemLabel(item)}</p>
              {item.applicationId && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void run({ action: "application", id: item.applicationId })
                  }
                >
                  核对邮件与附件
                </button>
              )}
            </article>
          ))}
        </>
      )}
      {view.kind === "workspace" && (
        <>
          <h3>求职资料</h3>
          <p>
            {view.resumes.length} 份主简历 · {view.jobs.length} 个岗位 ·{" "}
            {view.goals.length} 个目标
          </p>
          {view.goals.map((goal) => (
            <button
              key={goal.id}
              disabled={busy}
              onClick={() => void run({ action: "goal", goalId: goal.id })}
            >
              {goal.directions.join(" / ")} ·{" "}
              {goal.cities.join(" / ") || "不限城市"}
            </button>
          ))}
          {!view.goals.length && (
            <p>在对话中告诉助手简历路径和求职方向，即可建立目标。</p>
          )}
        </>
      )}
      {busy && <p role="status">正在处理…</p>}
      {error && (
        <p role="alert" className="rg-error">
          {error}
        </p>
      )}
    </section>
  );
}
export function Card(props: Props) {
  const meta = props.block?.meta?.resumeGrill;
  if (!meta || meta.v !== 1)
    return (
      <p>
        求职操作{props.block?.isError ? "失败" : "处理中或未提供核对视图"}。
        {props.block?.content
          ?.filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("\n")}
      </p>
    );
  const identity =
    meta.kind === "review"
      ? (meta.proposal?.id ?? `${meta.resumeId}:${meta.jobId}`)
      : meta.kind === "application"
        ? meta.application.id
        : meta.kind === "goal"
          ? meta.goal.id
          : meta.kind === "batch"
            ? meta.batch.id
            : "workspace";
  return (
    <NativeCard
      key={identity}
      initial={meta}
      act={(input) => props.act({ ...(input as object), cardId: props.callId })}
      ask={props.ask}
      openFile={props.openFile}
    />
  );
}
export function TurnCards(props: any) {
  const turn = typeof props.turn === "number" ? props.turn : props.turn?.turn;
  const select = useMemo(() => turnCardSelector(turn), [turn]);
  const cards = props.useChat(select);
  return (
    <>
      {cards.map((block: any) => (
        <Card
          key={block.callId}
          {...props}
          block={block}
          callId={block.callId}
        />
      ))}
    </>
  );
}
function Summary({ block }: any) {
  const view = block?.meta?.resumeGrill;
  if (block?.isError) return <span>求职操作未完成，展开调用查看原因。</span>;
  return (
    <span>
      {view ? "求职核对卡已显示在本轮回答下方。" : "正在准备求职资料…"}
    </span>
  );
}
function CommandSummary({ node }: any) {
  let input: any;
  try {
    input = JSON.parse(node.args ?? "{}");
  } catch {
    return <span>求职操作参数无效。</span>;
  }
  if (input.action === "restore" && node.outcome?.kind === "success")
    return null;
  if (!node.outcome) return <span>正在处理求职操作…</span>;
  if (node.outcome.kind === "error")
    return <p role="alert">求职操作未完成：{node.outcome.text}</p>;
  let view: any;
  try {
    view = JSON.parse(node.outcome.text ?? "null");
  } catch {
    return <span>求职操作已完成。</span>;
  }
  return (
    <p>
      {view?.kind === "application"
        ? `投递记录已更新：${applicationStatusLabel[view.application.status as keyof typeof applicationStatusLabel] ?? "状态待核对"}`
        : "求职资料已更新。"}
    </p>
  );
}
export function apply(ctx: any) {
  const tools = [
    "list_workspace",
    "save_search_goal",
    "discover_jobs",
    "goal_candidates",
    "review_context",
    "propose_resume_changes",
    "prepare_application",
    "preview_application",
    "revise_application",
    "prepare_application_batch",
  ];
  const controls = (sessionId: string) => ({
    act: async (input: unknown) => {
      const response = await ctx.remote.commands.execute(
        sessionId,
        `/resume-grill ${JSON.stringify(input)}`,
        [],
      );
      if (!response.ok) throw new Error(response.error.message);
      const result = response.value?.result;
      if (!result || result.kind !== "success")
        throw new Error(result?.text ?? "未收到操作结果。");
      return JSON.parse(result.text);
    },
    ask: async (text: string) => {
      const conversation = ctx.sessions.scope(sessionId)?.get("conversation");
      if (!conversation)
        throw new Error("当前会话无法提交，请在输入框向助手说明目标。");
      return conversation.send(text);
    },
  });
  for (const tool of tools)
    ctx.slots.inject("tool.call.toolview", () =>
      ctx.slots.register(
        { name: "tool.call.toolview", key: `resume_grill_${tool}` },
        Summary,
      ),
    );
  ctx.slots.inject("conversation.chat.turnTail", () =>
    ctx.slots.register(
      {
        name: "conversation.chat.turnTail",
        id: "resume-grill-cards",
        order: 50,
        inject: controls,
      },
      TurnCards,
    ),
  );
  ctx.slots.inject("conversation.chat.commandview", () =>
    ctx.slots.register(
      { name: "conversation.chat.commandview", key: "resume-grill" },
      CommandSummary,
    ),
  );
}
