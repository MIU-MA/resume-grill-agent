import type { ReactNode } from "react";
import { PixelIcon, type PixelIconName } from "./PixelIcon.js";

export function JobList({ children }: { children: ReactNode }) {
  return <ul className="rg-job-list">{children}</ul>;
}

export function JobListRow({
  title,
  meta,
  action,
  icon = "jobs",
}: {
  title: ReactNode;
  meta?: ReactNode;
  action: ReactNode;
  icon?: PixelIconName;
}) {
  return (
    <li className="rg-job-row">
      <span className="rg-icon-tile"><PixelIcon name={icon} /></span>
      <div className="rg-job-row-main">
        <strong>{title}</strong>
        {meta && <div className="rg-note">{meta}</div>}
      </div>
      <div className="rg-job-row-action">{action}</div>
    </li>
  );
}
