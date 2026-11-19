import type { ReactNode } from "react";
import { PixelIcon, type PixelIconName } from "./PixelIcon.js";

export function WorkbenchHeading({ icon, title, meta, action }: {
  icon: PixelIconName;
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="rg-section-heading rg-page-heading">
      <div className="rg-page-title">
        <span className="rg-icon-tile"><PixelIcon name={icon} /></span>
        <h3>{title}</h3>
        {meta && <span className="rg-note">{meta}</span>}
      </div>
      {action}
    </header>
  );
}
