import { useState } from "react";
import type { NativeView } from "./views.js";
import { ResumeUpload } from "./ResumeUpload.js";
import { useEditDraft } from "./use-edit-draft.js";

type Snapshot = Extract<NativeView, { kind: "workspace" }>;
export function ResumeLibrary({
  data,
  busy,
  onAction,
  onUpload,
  openFile,
}: {
  data: Snapshot;
  busy: boolean;
  onAction: (input: unknown) => Promise<boolean>;
  onUpload: (file: File) => void;
  openFile: (path: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState("");
  const [name, setName] = useState("");
  const [removed, setRemoved] = useState<{ id: string; name: string }>();
  const [newName, setNewName, clearName] = useEditDraft(
    "new-resume-name",
    "我的简历",
  );
  const [text, setText, clearText] = useEditDraft("new-resume-text", "");
  const trash = filter === "trash";
  const deletedResumes = data.deletedResumes ?? [];
  const rows = (trash ? deletedResumes : data.resumes).filter((item) => {
    const content = [item.name, item.summary, item.job?.company, item.job?.role]
      .join(" ")
      .toLowerCase();
    return (
      content.includes(query.trim().toLowerCase()) &&
      (filter !== "originals" || !item.parentId) &&
      (filter !== "versions" || Boolean(item.parentId))
    );
  });
  return (
    <section aria-label="简历库">
      <div className="rg-section-heading">
        <div>
          <h3>简历库</h3>
          <p className="rg-note">
            {data.resumes.length} 份简历 · 原件与岗位版本分别保留
          </p>
        </div>
        <button className={creating ? undefined : "rg-primary"} disabled={busy} onClick={() => setCreating(!creating)}>
          {creating ? "收起新建" : "新建简历"}
        </button>
      </div>
      <ResumeUpload busy={busy} onUpload={onUpload} />
      {creating && (
        <form
          className="rg-library-create"
          aria-label="新建简历"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy && newName.trim() && text.trim())
              void onAction({
                action: "create-resume",
                name: newName,
                text,
              }).then((saved) => {
                if (saved) {
                  clearName();
                  clearText();
                  setCreating(false);
                }
              });
          }}
        >
          <label>
            名称
            <input
              aria-label="新简历名称"
              value={newName}
              maxLength={160}
              disabled={busy}
              onChange={(e) => setNewName(e.target.value)}
            />
          </label>
          <label>
            简历内容
            <textarea
              aria-label="新简历内容"
              rows={10}
              value={text}
              maxLength={30000}
              disabled={busy}
              placeholder={
                "可以直接粘贴已有简历的内容。\n建议包含：个人信息、教育经历、工作或项目经历、技能。"
              }
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <p className="rg-note">
            有原文件时优先上传。这里适合从已有文字整理简历，保存为新的 PDF。
          </p>
          <button
            disabled={busy || !newName.trim() || !text.trim()}
            type="submit"
          >
            保存新简历
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setCreating(false)}
          >
            暂不新建
          </button>
        </form>
      )}
      <div className="rg-library-filters">
        <label>
          查找简历
          <input
            aria-label="查找简历"
            type="search"
            placeholder="名称、岗位或内容摘要"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label>
          范围
          <select
            aria-label="简历范围"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setRenaming("");
            }}
          >
            <option value="all">全部简历</option>
            <option value="originals">原始简历</option>
            <option value="versions">派生版本</option>
            <option value="trash">
              回收站（{deletedResumes.length}）
            </option>
          </select>
        </label>
      </div>
      {removed && (
        <p role="status">
          “{removed.name}”已移到回收站。
          <button
            disabled={busy}
            onClick={() =>
              void onAction({ action: "restore-resume", id: removed.id }).then(
                (saved) => {
                  if (saved) setRemoved(undefined);
                },
              )
            }
          >
            撤销删除
          </button>
        </p>
      )}
      {trash && (
        <p className="rg-note">
          删除只移出简历库，已有岗位版本和投递附件会保留。可以随时恢复。
        </p>
      )}
      <div className="rg-library-list">
        {rows.map((resume) => (
          <article key={resume.id} className="rg-library-row">
            <div className="rg-library-description">
              {renaming === resume.id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!busy && name.trim())
                      void onAction({
                        action: "rename-resume",
                        id: resume.id,
                        name,
                      }).then((saved) => {
                        if (saved) setRenaming("");
                      });
                  }}
                >
                  <label>
                    简历名称
                    <input
                      autoFocus
                      aria-label="简历名称"
                      maxLength={160}
                      value={name}
                      disabled={busy}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  <button disabled={busy || !name.trim()} type="submit">
                    保存名称
                  </button>
                  <button
                    disabled={busy}
                    type="button"
                    onClick={() => setRenaming("")}
                  >
                    取消重命名
                  </button>
                </form>
              ) : (
                <strong>{resume.name}</strong>
              )}
              <p className="rg-note">
                {resume.job
                  ? `${resume.job.company} · ${resume.job.role}`
                  : resume.parentId
                    ? "简历副本"
                    : "原始简历"}
                {resume.parentName && ` · 来源：${resume.parentName}`}
                {resume.updatedAt &&
                  ` · ${new Date(resume.updatedAt).toLocaleDateString()}`}
              </p>
              <p className="rg-library-summary">
                {resume.summary.replace(/\s+/g, " ")}
              </p>
            </div>
            <div className="rg-library-actions">
              {trash ? (
                <button
                  disabled={busy}
                  onClick={() =>
                    void onAction({ action: "restore-resume", id: resume.id })
                  }
                >
                  恢复简历
                </button>
              ) : (
                <>
                  <button
                    className="rg-quiet-action"
                    disabled={busy}
                    onClick={() =>
                      void onAction({ action: "resume", id: resume.id })
                    }
                  >
                    查看 / 修改简历
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => openFile(resume.pdf ?? resume.original)}
                  >
                    预览文件
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      setRenaming(resume.id);
                      setName(resume.name);
                    }}
                  >
                    重命名
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void onAction({
                        action: "duplicate-resume",
                        id: resume.id,
                      })
                    }
                  >
                    复制
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void onAction({
                        action: "trash-resume",
                        id: resume.id,
                      }).then((saved) => {
                        if (saved)
                          setRemoved({ id: resume.id, name: resume.name });
                      })
                    }
                  >
                    删除
                  </button>
                </>
              )}
            </div>
          </article>
        ))}
      </div>
      {!rows.length && (
        <p>
          {query.trim()
            ? "没有找到匹配的简历，可以更换关键词。"
            : trash
              ? "回收站为空。"
              : "还没有这类简历，可以上传原文件或从已有文字新建。"}
        </p>
      )}
    </section>
  );
}
