import { useEffect, useMemo, useRef, useState } from "react";
import type { NativeView } from "./views.js";
import { nativeControls, selectedSessionId } from "./controls.js";
import { MailSettings } from "./MailSettings.js";
import { ResumeLibrary } from "./ResumeLibrary.js";
import { WorkspaceOverview } from "./WorkspaceOverview.js";
import { CareerBrowser } from "./CareerBrowser.js";
import { onWorkspaceChanged, notifyWorkspaceChanged } from "./updates.js";
import { applicationStatusLabel } from "../../shared/presentation/application-status.js";
declare const __NATIVE_CSS__: string;
type Snapshot = Extract<NativeView, { kind: "workspace" }>;

function Workbench({
  act,
  ask,
  openFile,
  Review,
  uploadResume,
  sessionId,
}: any) {
  const [data, setData] = useState<Snapshot>(),
    [tab, setTab] = useState("resumes"),
    [detail, setDetail] = useState<NativeView | null>(null),
    [resumeId, setResume] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false);
  const reload = async () => {
    const value = await act({ action: "workspace" });
    setData(value);
    setResume((id: string) =>
      value.resumes.some((r: any) => r.id === id)
        ? id
        : (value.resumes[0]?.id ?? ""),
    );
  };
  useEffect(() => {
    let live = true;
    void act({ action: "workspace" })
      .then((value: Snapshot) => {
        if (live) {
          setData(value);
          setResume(value.resumes[0]?.id ?? "");
        }
      })
      .catch((e: Error) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(
    () =>
      onWorkspaceChanged(sessionId, ({ error }) => {
        if (error) {
          if (detail?.kind !== "review") setError(error);
          return;
        }
        void reload().catch((e: Error) => setError(e.message));
      }),
    [sessionId, detail?.kind],
  );
  const run = async (operation: () => Promise<void>) => {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await operation();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败。");
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const openAction = (input: unknown) =>
    run(async () => {
      const value = await act(input);
      if (value.kind === "workspace") setData(value);
      else {
        setDetail(value);
        if (value.kind === "resume") setResume(value.resume.id);
      }
      await reload();
    });
  const navigate = (next: string) => {
    setTab(next);
    setDetail(null);
    void run(reload);
  };
  const applications = data?.applications ?? [];
  return (
    <section className="rg-native rg-workbench" aria-label="求职工作台">
      <style>{__NATIVE_CSS__}</style>
      <div className="rg-toolbar">
        <h3>求职工作台</h3>
        <button disabled={busy} onClick={() => void run(reload)}>
          刷新求职资料
        </button>
      </div>
      <nav aria-label="求职分类">
        {[
          ["overview", "总览"],
          ["resumes", "简历"],
          ["jobs", "岗位"],
          ["pending", "待确认"],
          ["history", "投递记录"],
        ].map(([key, label]) => (
          <button
            key={key}
            aria-pressed={tab === key}
            disabled={busy}
            onClick={() => navigate(key)}
          >
            {label}
            {key === "pending"
              ? ` ${applications.filter((a) => ["prepared", "simulated"].includes(a.status)).length}`
              : ""}
          </button>
        ))}
      </nav>
      {detail ? (
        <>
          <button
            disabled={busy}
            onClick={() => {
              setDetail(null);
              void run(reload);
            }}
          >
            返回清单
          </button>
          <Review
            initial={detail}
            act={async (input: any) => {
              const view = await act(input);
              if (view?.kind === "resume") setResume(view.resume.id);
              if (input.action !== "restore") void reload().catch(() => {});
              return view;
            }}
            ask={ask}
            openFile={openFile}
            sessionId={sessionId}
          />
        </>
      ) : (
        <>
          {!data && !error && <p role="status">正在读取求职资料…</p>}
          {data && tab === "overview" && (
            <WorkspaceOverview
              data={data}
              busy={busy}
              navigate={navigate}
              open={(input) => void openAction(input)}
            />
          )}
          {data && tab === "resumes" && (
            <ResumeLibrary
              data={data}
              busy={busy}
              onAction={openAction}
              openFile={openFile}
              onUpload={(file) =>
                void run(async () => {
                  const value = await uploadResume(file);
                  setData(value);
                  setResume(value.resumes[0]?.id ?? "");
                })
              }
            />
          )}
          {data && tab === "jobs" && (
            <>
              <label>
                用于核对的简历
                <select
                  aria-label="用于核对的简历"
                  value={resumeId}
                  disabled={busy}
                  onChange={(e) => setResume(e.target.value)}
                >
                  <option value="">选择简历</option>
                  {data.resumes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              <CareerBrowser
                data={data}
                busy={busy}
                resumeId={resumeId}
                onScan={(url, keywords) =>
                  void run(async () => {
                    setData(await act({ action: "scan-site", url, keywords }));
                  })
                }
                onRead={(url) =>
                  void run(async () => {
                    const value = await act({
                      action: "read-job",
                      url,
                      ...(resumeId ? { resumeId } : {}),
                    });
                    if (value.kind === "workspace") setData(value);
                    else setDetail(value);
                    await reload();
                  })
                }
              />
              {data.goals.map((goal) => (
                <article key={goal.id}>
                  <strong>
                    {goal.directions.join(" / ")} ·{" "}
                    {goal.cities.join(" / ") || "不限城市"}
                  </strong>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () =>
                        setDetail(
                          await act({ action: "goal", goalId: goal.id }),
                        ),
                      )
                    }
                  >
                    查看目标岗位
                  </button>
                </article>
              ))}
              <details open={data.scans.length === 0}>
                <summary>已保存的岗位 · {data.jobs.length}</summary>
                {data.jobs.map((job) => (
                  <article key={job.id}>
                    <strong>{job.role}</strong>
                    <p>{job.company || "公司待核对"}</p>
                    <button
                      disabled={busy || !resumeId}
                      onClick={() =>
                        void run(async () =>
                          setDetail(
                            await act({
                              action: "review",
                              resumeId,
                              jobId: job.id,
                            }),
                          ),
                        )
                      }
                    >
                      核对简历
                    </button>
                  </article>
                ))}
                {!data.jobs.length && (
                  <p>上方拉取官网或读取岗位链接后，会保存在这里。</p>
                )}
              </details>
            </>
          )}
          {data && ["pending", "history"].includes(tab) && (
            <>
              {applications
                .filter(
                  (item) =>
                    tab === "history" ||
                    ["prepared", "simulated"].includes(item.status),
                )
                .map((item) => (
                  <article key={item.id}>
                    <strong>{item.subject}</strong>
                    <p>{item.recipient}</p>
                    <small>
                      {applicationStatusLabel[item.status]} ·{" "}
                      {new Date(item.createdAt).toLocaleString()}
                    </small>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(async () =>
                          setDetail(
                            await act({ action: "application", id: item.id }),
                          ),
                        )
                      }
                    >
                      查看邮件与附件
                    </button>
                  </article>
                ))}
              {!applications.some(
                (item) =>
                  tab === "history" ||
                  ["prepared", "simulated"].includes(item.status),
              ) && (
                <p>
                  {tab === "pending"
                    ? "没有待确认的邮件。"
                    : "还没有投递记录。"}
                </p>
              )}
            </>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="rg-error">
          {error}
        </p>
      )}
    </section>
  );
}
function Entry({ useSessions, usePanelInfo, selectConversation, open }: any) {
  const sessionId = useSessions(selectedSessionId);
  const panelId = usePanelInfo((info: any) => info.activePanelId);
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const show = () => {
    try {
      open();
      setError("");
    } catch {
      setError("请先打开一个会话，再点求职。");
    }
  };
  useEffect(() => {
    if (!pending || panelId !== null || !sessionId) return;
    const frame = requestAnimationFrame(() => {
      setPending(false);
      show();
    });
    return () => cancelAnimationFrame(frame);
  }, [pending, panelId, sessionId]);
  return (
    <button
      className="rg-entry"
      title={error || (sessionId ? "打开求职工作台" : "先打开一个会话")}
      disabled={!sessionId}
      onClick={() => {
        if (panelId === null) show();
        else {
          setPending(true);
          selectConversation();
        }
      }}
    >
      求职
    </button>
  );
}
function WorkbenchPage({ useSessions, bind, lastSession, retain, enter }: any) {
  const selected = useSessions(selectedSessionId);
  const id = selected ?? lastSession();
  useEffect(() => {
    // The conversation's document dock is hidden in a global panel, but may
    // still reserve a column until its owner reports the new presentation.
    enter();
  }, []);
  useEffect(() => {
    if (!id) return;
    const reference = retain(id);
    return () => reference.release();
  }, [id]);
  const face = useMemo(() => (id ? bind(id) : null), [id, bind]);
  return face ? (
    <Workbench key={id} {...face} />
  ) : (
    <section className="rg-native">
      <h3>求职工作台</h3>
      <p>先打开一个 DSH 会话，再进入求职。无需发送消息。</p>
    </section>
  );
}
export function registerWorkbench(ctx: any, Review: any) {
  ctx.effect(() =>
    ctx.remote.$on("api-session/error", (id: string, error: string) =>
      notifyWorkspaceChanged(id, { error }),
    ),
  );
  const running = new Set<string>();
  ctx.effect(() =>
    ctx.sessions.list.subscribe(() => {
      for (const [id, entry] of Object.entries(
        ctx.sessions.list.getSnapshot().byId,
      ) as Array<[string, { running: boolean }]>) {
        if (entry.running) running.add(id);
        else if (running.delete(id)) notifyWorkspaceChanged(id);
      }
    }),
  );
  ctx.effect(() =>
    ctx.remote.$on("api-session/status", (id: string, active: boolean) => {
      if (active) running.add(id);
      else if (running.delete(id)) notifyWorkspaceChanged(id);
    }),
  );
  let lastSessionId = selectedSessionId(ctx.sessions.list.getSnapshot());
  ctx.effect(() =>
    ctx.sessions.list.subscribe(() => {
      lastSessionId =
        selectedSessionId(ctx.sessions.list.getSnapshot()) ?? lastSessionId;
    }),
  );
  const bind = (sessionId: string) => ({
    ...nativeControls(ctx, sessionId, "workbench"),
    sessionId,
    Review,
    uploadResume: async (file: File) => {
      if (
        !/\.(pdf|docx|txt|md)$/i.test(file.name) ||
        !file.size ||
        file.size > 10 * 1024 * 1024
      )
        throw new Error("请选择 10 MiB 以内的简历。");
      const result = await ctx.fileUpload.upload(sessionId, file, file.name);
      if (!result.ok) throw new Error(result.error.message);
      return nativeControls(ctx, sessionId, "workbench").act({
        action: "import-upload",
        receiptId: result.value.receiptId,
      });
    },
    openFile: (path: string) => {
      ctx.layout.selectPanel(null);
      requestAnimationFrame(() =>
        ctx.sidebarRight.openResource(
          `dsh-resource://file/session/${encodeURIComponent(sessionId)}/${path.replaceAll("\\", "/").split("/").map(encodeURIComponent).join("/")}`,
        ),
      );
    },
  });
  ctx.slots.inject("sidebar.panellist", () =>
    ctx.slots.register(
      {
        name: "sidebar.panellist",
        id: "resume-grill-workspace",
        label: () => "求职工作台",
        order: 25,
      },
      () => <span aria-hidden="true">▤</span>,
    ),
  );
  ctx.slots.inject("main", () =>
    ctx.slots.register(
      {
        name: "main",
        key: "resume-grill-workspace",
        inject: () => ({
          bind,
          lastSession: () => lastSessionId,
          enter: () => ctx.layout.closeRightbar(),
          retain: (id: string) => ctx.sessions.retainAgentScope(id),
        }),
      },
      WorkbenchPage,
    ),
  );
  const scope = ctx.configForms.get("resume-grill");
  ctx.slots.inject("settings.section", () =>
    ctx.slots.register(
      {
        name: "settings.section",
        id: "resume-grill-mail",
        order: 45,
        label: () => "求职邮箱",
        inject: () => ({
          scope,
          credentials: ctx.remote.credentials,
          testMail: (sessionId: string) =>
            nativeControls(ctx, sessionId, "workbench").act({
              action: "test-mail",
            }),
        }),
      },
      MailSettings,
    ),
  );
  ctx.effect(() =>
    ctx.sidebarRightTabs.register({
      id: "resume-grill-workbench",
      kind: "resume-grill",
      title: () => "求职",
      guide: [
        {
          order: 30,
          title: () => "求职",
          description: () => "简历、岗位、待确认邮件与投递记录",
        },
      ],
    }),
  );
  ctx.slots.inject("sidebar.right.pane.tab", () =>
    ctx.slots.register(
      {
        name: "sidebar.right.pane.tab",
        key: "resume-grill-workbench",
        inject: bind,
      },
      Workbench,
    ),
  );
  ctx.slots.inject("sidebar.footer.action", () =>
    ctx.slots.register(
      {
        name: "sidebar.footer.action",
        id: "resume-grill-entry",
        order: 20,
        inject: () => ({
          open: () => ctx.sidebarRight.openTab("resume-grill"),
          selectConversation: () => ctx.layout.selectPanel(null),
        }),
      },
      Entry,
    ),
  );
}
