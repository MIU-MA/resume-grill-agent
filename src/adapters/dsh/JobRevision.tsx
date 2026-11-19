import { useEditDraft } from "./use-edit-draft.js";
import type { NativeView } from "./views.js";
import { isBossSource } from "../../domain/boss.js";
export function JobRevision({
  view,
  busy,
  run,
}: {
  view: Extract<NativeView, { kind: "review" }>;
  busy: boolean;
  run: (input: unknown) => Promise<boolean>;
}) {
  const [jd, setJd, clearJd] = useEditDraft(`jd:${view.jobId}`, view.job.jd);
  const [text, setText, clearText] = useEditDraft(
    `job-resume:${view.jobId}:${view.resumeId}`,
    view.sourceText,
  );
  return (
    <div className="rg-revision-grid">
      <section>
        <h4>岗位要求</h4>
        <a href={view.job.sourceUrl} target="_blank" rel="noreferrer">
          {isBossSource(view.job.sourceUrl) ? "打开 BOSS 岗位 ↗" : "打开官网手动申请 ↗"}
        </a>
        <textarea
          aria-label="岗位 JD"
          rows={14}
          value={jd}
          onChange={(e) => setJd(e.target.value)}
          disabled={busy}
        />
        <button
          disabled={busy || jd === view.job.jd || !jd.trim()}
          onClick={() =>
            void run({
              action: "update-jd",
              id: view.jobId,
              resumeId: view.resumeId,
              jd,
            }).then((saved) => {
              if (saved) clearJd();
            })
          }
        >
          更新 JD，重新匹配
        </button>
      </section>
      <section>
        <h4>当前简历</h4>
        <textarea
          aria-label="岗位版简历正文"
          rows={14}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={busy}
        />
        <button
          disabled={busy || text === view.sourceText || !text.trim()}
          onClick={() =>
            void run({
              action: "save-resume",
              resumeId: view.resumeId,
              jobId: view.jobId,
              text,
            }).then((saved) => {
              if (saved) clearText();
            })
          }
        >
          保存手动修改
        </button>
      </section>
    </div>
  );
}
