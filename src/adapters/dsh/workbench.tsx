import { useEffect, useMemo, useRef, useState } from "react";
import type { NativeView } from "./views.js";
import { nativeControls, selectedSessionId } from "./controls.js";
import { MailSettings } from "./MailSettings.js";
import { CapabilitySettings } from "./CapabilitySettings.js";
import { ResumeLibrary } from "./ResumeLibrary.js";
import { WorkspaceOverview } from "./WorkspaceOverview.js";
import { CareerBrowser } from "./CareerBrowser.js";
import { JobList, JobListRow } from "./JobList.js";
import { PixelIcon, type PixelIconName } from "./PixelIcon.js";
import { brandName, DsPortrait, mailSettingsName, moduleSettingsName, quickEntryName } from "./branding.js";
import { ApplicationHistory } from "./ApplicationHistory.js";
import { viewReference } from "./card-model.js";
import { onWorkspaceChanged, notifyWorkspaceChanged } from "./updates.js";
import { hasCapability } from "../../shared/capabilities.js";
import { rememberPage, rememberedPage, useWorkbenchPreference, WorkbenchSession } from "./workbench-state.js";
declare const __NATIVE_CSS__: string;
type Snapshot = Extract<NativeView, { kind: "workspace" }>;

function workbenchTabs(data?: Snapshot): Array<[PixelIconName, string]> {
  const tabs: Array<[PixelIconName, string]> = [
    ["overview", "总览"],
    ["resumes", "简历库"],
    ["jobs", "招聘官网"],
  ];
  const mail = hasCapability(data?.capabilities, "mail");
  if (data?.bossDeliveries) tabs.push(["boss", "BOSS 投递"]);
  if (mail) tabs.push(["pending", "待确认"]);
  if (mail || data?.bossDeliveries || data?.websiteSubmissions) tabs.push(["history", "投递记录"]);
  return tabs;
}

function Workbench(props: any) {
  return (
    <WorkbenchSession.Provider value={props.sessionId}>
      <WorkbenchContent key={props.sessionId} {...props} />
    </WorkbenchSession.Provider>
  );
}

