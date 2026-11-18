import { useState } from "react";
import type { NativeView } from "./views.js";
import { JobList, JobListRow } from "./JobList.js";
type Snapshot = Extract<NativeView, { kind: "workspace" }>;
export function CareerBrowser({
  data,
  busy,
  resumeId,
  onScan,
  onRead,
}: {
  data: Snapshot;
  busy: boolean;
  resumeId: string;
  onScan: (url: string, keywords: string[]) => void;
  onRead: (url: string) => void;
}) {
  const [url, setUrl] = useState(
      () =>
        data.sites.find((s) => s.company === "腾讯")?.url ??
        data.sites[0]?.url ??
        "",
    ),
    [keywords, setKeywords] = useState(""),
    [jobUrl, setJobUrl] = useState("");
  const scan = data.scans.find((item) => item.url === url);
  const jobs = [...new Map([
    ...(scan?.result?.links.filter((link) => link.kind === "job") ?? []).map(
      (link) => [link.url, { url: link.url, label: link.label }] as const,
    ),
    ...(scan?.result?.pages ?? []).filter((page) => page.role).map(
      (page) => [page.url, { url: page.url, label: page.role }] as const,
    ),
  ]).values()];
  return (
    <section className="rg-career-panel" aria-label="招聘官网实时岗位">
      <h3>招聘官网</h3>
      <div className="rg-career-filters">
        <label>
          招聘来源
          <select
            aria-label="招聘来源"
            value={url}
            disabled={busy}
            onChange={(e) => setUrl(e.target.value)}
          >
            {data.sites.map((site) => (
              <option key={site.url} value={site.url}>
                {site.company}
              </option>
            ))}
          </select>
        </label>
        <label>
          岗位关键词
          <input
            aria-label="官网岗位关键词"
            value={keywords}
            disabled={busy}
            placeholder="可留空查看官网当前列表"
            onChange={(e) => setKeywords(e.target.value)}
          />
        </label>
        <button
          className="rg-primary"
          disabled={busy || !url}
          onClick={() => onScan(url, keywords.trim() ? [keywords.trim()] : [])}
        >
          {busy ? "正在拉取官网…" : "实时拉取岗位"}
        </button>
      </div>
      <form className="rg-job-url" onSubmit={(e) => {
        e.preventDefault();
        if (!busy && jobUrl.trim()) onRead(jobUrl.trim());
      }}>
        <label>
          或粘贴具体岗位链接
          <input aria-label="具体岗位链接" type="url" value={jobUrl}
            disabled={busy} placeholder="https://…"
            onChange={(e) => setJobUrl(e.target.value)} />
        </label>
        <button disabled={busy || !jobUrl.trim()} type="submit">读取岗位 JD</button>
      </form>
      {scan && (
        <>
          <p className="rg-note">
            读取时间：{new Date(scan.fetchedAt).toLocaleString()} ·{" "}
            {scan.result?.pagesRead ?? 0} 个页面
          </p>
          {scan.error && <p role="alert">{scan.error}</p>}
          {scan.result?.notes.map((note, index) => (
            <p key={index} className="rg-note">
              {note}
            </p>
          ))}
          <JobList>
            {jobs
              .map((link) => (
                <JobListRow key={link.url} title={link.label}
                  meta={<a href={link.url} target="_blank" rel="noreferrer">官网 ↗</a>}
                  action={<button disabled={busy} onClick={() => onRead(link.url)}>
                    {resumeId ? "核对简历" : "查看岗位"}
                  </button>}
                />
              ))}
          </JobList>
          {!scan.error &&
            !jobs.length && (
              <p>这次没有读取到具体岗位，原因见上方；可以换来源或粘贴 JD。</p>
            )}
        </>
      )}
    </section>
  );
}
