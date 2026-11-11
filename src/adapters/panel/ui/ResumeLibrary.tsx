import type { Resume } from "../../../core/workspace.js";
export function ResumeLibrary({
  items,
  selected,
  onSelect,
  onImport,
  busy,
}: {
  items: Resume[];
  selected: string;
  onSelect: (id: string) => void;
  onImport: (file: File) => void;
  busy: boolean;
}) {
  return (
    <section>
      <div className="section-heading">
        <h2>简历</h2>
        <label className="file-button">
          导入
          <input
            type="file"
            aria-label="导入简历"
            accept=".pdf,.docx,.txt,.md"
            disabled={busy}
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              if (file) onImport(file);
              e.currentTarget.value = "";
            }}
          />
        </label>
      </div>
      <p className="muted">原文件保留，岗位版另存。</p>
      <div className="item-list">
        {items.map((item) => (
          <button
            key={item.id}
            className={selected === item.id ? "item selected" : "item"}
            onClick={() => onSelect(item.id)}
          >
            <strong>{item.name}</strong>
            <small>{item.parentId ? "岗位版本" : "原始简历"}</small>
          </button>
        ))}
        {items.length === 0 && <p>还没有简历，先导入一份。</p>}
      </div>
    </section>
  );
}
