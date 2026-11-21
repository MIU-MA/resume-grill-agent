import { useEditDraft } from "./use-edit-draft.js";
import type { Resume } from "../../core/workspace.js";
export function ResumeDocument({
  resume,
  busy,
  run,
  openFile,
  canParseProfile,
}: {
  resume: Resume;
  busy: boolean;
  run: (input: unknown) => Promise<boolean>;
  openFile: (path: string) => void;
  canParseProfile: boolean;
}) {
  const [text, setText, clear] = useEditDraft(
    `resume:${resume.id}`,
    resume.text,
  );
  return (
    <section aria-label="简历查看与编辑">
      <h3>{resume.name}</h3>
      {canParseProfile && (
        <button
          disabled={busy}
          onClick={() => void run({ action: "profile", resumeId: resume.id })}
        >
          解析为可复用资料
        </button>
      )}
      <button
        disabled={busy}
        onClick={() => openFile(resume.pdf ?? resume.original)}
      >
        {resume.pdf ? "查看本版 PDF" : "查看原文件"}
      </button>
      {resume.pdf && resume.original !== resume.pdf && (
        <button onClick={() => openFile(resume.original)}>
          查看最初上传的文件
        </button>
      )}
      {resume.headerPhoto && <p className="rg-note" role="status">
        {resume.headerPhoto === "copied" ? "本版已带入原 PDF 的页首照片。" : "原 PDF 里没有识别出可单独带入的页首照片。"}
      </p>}
      <label>
        简历正文
        <textarea
          aria-label="简历正文"
          rows={Math.min(22, Math.max(10, text.split("\n").length + 2))}
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <p className="rg-note">
        修改会另存为单栏 PDF，识别到的原 PDF 页首照片会一起带入。
      </p>
      <button
        disabled={busy || text === resume.text || !text.trim()}
        onClick={() =>
          void run({
            action: "save-resume",
            resumeId: resume.id,
            text,
            jobId: resume.jobId,
          }).then((saved) => {
            if (saved) clear();
          })
        }
      >
        保存修改副本
      </button>
    </section>
  );
}
