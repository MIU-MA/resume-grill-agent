import { useId } from "react";
import { PixelIcon } from "./PixelIcon.js";
export function ResumeUpload({
  busy,
  onUpload,
}: {
  busy: boolean;
  onUpload: (file: File) => void;
}) {
  const id = useId();
  return (
    <div
      className="rg-upload"
      data-busy={busy}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (!busy && e.dataTransfer.files[0]) onUpload(e.dataTransfer.files[0]);
      }}
    >
      <span className="rg-icon-tile"><PixelIcon name="upload" /></span>
      <div className="rg-upload-copy">
        <strong>拖入简历</strong>
        <small>PDF、DOCX、TXT 或 Markdown · 最多 10 MiB</small>
      </div>
      <label className="rg-upload-button" htmlFor={id}>选择简历文件</label>
      <input
        id={id}
        type="file"
        accept=".pdf,.docx,.txt,.md"
        disabled={busy}
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (file) onUpload(file);
        }}
      />
    </div>
  );
}
