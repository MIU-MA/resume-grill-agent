import type { ReactNode } from "react";

export function JobList({ children }: { children: ReactNode }) {
  return <ul className="rg-job-list">{children}</ul>;
}

export function JobListRow({
  title,
  meta,
  action,
}: {
  title: ReactNode;
  meta?: ReactNode;
  action: ReactNode;
}) {
  return (
    <li className="rg-job-row">
      <div className="rg-job-row-main">
        <strong>{title}</strong>
        {meta && <div className="rg-note">{meta}</div>}
      </div>
      <div className="rg-job-row-action">{action}</div>
    </li>
  );
}
