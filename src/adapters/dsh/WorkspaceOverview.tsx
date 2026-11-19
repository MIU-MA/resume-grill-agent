import type { NativeView } from "./views.js";
import { applicationStatusLabel } from "../../shared/presentation/application-status.js";
import { hasCapability } from "../../shared/capabilities.js";
import { PixelIcon, type PixelIconName } from "./PixelIcon.js";
import { DsPortrait } from "./branding.js";
type Workspace = Extract<NativeView, { kind: "workspace" }>;
// The client bundle can reload before the running DSH host is restarted.
type OptionalFields = "bossDeliveries" | "capabilities";
type Snapshot = Omit<Workspace, OptionalFields> &
  Partial<Pick<Workspace, OptionalFields>>;
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
  const mailEnabled = hasCapability(data.capabilities, "mail");
  const counts: Array<[PixelIconName, string, number]> = [
    ["resumes", "简历", data.resumes.length],
    ["jobs", "已保存岗位", data.jobs.length],
  ];
  if (mailEnabled) counts.push(["pending", "待确认邮件", pending.length], ["history", "已发送", sent.length]);
  if (data.bossDeliveries) {
    const verified = data.bossDeliveries.filter((d) => d.status === "finished");
    counts.push(["boss", "BOSS 已核验", verified.length]);
  }
  return (
    <section aria-label="求职总览">
      <header className="rg-overview-banner">
        <div className="rg-overview-heading">
          <h3>求职总览</h3>
          <div className="rg-overview-actions">
            <button
              className="rg-primary"
              disabled={busy}
              onClick={() => navigate(
                !data.resumes.length ? "resumes" : data.bossDeliveries ? "boss" : "jobs",
              )}
            >
              {data.resumes.length ? "找岗位" : "去简历库"}
            </button>
            {data.resumes.length > 0 && data.bossDeliveries && (
              <button className="rg-outline" disabled={busy} onClick={() => navigate("jobs")}>
                浏览官网岗位
              </button>
            )}
          </div>
        </div>
        <div className="rg-portrait-stage">
          <DsPortrait size={216} alt="像素风 DS 娘" />
        </div>
      </header>
      <div className="rg-overview-counts">
        {counts.map(([tab, label, count]) => (
          <button
            key={tab}
            disabled={busy}
            onClick={() => navigate(tab)}
          >
            <span className="rg-count-value"><strong>{count}</strong><span className="rg-icon-tile"><PixelIcon name={tab} /></span></span>
            <span className="rg-count-label">{label}</span>
          </button>
        ))}
      </div>
      <div className="rg-overview-grid">
        <section className="rg-overview-panel">
          <header className="rg-overview-panel-header">
            <h4>最近的简历</h4>
            <button disabled={busy} onClick={() => navigate("resumes")}>
              管理简历库
            </button>
          </header>
          {data.resumes.slice(0, 4).map((r) => (
            <article className="rg-overview-row" key={r.id}>
              <div>
                <strong>{r.name}</strong>
                <p className="rg-note">
                  {r.job?.role ?? (r.parentId ? "修改副本" : "原始简历")}
                </p>
              </div>
              <button
                disabled={busy}
                onClick={() => open({ action: "resume", id: r.id })}
              >
                继续编辑
              </button>
            </article>
          ))}
          {!data.resumes.length && <p>先上传简历，或粘贴已有内容。</p>}
        </section>
        <div className="rg-overview-side">
          {mailEnabled && (
            <section className="rg-overview-panel">
              <h4>待确认邮件</h4>
              {pending.slice(0, 4).map((a) => (
                <article className="rg-overview-row" key={a.id}>
                  <div>
                    <strong>{a.subject}</strong>
                    <p className="rg-note">{a.recipient}</p>
                    <small>{applicationStatusLabel[a.status]}</small>
                  </div>
                  <button
                    disabled={busy}
                    onClick={() => open({ action: "application", id: a.id })}
                  >
                    核对邮件与附件
                  </button>
                </article>
              ))}
              {!pending.length && <p className="rg-note">没有待确认的邮件。</p>}
            </section>
          )}
          <section className="rg-overview-panel">
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
            {!data.scans.length && <p className="rg-note">还没有读取记录。</p>}
          </section>
        </div>
      </div>
    </section>
  );
}
