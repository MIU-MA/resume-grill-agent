import { useEffect, useState } from "react";
import type { Job } from "../../service.js";
export function JobEditor({
  items,
  selected,
  onSelect,
  onSave,
  busy,
}: {
  items: Job[];
  selected: string;
  onSelect: (id: string) => void;
  onSave: (value: Omit<Job, "id">) => Promise<void>;
  busy: boolean;
}) {
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    if (selected) setAdding(false);
  }, [selected]);
  return (
    <section>
      <div className="section-heading">
        <h2>岗位</h2>
        <button onClick={() => setAdding(!adding)}>
          {adding ? "收起" : "添加岗位"}
        </button>
      </div>
      {adding && (
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = e.currentTarget;
            const data = new FormData(f);
            await onSave({
              company: String(data.get("company")),
              role: String(data.get("role")),
              sourceUrl: String(data.get("url")),
              jd: String(data.get("jd")),
              ...(data.get("recipient")
                ? { recipient: String(data.get("recipient")) }
                : {}),
            });
          }}
        >
          <label>
            岗位名称
            <input name="role" required />
          </label>
          <label>
            公司
            <input name="company" />
          </label>
          <label>
            来源链接
            <input name="url" type="url" placeholder="https://" required />
          </label>
          <label>
            招聘邮箱（可选）
            <input name="recipient" type="email" />
          </label>
          <label>
            岗位描述
            <textarea name="jd" rows={6} required />
          </label>
          <button className="primary" disabled={busy}>
            保存岗位
          </button>
        </form>
      )}
      <div className="item-list">
        {items.map((item) => (
          <button
            key={item.id}
            className={selected === item.id ? "item selected" : "item"}
            onClick={() => onSelect(item.id)}
          >
            <strong>{item.role}</strong>
            <small>{item.company || "未填写公司"}</small>
          </button>
        ))}
        {!items.length && (
          <p className="muted">添加 JD 后，才能对照岗位修改。</p>
        )}
      </div>
    </section>
  );
}
