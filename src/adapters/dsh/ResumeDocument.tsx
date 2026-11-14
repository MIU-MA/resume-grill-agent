import { useEditDraft } from "./use-edit-draft.js";
import type { Resume } from "../../core/workspace.js";
export function ResumeDocument({
  resume,
  busy,
  run,
  openFile,
}: {
  resume: Resume;
  busy: boolean;
  run: (input: unknown) => Promise<boolean>;
  openFile: (path: string) => void;
}) {
  const [text, setText, clear] = useEditDraft(
    `resume:${resume.id}`,
    resume.text,
  );
  return (
    <section aria-label="简历查看与编辑">
      <h3>{resume.name}</h3>
      <button
        disabled={busy}
        onClick={() => void run({ action: "profile", resumeId: resume.id })}
      >
        解析为可复用资料
      </button>
      <button
        disabled={busy}
        onClick={() => openFile(resume.pdf ?? resume.original)}
      >
        查看原文件 / PDF
      </button>
      {resume.pdf && resume.original !== resume.pdf && (
        <button onClick={() => openFile(resume.original)}>
          查看最初上传的文件
        </button>
      )}
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
        原文件保留。保存会另存文本排版的 PDF；需要核对原排版、照片时打开原文件。
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
