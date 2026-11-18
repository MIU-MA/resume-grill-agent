import type { NativeView } from "./views.js";
import { applicationStatusLabel } from "../../shared/presentation/application-status.js";
type Snapshot = Extract<NativeView, { kind: "workspace" }>;
export function WorkspaceOverview({
  data,
  busy,
  navigate,
  open,
}: {
  data: Snapshot;
  busy: boolean;
  navigate: (tab: string) => void;
  open: (action: unknown) => void;
}) {
  const pending = data.applications.filter((a) =>
    ["prepared", "simulated"].includes(a.status),
  );
  const sent = data.applications.filter((a) => a.status === "sent");
  return (
    <section aria-label="求职总览">
      <h3>最近在做什么</h3>
      <div className="rg-overview-counts">
        {[
          ["resumes", "简历", data.resumes.length],
          ["jobs", "已保存岗位", data.jobs.length],
          ["pending", "待确认邮件", pending.length],
          ["history", "已发送", sent.length],
          [
            "boss",
            "BOSS 已核验",
            data.bossDeliveries.filter((d) => d.status === "finished").length,
          ],
        ].map(([tab, label, count]) => (
          <button
            key={tab}
            disabled={busy}
            onClick={() => navigate(String(tab))}
          >
            <strong>{count}</strong>
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="rg-overview-grid">
        <section>
          <h4>最近的简历</h4>
          {data.resumes.slice(0, 4).map((r) => (
            <article key={r.id}>
              <strong>{r.name}</strong>
              <p className="rg-note">
                {r.job?.role ?? (r.parentId ? "修改副本" : "原始简历")}
              </p>
              <button
                disabled={busy}
                onClick={() => open({ action: "resume", id: r.id })}
              >
                继续编辑
              </button>
            </article>
          ))}
          {!data.resumes.length && <p>先上传简历，或粘贴已有内容。</p>}
          <button disabled={busy} onClick={() => navigate("resumes")}>
            管理简历库
          </button>
        </section>
        <section>
          <h4>需要处理的邮件</h4>
          {pending.slice(0, 4).map((a) => (
            <article key={a.id}>
              <strong>{a.subject}</strong>
              <p>{a.recipient}</p>
              <small>{applicationStatusLabel[a.status]}</small>
              <button
                disabled={busy}
                onClick={() => open({ action: "application", id: a.id })}
              >
                核对邮件与附件
              </button>
            </article>
          ))}
          {!pending.length && (
            <p>没有待确认的邮件。官网申请也可以只准备简历。</p>
          )}
          <button disabled={busy} onClick={() => navigate("jobs")}>
            查找官网岗位
          </button>
        </section>
      </div>
      <section>
        <h4>最近的官网读取</h4>
        {data.scans.slice(0, 4).map((scan) => (
          <article key={scan.id}>
            <strong>
              {data.sites.find((s) => s.url === scan.url)?.company ?? scan.url}
            </strong>
            <p className="rg-note">
              {new Date(scan.fetchedAt).toLocaleString()} ·{" "}
              {scan.error ??
                `${scan.result?.links.filter((l) => l.kind === "job").length ?? 0} 个岗位链接`}
            </p>
          </article>
        ))}
        {!data.scans.length && (
          <p>还没有读取记录。进入岗位页后可实时拉取官网。</p>
        )}
      </section>
    </section>
  );
}
