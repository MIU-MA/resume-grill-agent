import { useState } from "react";
import type { NativeView } from "./views.js";
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
  const [link, setLink] = useState(""),
    [query, setQuery] = useState(""),
    [resumeId, setResume] = useState(view.resumes[0]?.id ?? "");
  const scan = view.scans[0];
  const [chosen, setChosen] = useState<Record<string, string>>({}),
    [ack, setAck] = useState<Record<string, boolean>>({}),
    [confirmation, setConfirmation] = useState<Record<string, string>>({});
  return (
    <section aria-label="BOSS 投递">
      <h3>BOSS 投递</h3>
      <p>
        启动网页项目的 npm run
        boss:ego，粘贴终端输出的完整工作台链接。连接码仅留在当前宿主内存，重启后重新连接。
      </p>
      <label>
        本次服务链接
        <input
          type="password"
          autoComplete="off"
          value={link}
          disabled={busy}
          onChange={(e) => setLink(e.target.value)}
        />
      </label>
      <button
        disabled={busy || !link}
        onClick={() =>
          void run({ action: "boss-link", link }).then(() => setLink(""))
        }
      >
        接入本机服务
      </button>
      <p>
        {view.connected
          ? "已接入本机服务；浏览器登录状态请在 ego 中检查。"
          : "尚未接入本机服务"}
      </p>
      {view.connected && (
        <>
          <button
            disabled={busy}
            onClick={() => void run({ action: "boss-connect" })}
          >
            连接浏览器
          </button>
          <button
            disabled={busy}
            onClick={() => void run({ action: "boss-unlink" })}
          >
            解除插件连接
          </button>
          <label>
            岗位方向
            <input
              value={query}
              disabled={busy}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <button
            disabled={busy || !query.trim()}
            onClick={() => void run({ action: "boss-search", query })}
          >
            搜索
          </button>
          <button
            disabled={busy}
            onClick={() => void run({ action: "boss-read" })}
          >
            读取当前列表
          </button>
        </>
      )}
      <label>
        用于核对的简历
        <select
          disabled={busy}
          value={resumeId}
          onChange={(e) => setResume(e.target.value)}
        >
          <option value="">选择简历</option>
          {view.resumes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      {scan && (
        <>
          <p>
            {new Date(scan.createdAt).toLocaleString()} · {scan.jobs.length}{" "}
            个岗位（当前页）
          </p>
          {scan.blocked ? (
            <p role="alert">{scan.blocked}</p>
          ) : (
            scan.jobs.map((job) => (
              <article key={job.url}>
                <h4>
                  {job.company} · {job.title}
                </h4>
                <p>{job.salary}</p>
                <p>{job.description}</p>
                <button
                  disabled={busy || !view.connected}
                  onClick={() => {
                    const action = {
                      action: "boss-detail",
                      scanId: scan.id,
                      url: job.url,
                      ...(resumeId ? { resumeId } : {}),
                    };
                    open ? open(action) : void run(action);
                  }}
                >
                  读取完整 JD{resumeId ? "并核对简历" : ""}
                </button>
              </article>
            ))
          )}
        </>
      )}
      {scan &&
        !scan.blocked &&
        scan.jobs.map((j) => {
          const job = view.jobs.find((v) => v.url === j.url);
          if (!job) return null;
          const value = chosen[job.id] ?? resumeId;
          return (
            <article key={`prepare:${job.id}`}>
              <h4>
                {j.company} · {j.title}
              </h4>
              <label>
                实际投递的简历
                <select
                  value={value}
                  disabled={busy}
                  onChange={(e) =>
                    setChosen({ ...chosen, [job.id]: e.target.value })
                  }
                >
                  <option value="">选择主简历或本岗位版本</option>
                  {view.resumes
                    .filter((r) => !r.jobId || r.jobId === job.id)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </select>
              </label>
              <button
                disabled={busy || !value || !view.connected}
                onClick={() =>
                  void run({
                    action: "boss-prepare",
                    jobId: job.id,
                    resumeId: value,
                  })
                }
              >
                生成图片并核对投递
              </button>
            </article>
          );
        })}
      {view.deliveries.map((d) => (
        <article key={d.id} aria-label="BOSS 投递核对">
          <h4>
            {d.company} · {d.role}
          </h4>
          <p>
            简历：{d.resumeName} · {d.images.length} 张图片
          </p>
          <p>首次沟通使用 BOSS 账号默认招呼，不追加自定义文字。</p>
          <p>
            状态：
            {
              {
                prepared: "待确认",
                submitting: "请求已发出，等待读回",
                running: "执行中",
                finished: "已投递并核验",
                paused: "已暂停",
                uncertain: "结果待核对，不自动重发",
              }[d.status]
            }
          </p>
          <button onClick={() => openFile(d.pdfPath)}>查看实际 PDF</button>
          {d.images.map((i, n) => (
            <button key={i.sha256} onClick={() => openFile(i.path)}>
              查看第 {n + 1} 张实际图片
            </button>
          ))}
          {d.error && <p role="alert">{d.error}</p>}
          {d.status === "prepared" ? (
            <>
              <button
                disabled={busy || !view.connected}
                onClick={() => void run({ action: "boss-preview", id: d.id })}
              >
                刷新核对有效期
              </button>
              <label>
                <input
                  type="checkbox"
                  checked={!!ack[d.digest]}
                  disabled={busy}
                  onChange={(e) =>
                    setAck({ ...ack, [d.digest]: e.target.checked })
                  }
                />
                已核对公司、岗位、默认招呼方式和全部图片
              </label>
              <label>
                输入“投递”后执行
                <input
                  value={confirmation[d.digest] ?? ""}
                  disabled={busy}
                  onChange={(e) =>
                    setConfirmation({
                      ...confirmation,
                      [d.digest]: e.target.value,
                    })
                  }
                />
              </label>
              <button
                disabled={
                  busy ||
                  !view.connected ||
                  !ack[d.digest] ||
                  confirmation[d.digest] !== "投递" ||
                  (d.expiresAt ?? 0) <= Date.now()
                }
                onClick={() =>
                  void run({
                    action: "boss-confirm",
                    id: d.id,
                    digest: d.digest,
                    acknowledged: true,
                    confirmation: "投递",
                  })
                }
              >
                确认并投递此岗位
              </button>
            </>
          ) : (
            <>
              <button
                disabled={busy || !view.connected}
                onClick={() =>
                  void run({ action: "boss-delivery-refresh", id: d.id })
                }
              >
                读取执行回执
              </button>
              {d.status === "running" && (
                <button
                  disabled={busy || !view.connected}
                  onClick={() =>
                    void run({ action: "boss-delivery-pause", id: d.id })
                  }
                >
                  完成当前步骤后暂停
                </button>
              )}
            </>
          )}
        </article>
      ))}
      {view.runs
        .filter((r) => !view.deliveries.some((d) => d.remoteId === r.id))
        .map((r) => (
          <article key={r.id}>
            <h4>批次 · {r.state}</h4>
            {r.tasks.map((t) => (
              <p key={t.url}>
                {t.company} · {t.title} · {t.state}
                {t.error ? `：${t.error}` : ""}
              </p>
            ))}
            <button
              disabled={busy || !view.connected}
              onClick={() => void run({ action: "boss-refresh", id: r.id })}
            >
              更新回执
            </button>
            {r.state === "running" && (
              <button
                disabled={busy || !view.connected}
                onClick={() => void run({ action: "boss-pause", id: r.id })}
              >
                完成当前步骤后暂停
              </button>
            )}
          </article>
        ))}
    </section>
  );
}
