import { useState } from "react";
import type { NativeView } from "./views.js";
type View = Extract<NativeView, { kind: "boss" }>;
export function BossTaskPanel({
  view,
  busy,
  run,
  openFile,
}: {
  view: View;
  busy: boolean;
  run: (v: any) => Promise<unknown>;
  openFile: (p: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]),
    [ack, setAck] = useState<Record<string, boolean>>({}),
    [text, setText] = useState<Record<string, string>>({});
  const eligible = view.deliveries.filter((d) => d.status === "prepared"),
    ids = selected.filter((id) => eligible.some((d) => d.id === id));
  return (
    <section aria-label="BOSS 整批任务">
      <h4>整批核对</h4>
      <p>每个岗位使用各自的简历图片；确认后顺序执行，遇到异常停止后续岗位。</p>
      {eligible.map((d) => (
        <label key={d.id}>
          <input
            type="checkbox"
            disabled={busy}
            checked={ids.includes(d.id)}
            onChange={(e) =>
              setSelected(
                e.target.checked
                  ? [...ids, d.id]
                  : ids.filter((i) => i !== d.id),
              )
            }
          />
          {d.company} · {d.role} · {d.resumeName}
        </label>
      ))}
      <button
        disabled={busy || !ids.length || ids.length > 10}
        onClick={() => void run({ action: "boss-group-prepare", ids })}
      >
        核对所选 {ids.length} 个岗位
      </button>
      {view.groups.map((g) => (
        <article key={g.id}>
          <h4>
            整批任务 ·{" "}
            {
              {
                prepared: "待确认",
                running: "执行中",
                paused: "已暂停",
                finished: "已完成",
              }[g.status]
            }
          </h4>
          <p>
            已完成 {g.items.filter((i) => i.state === "finished").length}/
            {g.items.length} · 本次确认有效至{" "}
            {new Date(g.expiresAt).toLocaleTimeString()}
          </p>
          {g.items.map((i) => {
            const d = view.deliveries.find((d) => d.id === i.deliveryId);
            return (
              <section key={i.deliveryId}>
                <strong>
                  {d?.company} · {d?.role}
                </strong>
                <p>
                  简历：{d?.resumeName} ·{" "}
                  {
                    {
                      queued: "未执行",
                      running: "执行中",
                      finished: "已核验",
                      needs_review: "待人工核对",
                    }[i.state]
                  }
                </p>
                {d && (
                  <>
                    <button onClick={() => openFile(d.pdfPath)}>
                      查看该岗位 PDF
                    </button>
                    {d.images.map((image, n) => (
                      <button
                        key={image.sha256}
                        onClick={() => openFile(image.path)}
                      >
                        查看第 {n + 1} 张实际图片
                      </button>
                    ))}
                  </>
                )}
              </section>
            );
          })}
          <p>首次沟通由 BOSS 发送账号默认招呼；程序不会额外发送自定义文字。</p>
          {g.error && <p role="alert">{g.error}</p>}
          {g.status === "prepared" ? (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={!!ack[g.digest]}
                  disabled={busy}
                  onChange={(e) =>
                    setAck({ ...ack, [g.digest]: e.target.checked })
                  }
                />
                已逐项核对全部公司、岗位、简历图片和默认招呼方式
              </label>
              <label>
                输入“投递”确认本批
                <input
                  disabled={busy}
                  value={text[g.digest] ?? ""}
                  onChange={(e) =>
                    setText({ ...text, [g.digest]: e.target.value })
                  }
                />
              </label>
              <button
                disabled={
                  busy ||
                  !view.connected ||
                  !ack[g.digest] ||
                  text[g.digest] !== "投递" ||
                  g.expiresAt <= Date.now()
                }
                onClick={() =>
                  void run({
                    action: "boss-group-confirm",
                    id: g.id,
                    digest: g.digest,
                    acknowledged: true,
                    confirmation: "投递",
                  })
                }
              >
                确认并顺序投递
              </button>
            </>
          ) : (
            <>
              <button
                disabled={busy}
                onClick={() => void run({ action: "boss" })}
              >
                更新任务进度
              </button>
              {g.status === "running" && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void run({ action: "boss-group-pause", id: g.id })
                  }
                >
                  完成当前步骤后暂停整批
                </button>
              )}
              {g.status === "paused" &&
                g.items.some((i) => i.state === "queued") && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run({ action: "boss-group-remaining", id: g.id })
                    }
                  >
                    重新核对未执行的岗位
                  </button>
                )}
            </>
          )}
        </article>
      ))}
    </section>
  );
}
