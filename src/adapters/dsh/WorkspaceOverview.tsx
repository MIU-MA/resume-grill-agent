import type { NativeView } from "./views.js";
import { applicationStatusLabel } from "../../shared/presentation/application-status.js";
import { hasCapability } from "../../shared/capabilities.js";
import { PixelIcon, type PixelIconName } from "./PixelIcon.js";
import { WhaleMark } from "./WhaleMark.js";
declare const __WHALE_PREVIEW__: string;
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
  const avatar = typeof __WHALE_PREVIEW__ === "string" ? __WHALE_PREVIEW__ : "";
  return (
    <section aria-label="求职总览">
      <header className="rg-section-heading rg-overview-banner">
        <div className="rg-overview-heading">
          {avatar ? (
            <a
              className="rg-whale-avatar"
              href="https://github.com/Small-tailqwq/dsh-deep-whale/blob/e74fa8439b8584ed16113920894491b5e0e1e4a0/maid-atelier/NOTICE"
              target="_blank"
              rel="noreferrer"
              aria-label="鲸鱼娘头像来源"
            >
              <img src={avatar} alt="" width={42} height={42} />
            </a>
          ) : <div className="rg-whale-avatar"><WhaleMark size={48} /></div>}
          <h3>求职总览</h3>
        </div>
        <button
          className="rg-primary"
          disabled={busy}
          onClick={() => navigate(
            !data.resumes.length ? "resumes" : data.bossDeliveries ? "boss" : "jobs",
          )}
        >
          {data.resumes.length ? "找岗位" : "去简历库"}
        </button>
      </header>
      <div className="rg-overview-counts">
        {counts.map(([tab, label, count]) => (
          <button
            key={tab}
            disabled={busy}
            onClick={() => navigate(tab)}
          >
            <span className="rg-count-value"><strong>{count}</strong><PixelIcon name={tab} /></span>
            <span className="rg-count-label">{label}</span>
          </button>
        ))}
      </div>
      <div className="rg-overview-grid" data-mail={mailEnabled}>
        <section className="rg-overview-panel">
          <h4>最近的简历</h4>
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
          <button disabled={busy} onClick={() => navigate("resumes")}>
            管理简历库
          </button>
        </section>
        {mailEnabled && (
          <section className="rg-overview-panel">
            <h4>需要处理的邮件</h4>
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
            {!pending.length && (
              <p className="rg-note">没有待确认的邮件。</p>
            )}
            <button disabled={busy} onClick={() => navigate("jobs")}>
              查找官网岗位
            </button>
          </section>
        )}
      </div>
      <section className="rg-overview-panel rg-overview-activity">
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
          <p className="rg-note">还没有读取记录。</p>
        )}
      </section>
    </section>
  );
}
