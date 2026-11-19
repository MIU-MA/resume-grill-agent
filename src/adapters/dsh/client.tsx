import { useEffect, useMemo, useRef, useState } from "react";
import type { NativeView } from "./views.js";
import { ApplicationReview } from "./ApplicationReview.js";
import { nativeCommandError, nativeControls, type ReadResumeImage } from "./controls.js";
import { notifyWorkspaceChanged, onWorkspaceChanged } from "./updates.js";
import { ResumeDocument } from "./ResumeDocument.js";
import { BossWorkbench } from "./BossWorkbench.js";
import { bossUrl, isBossSource } from "../../domain/boss.js";
import { ResumeProfileEditor } from "./ResumeProfileEditor.js";
import { JobRevision } from "./JobRevision.js";
import { registerWorkbench } from "./workbench.js";
import { RevisionChanges } from "../../shared/ui/RevisionChanges.js";
import { turnCardSelector, viewReference } from "./card-model.js";
import { hasCapability } from "../../shared/capabilities.js";
import {
  applicationStatusLabel,
  batchItemLabel,
} from "../../shared/presentation/application-status.js";
declare const __NATIVE_CSS__: string;
export const inject = [
  "slots",
  "remote",
  "remote.commands",
  "remote.workspaceFiles",
  "remote.credentials",
  "sessions",
  "sidebarRight",
  "sidebarRightTabs",
  "configForms",
  "layout",
  "fileUpload",
];
type Action = (input: unknown) => Promise<NativeView | null>;
type Props = {
  callId: string;
  block: any;
  act: Action;
  ask: (text: string) => Promise<unknown>;
  openFile: (path: string) => void;
  readResumeImage?: ReadResumeImage;
};
function reviewRequest(view: Extract<NativeView, { kind: "review" }>) {
  return `请调用 resume_grill_review_context 读取简历 ${view.resumeId} 与岗位 ${view.jobId}${view.goalId ? `，保留 goalId ${view.goalId}` : ""}，基于当前 JD 和简历原文生成逐条修改，并调用 resume_grill_propose_resume_changes 保存新建议。不得编造经历、替我接受修改、准备或发送邮件。`;
}
export function NativeCard({
  initial,
  act,
  ask,
  openFile,
  readResumeImage,
  sessionId,
}: {
  initial: NativeView;
  act: Action;
  ask: Props["ask"];
  openFile: Props["openFile"];
  readResumeImage?: ReadResumeImage;
  sessionId?: string;
}) {
  const lock = useRef(true);
  const refreshVersion = useRef(0);
  const [view, setView] = useState(initial),
    [working, setBusy] = useState(true),
    [restored, setRestored] = useState(false),
    [restoreAttempt, setRestoreAttempt] = useState(0),
    [requesting, setRequesting] = useState(false),
    [error, setError] = useState(""),
    [accepted, setAccepted] = useState<string[]>([]),
    [selected, setSelected] = useState<string[]>([]);
  const busy = working || requesting;
  const bossSource = view.kind === "review" &&
    (view.channel === "boss" || isBossSource(view.job.sourceUrl));
  const bossReview = bossSource && view.kind === "review" &&
    hasCapability(view.capabilities, "boss") &&
    bossUrl.safeParse(view.job.sourceUrl).success;
  const websiteReview = view.kind === "review" && !bossSource &&
    hasCapability(view.capabilities, "website");
  useEffect(() => {
    let live = true;
    void act({ action: "restore", reference: viewReference(initial) })
      .then((value) => {
        if (!live) return;
        if (!value) throw new Error("没有找到对应记录。");
        lock.current = false;
        setView(value);
        setRestored(true);
      })
      .catch((e) => {
        if (live) setError(e instanceof Error ? e.message : "无法恢复卡片。");
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [restoreAttempt]);
  useEffect(() => {
    if (!restored || !sessionId || view.kind !== "review") return;
    let live = true;
    const unsubscribe = onWorkspaceChanged(sessionId, ({ error }) => {
      const request = ++refreshVersion.current;
      if (error) {
        setError(error);
        setRequesting(false);
        return;
      }
      void act({
        action: "review",
        resumeId: view.resumeId,
        jobId: view.jobId,
        ...(view.goalId ? { goalId: view.goalId } : {}),
      })
        .then((value) => {
          if (!live || request !== refreshVersion.current) return;
          setRequesting(false);
          if (
            value?.kind === "review" &&
            (value.proposal?.id !== view.proposal?.id ||
              value.formRun?.updatedAt !== view.formRun?.updatedAt ||
              value.profile?.id !== view.profile?.id ||
              value.sourceText !== view.sourceText ||
              value.job.jd !== view.job.jd)
          ) {
            setView(value);
            if (value.proposal?.id !== view.proposal?.id) setAccepted([]);
          }
        })
        .catch((e) => {
          if (!live || request !== refreshVersion.current) return;
          setRequesting(false);
          setError(e instanceof Error ? e.message : "建议读取失败");
        });
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [restored, sessionId, view]);
  const run = async (input: unknown) => {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const value = await act(input);
      if (value) {
        refreshVersion.current++;
        setView(value);
      }
      setSelected((items) =>
        value?.kind === "goal"
          ? items.filter((id) =>
              value.candidates.some((candidate) => candidate.jobId === id),
            )
          : [],
      );
      setAccepted([]);
      if ((input as any)?.action === "update-jd" && value?.kind === "review") {
        setRequesting(true);
        await ask(reviewRequest(value));
      }
      return true;
    } catch (e) {
      setRequesting(false);
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
    setRequesting(view.kind === "review");
    setError("");
    try {
      await ask(text);
    } catch (e) {
      setRequesting(false);
      setError(e instanceof Error ? e.message : "未能提交给助手。");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  if (!restored)
    return (
      <section className="rg-native" aria-label="Resume Grill 求职卡片">
        <style>{__NATIVE_CSS__}</style>
        {working ? (
          <p role="status">正在读取当前记录…</p>
        ) : (
          <>
            <p role="alert" className="rg-error">
              无法打开卡片：{error}
            </p>
            <button
              onClick={() => {
                setBusy(true);
                setError("");
                setRestoreAttempt((attempt) => attempt + 1);
              }}
            >
              重新读取
            </button>
          </>
        )}
      </section>
    );
  return (
    <section className="rg-native" aria-label="Resume Grill 求职卡片">
      <style>{__NATIVE_CSS__}</style>
      {view.kind === "boss" && (
        <BossWorkbench view={view} busy={busy} run={run} readResumeImage={readResumeImage} />
      )}
      {view.kind === "resume" && (
        <ResumeDocument
          key={view.resume.id}
          resume={view.resume}
          busy={busy}
          run={run}
          openFile={openFile}
          canParseProfile={hasCapability(view.capabilities, "website")}
        />
      )}
      {view.kind === "profile" && (
        <ResumeProfileEditor
          key={view.profile.id}
          view={view}
          busy={busy}
          run={run}
        />
      )}
      {view.kind === "review" && (
        <>
          <h3>
            {view.job.role} · {view.job.company || "公司待核对"}
          </h3>
          <p className="rg-note">{bossSource ? "BOSS 投递" : "招聘官网"} · 按岗位核对简历</p>
          {requesting && (
            <p role="status">正在通过当前会话生成建议，完成后会在这里更新。</p>
          )}
          <JobRevision key={view.jobId} view={view} busy={busy} run={run} />
          {websiteReview && view.formRun && (
            <section aria-label="官网填写进度">
              <h4>
                官网填写 ·{" "}
                {
                  {
                    inspecting: "待读取表单",
                    filling: "待回读检查",
                    needs_input: "有待补充项目",
                    needs_review: "需要人工核对",
                    ready: "已核对，未提交",
                    stale: "资料已变更，请重开任务",
                  }[view.formRun.status]
                }
              </h4>
              <p className="rg-note">
                已核对{" "}
                {
                  view.formRun.checks.filter((c) => c.status === "matched")
                    .length
                }{" "}
                项 · 待处理 {view.formRun.issues.length} 项
              </p>
              {view.formRun.issues.map((issue, index) => (
                <p key={index}>
                  {issue.label}：{issue.reason}
                </p>
              ))}
              {view.formRun.checks
                .filter((c) => c.status !== "matched")
                .map((c) => (
                  <p key={c.uid}>
                    {c.label}：
                    {c.status === "missing"
                      ? "回读未取得值"
                      : "回读与资料不一致"}
                    （失败 {c.attempt} 次）
                  </p>
                ))}
            </section>
          )}
          {websiteReview && (
            <section aria-label="招聘官网申请">
              <h4>招聘官网申请</h4>
              <p className="rg-note">用专用窗口填写。遇到登录或验证，处理完再点一次代填。</p>
              {view.websiteNotice && <p role="status">{view.websiteNotice}</p>}
              <button
                disabled={busy}
                onClick={() =>
                  void run({
                    action: "profile",
                    resumeId: view.resumeId,
                    jobId: view.jobId,
                  })
                }
              >
                {view.profile?.confirmedAt
                  ? "查看 / 修改已确认资料"
                  : "解析简历并核对资料"}
              </button>
              {!view.profile?.confirmedAt && (
                <p className="rg-note">
                  先确认解析资料，再交给浏览器回填；换岗位可直接复用。
                </p>
              )}
              <button
                disabled={busy || !view.profile?.confirmedAt}
                onClick={() =>
                  void run({
                    action: "website-fill",
                    resumeId: view.resumeId,
                    jobId: view.jobId,
                    ...(view.goalId ? { goalId: view.goalId } : {}),
                  })
                }
              >
                官网代填
              </button>
            </section>
          )}
          {bossSource && !bossReview && (
            <p className="rg-note">这是 BOSS 岗位。请从「BOSS 投递」列表打开具体岗位后再准备投递。</p>
          )}
          {bossReview && (
            <button
              disabled={busy}
              onClick={() =>
                void run({
                  action: "boss-prepare",
                  resumeId: view.resumeId,
                  jobId: view.jobId,
                })
              }
            >
              用当前简历准备 BOSS 投递
            </button>
          )}
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
                    action: "save-version",
                    resumeId: view.resumeId,
                    jobId: view.jobId,
                    proposalId: view.proposal!.id,
                    accepted,
                  })
                }
              >
                保存所选修改为岗位版 PDF
              </button>
              {bossReview && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run({
                        action: "boss-save-review",
                        resumeId: view.resumeId,
                        jobId: view.jobId,
                        proposalId: view.proposal!.id,
                        accepted,
                      })
                    }
                  >
                    保存所选修改并核对 BOSS 图片
                  </button>
                )}
              {!bossSource && hasCapability(view.capabilities, "mail") && view.job.recipient && (
                <button
                  disabled={busy || !view.job.recipient}
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
              )}
            </>
          ) : (
            <>
              <p>还没有这份简历的岗位修改建议。</p>
              <button
                disabled={busy}
                onClick={() => void question(reviewRequest(view))}
              >
                请助手给出修改建议
              </button>
            </>
          )}
          {view.proposal && (
            <button disabled={busy} onClick={() => void question(reviewRequest(view))}>
              重新生成建议
            </button>
          )}
          {!bossReview && (
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
          )}
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
          {view.search && (
            <details open={!view.candidates.length}>
              <summary>本次读取范围与结果</summary>
              {view.search.sources.map((source) => (
                <p key={source.url} className="rg-note">
                  {source.url} ·{" "}
                  {source.status === "read"
                    ? "已读取"
                    : source.status === "failed"
                      ? "读取失败"
                      : "未读取"}
                  {source.error ? `：${source.error}` : ""}
                </p>
              ))}
              {view.search.notes.map((note, index) => (
                <p key={index} className="rg-note">
                  {note}
                </p>
              ))}
            </details>
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
      readResumeImage={props.readResumeImage}
      sessionId={(props as any).sessionId}
    />
  );
}
export function TurnCards(props: any) {
  const turn = typeof props.turn === "number" ? props.turn : props.turn?.turn;
  const select = useMemo(() => turnCardSelector(turn), [turn]);
  const cards = props.useChat(select);
  useEffect(() => {
    if (cards.length && props.sessionId)
      notifyWorkspaceChanged(props.sessionId);
  }, [cards, props.sessionId]);
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
  if (input.surface === "workbench") return null;
  if (!node.outcome) return <span>正在处理求职操作…</span>;
  if (node.outcome.kind === "error")
    return <p role="alert">求职操作未完成：{nativeCommandError(input, node.outcome.text ?? "未收到操作结果。")}</p>;
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
  registerWorkbench(ctx, NativeCard);
  const tools = [
    "read_recruiting_site",
    "read_job_detail",
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
  const controls = (sessionId: string) => nativeControls(ctx, sessionId);
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
