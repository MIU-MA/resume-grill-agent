import { useState } from "react";
import type { Resume, Job } from "../../service.js";
import type { Proposal } from "./api.js";
import { RevisionChanges } from "./RevisionChanges.js";
export function RevisionReview({
  resume,
  job,
  proposal,
  onSave,
  busy,
}: {
  resume?: Resume;
  job?: Job;
  proposal?: Proposal;
  onSave: (accepted: string[]) => void;
  busy: boolean;
}) {
  const [accepted, setAccepted] = useState<string[]>([]);
  if (!resume || !job)
    return (
      <div className="empty">
        <h2>先选简历和岗位</h2>
        <p>在左侧导入简历，选择要投递的岗位。修改建议会按原文逐条显示。</p>
      </div>
    );
  if (resume.parentId && resume.jobId === job.id && !proposal)
    return (
      <section>
        <span className="eyebrow">岗位专属版本</span>
        <h2>{resume.name}</h2>
        <p>这一版已保存，右侧是实际生成的 PDF。核对附件后，在下方准备邮件。</p>
        <details>
          <summary>查看本版正文</summary>
          <p className="pre">{resume.text}</p>
        </details>
      </section>
    );
  return (
    <section>
      <div className="section-heading">
        <div>
          <span className="eyebrow">根据 JD 修改</span>
          <h2>{job.role}</h2>
        </div>
        <span className="badge">
          {proposal?.plan.changes.length ?? 0} 条建议
        </span>
      </div>
      <details>
        <summary>查看岗位要求</summary>
        <p className="pre">{job.jd}</p>
      </details>
      {!proposal ? (
        <div className="empty compact">
          <h3>还没有修改建议</h3>
          <p>在对话中让助手分析这份简历和岗位，再刷新面板。</p>
        </div>
      ) : (
        <>
          <RevisionChanges
            text={resume.text}
            plan={proposal.plan}
            accepted={accepted}
            onChange={setAccepted}
            disabled={busy}
          />
          <p className="muted">
            当前新 PDF 为文本排版，不含原布局与照片。原文件会保留。
          </p>
          <button
            className="primary"
            disabled={busy}
            onClick={() => onSave(accepted)}
          >
            保存选中的修改并生成 PDF
          </button>
        </>
      )}
      <details>
        <summary>查看简历正文</summary>
        <p className="pre">{resume.text}</p>
      </details>
    </section>
  );
}