function WorkbenchContent({
  act,
  ask,
  openFile,
  readResumeImage,
  Review,
  uploadResume,
  sessionId,
}: any) {
  const [data, setData] = useState<Snapshot>(),
    [detail, setDetail] = useState<NativeView | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  const [tab, setTab] = useWorkbenchPreference<string>("tab", "overview");
  const [selectedResume, setResume] = useWorkbenchPreference<string>("career-resume", "");
  const lock = useRef(true);
  const [detailKey, setDetailKey] = useState(0);
  const resumeId = data?.resumes.find((resume) => resume.id === selectedResume)?.id ??
    data?.resumes[0]?.id ?? "";
  const reload = async () => setData(await act({ action: "workspace" }));
  const openDetail = (value: NativeView | null) => {
    setDetail(value);
    rememberPage(sessionId, tab, value ? viewReference(value) : undefined);
  };
  const loadDetail = async (page: string) => {
    const reference = rememberedPage(sessionId, page);
    let message = "";
    if (reference) {
      try {
        const view: NativeView | null = await act({ action: "restore", reference });
        if (view && view.kind !== "workspace") return { view, message };
      } catch (error) {
        message = error instanceof Error ? error.message : "无法恢复上次打开的记录。";
      }
    }
    const view: NativeView | null = page === "boss" ? await act({ action: "boss" }) : null;
    return { view, message };
  };
  useEffect(() => {
    let live = true;
    void act({ action: "workspace" })
      .then(async (value: Snapshot) => {
        if (!live) return;
        const page = workbenchTabs(value).some(([key]) => key === tab) ? tab : "overview";
        const { view, message } = await loadDetail(page);
        if (!live) return;
        setTab(page);
        setDetail(view);
        setData(value);
        setError(message);
      })
      .catch((error: Error) => {
        if (live) setError(error.message);
      })
      .finally(() => {
        if (!live) return;
        lock.current = false;
        setBusy(false);
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
        openDetail(value);
        if (value.kind === "resume") setResume(value.resume.id);
      }
      await reload();
    });
  const navigate = (next: string) => {
    if (next === tab && !error) return;
    void run(async () => {
      const { view, message } = await loadDetail(next);
      setTab(next);
      setDetail(view);
      setDetailKey((key) => key + 1);
      await reload();
      if (message) setError(message);
    });
  };
  const applications = data?.applications ?? [];
  const tabs = workbenchTabs(data);
  return (
    <section className="rg-native rg-workbench" aria-label={brandName}>
      <style>{__NATIVE_CSS__}</style>
      <header className="rg-toolbar rg-workbench-header">
        <h3><DsPortrait size={36} />{brandName}</h3>
        <button className="rg-refresh" disabled={busy} onClick={() => void run(reload)}>
          <PixelIcon name="refresh" />
          刷新求职资料
        </button>
      </header>
      <nav className="rg-workbench-nav" aria-label="求职分类">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            aria-pressed={tab === key}
            disabled={busy}
            onClick={() => navigate(key)}
          >
            <PixelIcon name={key} />
            <span>{label}{key === "pending" && ` ${applications.filter((a) => ["prepared", "simulated"].includes(a.status)).length}`}</span>
          </button>
        ))}
      </nav>
      {detail ? (
        <>
          <button
            disabled={busy}
            onClick={() => void run(async () => {
              openDetail(tab === "boss" ? await act({ action: "boss" }) : null);
              setDetailKey((key) => key + 1);
              await reload();
            })}
          >
            返回清单
          </button>
          <Review
            key={`${detailKey}:${JSON.stringify(viewReference(detail))}`}
            initial={detail}
            initialIsCurrent
            act={async (input: any) => {
              const previous = JSON.stringify(rememberedPage(sessionId, tab));
              const view: NativeView | null = await act(input);
              if (view?.kind === "resume") setResume(view.resume.id);
              if (input.action !== "restore") {
                if (view && view.kind !== "workspace" &&
                    previous === JSON.stringify(rememberedPage(sessionId, tab)))
                  rememberPage(sessionId, tab, viewReference(view));
                void reload().catch(() => {});
              }
              return view;
            }}
            ask={ask}
            openFile={openFile}
            readResumeImage={readResumeImage}
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
                  const importedId =
                    value.importedResumeId ?? value.resumes[0]?.id;
                  setResume(importedId ?? "");
                  if (
                    importedId &&
                    hasCapability(value.capabilities, "website")
                  )
                    openDetail(await act({ action: "profile", resumeId: importedId }));
                })
              }
            />
          )}
          {data && tab === "jobs" && (
            <>
              <label className="rg-career-resume">
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
                    else openDetail(value);
                    await reload();
                  })
                }
              />
              <section className="rg-boss-results" aria-label="已保存的岗位">
                <h4>已保存的岗位 <small>{data.jobs.length} 个</small></h4>
                {data.jobs.length ? <JobList>{data.jobs.map((job) => (
                  <JobListRow key={job.id} title={job.role}
                    meta={job.company || "公司待核对"}
                    action={<button
                      disabled={busy || !resumeId}
                      onClick={() =>
                        void run(async () =>
                          openDetail(
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
                    </button>}
                  />
                ))}</JobList> : (
                  <p className="rg-note">还没有保存的岗位。</p>
                )}
              </section>
            </>
          )}
          {data && ["pending", "history"].includes(tab) && (
            <ApplicationHistory key={tab} data={data} pending={tab === "pending"} busy={busy}
              open={(input) => void openAction(input)}
              save={(input) => run(async () => setData(await act(input)))} />
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
      title={error || (sessionId ? `打开 ${brandName} 侧栏` : "先打开一个会话")}
      disabled={!sessionId}
      onClick={() => {
        if (panelId === null) show();
        else {
          setPending(true);
          selectConversation();
        }
      }}
    >
      {quickEntryName}
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
    <section className="rg-native" aria-label={brandName}>
      <style>{__NATIVE_CSS__}</style>
      <h3>{brandName}</h3>
      <p>先打开一个 DSH 会话即可使用。</p>
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
        label: () => brandName,
        order: 25,
      },
      () => <DsPortrait size={18} />,
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
        id: "resume-grill-modules",
        order: 44,
        label: () => moduleSettingsName,
        inject: () => ({ scope }),
      },
      CapabilitySettings,
    ),
  );
  ctx.slots.inject("settings.section", () =>
    ctx.slots.register(
      {
        name: "settings.section",
        id: "resume-grill-mail",
        order: 45,
        label: () => mailSettingsName,
        inject: () => ({
          scope,
          credentials: ctx.remote.credentials,
          capabilityStatus: (sessionId: string) =>
            nativeControls(ctx, sessionId, "workbench").act({
              action: "capability-status",
            }),
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
      title: () => brandName,
      guide: [
        {
          order: 30,
          title: () => brandName,
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
