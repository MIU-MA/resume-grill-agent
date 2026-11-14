import { useId } from "react";
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
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (!busy && e.dataTransfer.files[0]) onUpload(e.dataTransfer.files[0]);
      }}
    >
      <p>选择简历，或将文件拖到这里</p>
      <label htmlFor={id}>选择简历文件</label>
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
      <small>PDF / DOCX / TXT / Markdown，最多 10 MiB</small>
    </div>
  );
}
