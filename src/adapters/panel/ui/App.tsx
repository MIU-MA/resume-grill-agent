import { useEffect, useRef, useState } from "react";
import { api, type Snapshot } from "./api.js";
import { ResumeLibrary } from "./ResumeLibrary.js";
import { JobEditor } from "./JobEditor.js";
import { RevisionReview } from "./RevisionReview.js";
import { ApplicationPanel, statusLabel } from "./ApplicationPanel.js";
import { PdfPreview } from "./PdfPreview.js";
import { GoalWorkbench } from "./GoalWorkbench.js";
import type { Application, Job, Resume } from "../../../core/workspace.js";
const empty: Snapshot = {
  resumes: [],
  jobs: [],
  applications: [],
  proposals: [],
  sendingEnabled: false,
  goals: [],
  searches: [],
  batches: [],
  goalCandidates: {},
};
export function App() {
  const [data, setData] = useState(empty),
    [resumeId, setResume] = useState(""),
    [jobId, setJob] = useState(""),
    [applicationId, setApplication] = useState(""),
    [tab, setTab] = useState("prepare"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const lock = useRef(false);
  const refresh = async () => {
    const result = await api<Snapshot>("workspace");
    setData(result);
    return result;
  };
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败。");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  useEffect(() => {
    void run(async () => {
      const token = location.hash.slice(1);
      if (token) {
        await api("session", { token });
        history.replaceState(null, "", location.pathname);
      }
      await refresh();
    });
  }, []);
  const resume = data.resumes.find((r) => r.id === resumeId),
    job = data.jobs.find((j) => j.id === jobId);
  const proposal = data.proposals.find(
    (p) => p.resumeId === resumeId && p.jobId === jobId,
  );
  const application = data.applications.find((a) => a.id === applicationId);
  const chooseResume = (id: string) => {
    setResume(id);
    setApplication("");
  };
  const chooseJob = (id: string) => {
    setJob(id);
    setApplication("");
  };
  const showApplication = (item: Application) => {
    setResume(item.resumeId);
    setJob(item.jobId);
    setApplication(item.id);
    setTab("prepare");
  };
  return (
    <div className="app">
      <header>
        <div className="brand-mark">RG</div>
        <strong>Resume Grill</strong>
        <span className="header-caption">求职操作台</span>
        <span className="local-state">本机 · SQLite</span>
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await refresh();
              setNotice("已更新");
            })
          }
        >
          刷新
        </button>
      </header>
      <nav className="navigation">
        <button
          className={tab === "goals" ? "active" : ""}
          onClick={() => setTab("goals")}
        >
          求职任务
        </button>
        <button
          className={tab === "prepare" ? "active" : ""}
          onClick={() => setTab("prepare")}
        >
          准备投递
        </button>
        <button
          className={tab === "history" ? "active" : ""}
          onClick={() => setTab("history")}
        >
          投递记录 <small>{data.applications.length}</small>
        </button>
      </nav>
      <div className="feedback" aria-live="polite">
        {busy ? (
          "正在处理…"
        ) : error ? (
          <span role="alert">{error}</span>
        ) : (
          notice || "修改、附件与实际投递记录保存在同一资料库。"
        )}
      </div>
      {tab === "goals" ? (
        <GoalWorkbench
          data={data}
          busy={busy}
          onRun={run}
          onRefresh={refresh}
          onOpen={(id) => {
            const item = data.applications.find((a) => a.id === id);
            if (item) showApplication(item);
          }}
        />
      ) : tab === "history" ? (
        <main className="history">
          <h1>投递记录</h1>
          <p className="muted">保留每次投递实际使用的岗位版本与附件。</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>岗位</th>
                  <th>收件人</th>
                  <th>状态</th>
                  <th>创建时间</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.applications.map((item) => (
                  <tr key={item.id}>
                    <td>
                      {data.jobs.find((j) => j.id === item.jobId)?.role ??
                        "岗位"}
                      <small>
                        {data.jobs.find((j) => j.id === item.jobId)?.company}
                      </small>
                    </td>
                    <td>{item.recipient}</td>
                    <td>
                      <span className="badge" data-status={item.status}>
                        {statusLabel[item.status]}
                      </span>
                    </td>
                    <td>{new Date(item.createdAt).toLocaleString()}</td>
                    <td>
                      <button onClick={() => showApplication(item)}>
                        查看详情
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.applications.length && (
              <p className="empty">还没有投递记录。</p>
            )}
          </div>
        </main>
      ) : (
        <main className="workspace">
          <aside className="library">
            <ResumeLibrary
              items={data.resumes}
              selected={resumeId}
              onSelect={chooseResume}
              busy={busy}
              onImport={(file) =>
                void run(async () => {
                  if (file.size > 10 * 1024 * 1024)
                    throw new Error("文件超过 10 MiB。");
                  const bytes = new Uint8Array(await file.arrayBuffer());
                  let binary = "";
                  for (let i = 0; i < bytes.length; i += 8192)
                    binary += String.fromCharCode(
                      ...bytes.subarray(i, i + 8192),
                    );
                  const result = await api<Resume>("import", {
                    name: file.name,
                    base64: btoa(binary),
                  });
                  await refresh();
                  chooseResume(result.id);
                  setNotice("简历已导入");
                })
              }
            />
            <JobEditor
              items={data.jobs}
              selected={jobId}
              onSelect={chooseJob}
              busy={busy}
              onSave={async (input) => {
                await run(async () => {
                  const result = await api<Job>("jobs", input);
                  await refresh();
                  chooseJob(result.id);
                });
              }}
            />
          </aside>
          <div className="review">
            <RevisionReview
              key={proposal?.id ?? `${resumeId}:${jobId}`}
              resume={resume}
              job={job}
              proposal={proposal}
              busy={busy}
              onSave={(accepted) =>
                void run(async () => {
                  const result = await api<Resume>("version", {
                    resumeId,
                    jobId,
                    plan: proposal!.plan,
                    accepted,
                  });
                  await refresh();
                  chooseResume(result.id);
                  setNotice("岗位版已保存，请先核对 PDF，再准备投递。");
                })
              }
            />
            {resume?.pdf && (
              <ApplicationPanel
                key={`${resumeId}:${jobId}:${applicationId}`}
                job={job}
                resume={resume}
                application={application}
                enabled={data.sendingEnabled}
                busy={busy}
                onPrepare={async (input) => {
                  await run(async () => {
                    const result = await api<Application>("prepare", {
                      jobId,
                      resumeId,
                      ...input,
                    });
                    await refresh();
                    setApplication(result.id);
                  });
                }}
                onCheck={() =>
                  void run(async () => {
                    await api("check", { id: application!.id });
                    await refresh();
                    setNotice("附件检查通过，没有发送邮件。");
                  })
                }
                onSend={() =>
                  void run(async () => {
                    const result = await api<Application>("send", {
                      id: application!.id,
                      digest: application!.digest,
                      acknowledged: true,
                      confirmation: "发送",
                    });
                    await refresh();
                    setNotice(
                      result.status === "sent"
                        ? "发件邮箱服务已接受邮件。"
                        : "结果待核对，不会自动重发。",
                    );
                  })
                }
              />
            )}
          </div>
          <aside className="preview">
            <div className="section-heading">
              <h2>附件预览</h2>
              {resume?.pdf && (
                <a
                  href={`/api/pdf/${resume.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  单独打开 ↗
                </a>
              )}
            </div>
            {resume?.pdf ? (
              <PdfPreview id={resume.id} />
            ) : (
              <div className="paper-placeholder">
                <span>PDF</span>
                <p>生成岗位版后，在这里核对实际附件。</p>
              </div>
            )}
          </aside>
        </main>
      )}
      <footer>本机操作面板 · 不会自动发送 · SMTP 授权码不会提供给浏览器</footer>
    </div>
  );
}
