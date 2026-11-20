import type { TailoringPlan } from "../../domain/resume-tailoring.js";
import {
  tailoringSections,
  tailoringChangeKey,
} from "../../domain/resume-tailoring.js";

export function RevisionChanges({
  text,
  plan,
  accepted,
  onChange,
  disabled = false,
}: {
  text: string;
  plan: TailoringPlan;
  accepted: string[];
  onChange: (accepted: string[]) => void;
  disabled?: boolean;
}) {
  const sections = tailoringSections(text);
  return (
    <>
      {!!plan.notices?.length && (
        <aside>
          <h3>修改建议待核对</h3>
          {plan.notices.map((notice) => <p key={notice}>{notice}</p>)}
        </aside>
      )}
      {plan.changes.map((change) => {
        const key = tailoringChangeKey(change);
        return (
          <article className="change" key={key}>
            <label className="check">
              <input
                type="checkbox"
                disabled={disabled}
                checked={accepted.includes(key)}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...accepted, key]
                      : accepted.filter((id) => id !== key),
                  )
                }
              />
              接受这条修改
            </label>
            <div className="diff">
              <div>
                <small>原文</small>
                <p>
                  {
                    sections.find((s) => s.id === change.sectionId)?.lines[
                      change.lineIndex
                    ]
                  }
                </p>
              </div>
              <div>
                <small>修改后</small>
                <p>{change.after}</p>
              </div>
            </div>
            <p className="muted">{change.reason}</p>
            <details>
              <summary>{change.requirementQuote ? "对应岗位要求" : "岗位要求摘要 · 待核对"}</summary>
              <p>{change.requirement}</p>
              {change.requirementQuote && <blockquote>{change.requirementQuote}</blockquote>}
            </details>
          </article>
        );
      })}
      {!plan.changes.length && (
        <p>没有可直接采用的修改，可以保留原文生成岗位版。</p>
      )}
      {plan.gaps.length > 0 && (
        <aside>
          <h3>需要你补充的事实</h3>
          {plan.gaps.map((gap, i) => (
            <p key={i}>{gap}</p>
          ))}
        </aside>
      )}
    </>
  );
}
