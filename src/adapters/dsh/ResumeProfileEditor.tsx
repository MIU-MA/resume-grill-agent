import type { NativeView } from "./views.js";
import {
  CONTACT_LABELS,
  EXPERIENCE_LABELS,
  experienceKinds,
  experienceLimit,
  type ResumeProfileData,
  type ContactKey,
} from "../../domain/resume-profile.js";
import { useEditDraft } from "./use-edit-draft.js";

export function ResumeProfileEditor({
  view,
  busy,
  run,
}: {
  view: Extract<NativeView, { kind: "profile" }>;
  busy: boolean;
  run: (value: unknown) => Promise<boolean>;
}) {
  const [raw, setRaw, clear] = useEditDraft(
    `profile:${view.profile.id}`,
    JSON.stringify(view.profile.data),
  );
  let data: ResumeProfileData = view.profile.data;
  try {
    const value = JSON.parse(raw);
    if (value.contact && Array.isArray(value.experiences)) data = value;
  } catch {}
  const update = (next: ResumeProfileData) => setRaw(JSON.stringify(next));
  const editExperience = (index: number, key: string, value: string) =>
    update({
      ...data,
      experiences: data.experiences.map((item, i) =>
        i === index ? { ...item, [key]: value } : item,
      ),
    });
  const dirty = JSON.stringify(data) !== JSON.stringify(view.profile.data);
  return (
    <section aria-label="可复用的简历资料">
      <h3>{view.resume.name} · 可复用资料</h3>
      <p>
        从简历原文解析，先核对再用于不同官网。没有依据的字段留空；这里的补充不会改写原简历。
      </p>
      <p role="status">
        {view.profile.confirmedAt
          ? dirty
            ? "有未保存的修改。官网仍使用上次确认的资料。"
            : "资料已确认，可在不同岗位重复使用。"
          : "解析草稿，尚未确认。请核对内容和经历分类。"}
      </p>
      {view.profile.sourcePages && <p>已读取 PDF 共 {view.profile.sourcePages} 页。</p>}
      <button disabled={busy || dirty} onClick={() => void run({
        action: "profile", resumeId: view.resume.id, reparse: true,
        ...(view.jobId ? { jobId: view.jobId } : {}),
        ...(view.goalId ? { goalId: view.goalId } : {}),
      })}>重新解析原文</button>
      <div className="rg-profile-grid">
        {(Object.keys(CONTACT_LABELS) as ContactKey[]).map((key) => (
          <label key={key}>
            {CONTACT_LABELS[key]}
            <input
              aria-label={`资料-${CONTACT_LABELS[key]}`}
              value={data.contact[key]}
              disabled={busy}
              onChange={(e) =>
                update({
                  ...data,
                  contact: { ...data.contact, [key]: e.target.value },
                })
              }
            />
            {data.contactEvidence[key] && (
              <small>原文：{data.contactEvidence[key]}</small>
            )}
          </label>
        ))}
      </div>
      {experienceKinds.map((kind) => (
        <section key={kind}>
          <h4>{EXPERIENCE_LABELS[kind].section}</h4>
          {data.experiences.map((item, index) =>
            item.kind === kind ? (
              <article key={item.id}>
                <div className="rg-profile-grid">
                  <label>
                    {EXPERIENCE_LABELS[kind].organization}
                    <input
                      value={item.organization}
                      disabled={busy}
                      onChange={(e) =>
                        editExperience(index, "organization", e.target.value)
                      }
                    />
                  </label>
                  <label>
                    {EXPERIENCE_LABELS[kind].title}
                    <input
                      value={item.title}
                      disabled={busy}
                      onChange={(e) =>
                        editExperience(index, "title", e.target.value)
                      }
                    />
                  </label>
                  {kind === "education" && (
                    <label>
                      学历
                      <input
                        value={item.degree}
                        disabled={busy}
                        onChange={(e) =>
                          editExperience(index, "degree", e.target.value)
                        }
                      />
                    </label>
                  )}
                  {kind === "competition" && (
                    <label>
                      奖项 / 名次
                      <input value={item.award ?? ""} disabled={busy}
                        onChange={(e) => editExperience(index, "award", e.target.value)} />
                    </label>
                  )}
                  <label>
                    开始时间
                    <input
                      value={item.start}
                      placeholder="YYYY-MM"
                      disabled={busy}
                      onChange={(e) =>
                        editExperience(index, "start", e.target.value)
                      }
                    />
                  </label>
                  <label>
                    结束时间
                    <input
                      value={item.end}
                      placeholder="YYYY-MM / 至今"
                      disabled={busy}
                      onChange={(e) =>
                        editExperience(index, "end", e.target.value)
                      }
                    />
                  </label>
                  {kind === "education" && (
                    <label>
                      预计毕业时间
                      <input
                        value={item.expectedEnd}
                        placeholder="仅在有明确日期时填写"
                        disabled={busy}
                        onChange={(e) =>
                          editExperience(index, "expectedEnd", e.target.value)
                        }
                      />
                    </label>
                  )}
                </div>
                <label>
                  经历内容
                  <textarea
                    rows={5}
                    value={item.description}
                    disabled={busy}
                    onChange={(e) =>
                      editExperience(index, "description", e.target.value)
                    }
                  />
                </label>
                <details>
                  <summary>查看这段经历的原文</summary>
                  <p className="rg-pre">
                    {item.evidence || "用户补充，原简历没有这段。"}
                  </p>
                </details>
                <button
                  disabled={busy}
                  onClick={() =>
                    update({
                      ...data,
                      experiences: data.experiences.filter(
                        (_, i) => i !== index,
                      ),
                    })
                  }
                >
                  移除这段
                </button>
              </article>
            ) : null,
          )}
          {!data.experiences.some((e) => e.kind === kind) && (
            <p className="rg-note">
              没有解析出这类经历，可自行补充。
            </p>
          )}
          <button
            disabled={busy || data.experiences.length >= experienceLimit}
            onClick={() =>
              update({
                ...data,
                experiences: [
                  ...data.experiences,
                  {
                    id: crypto.randomUUID(),
                    kind,
                    organization: "",
                    title: "",
                    degree: "",
                    start: "",
                    end: "",
                    expectedEnd: "",
                    description: "",
                    evidence: "",
                  },
                ],
              })
            }
          >
            添加{EXPERIENCE_LABELS[kind].section}
          </button>
        </section>
      ))}
      <button
        disabled={busy || (!dirty && Boolean(view.profile.confirmedAt))}
        onClick={() =>
          void run({
            action: "confirm-profile",
            id: view.profile.id,
            data,
            jobId: view.jobId,
            ...(view.goalId ? { goalId: view.goalId } : {}),
          }).then((saved) => {
            if (saved) clear();
          })
        }
      >
        确认并保存资料
      </button>
      {view.jobId && view.profile.confirmedAt && !dirty && (
        <button
          disabled={busy}
          onClick={() =>
            void run({
              action: "review",
              resumeId: view.resume.id,
              jobId: view.jobId,
              ...(view.goalId ? { goalId: view.goalId } : {}),
            })
          }
        >
          回到当前岗位
        </button>
      )}
    </section>
  );
}
