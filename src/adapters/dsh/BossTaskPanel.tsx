import { useState } from "react";
import type { NativeView } from "./views.js";
import { groupedBossDeliveryIds } from "./boss-task-view.js";
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
    [ack, setAck] = useState<Record<string, boolean>>({});
  const grouped = groupedBossDeliveryIds(view);
  const eligible = view.deliveries.filter((d) =>
      d.status === "prepared" && !grouped.has(d.id)),
    ids = selected.filter((id) => eligible.some((d) => d.id === id));
  const groups = view.groupFocus
    ? view.groups.filter((g) => g.id === view.groupFocus)
    : view.groups.filter((g) => g.expiresAt !== 0);
  return (
    <section aria-label="BOSS 整批任务">
      {!view.groupFocus && eligible.length >= 2 && (
        <>
        <h4>选择要一起投递的岗位</h4>
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
        disabled={busy || ids.length < 2 || ids.length > 10}
        onClick={() => void run({ action: "boss-group-prepare", ids })}
      >
        核对所选岗位{ids.length ? `（${ids.length}）` : ""}
      </button>
        </>
      )}
      {groups.map((g) => (
        <details key={g.id} open={g.id === view.groupFocus || g.status === "running"}>
          <summary>
            {g.items.length} 个岗位 ·{" "}
            {
              {
                prepared: "待确认",
                running: "执行中",
                paused: "已暂停",
                finished: "已完成",
              }[g.status]
            }
          </summary>
          {g.status !== "prepared" && (
            <p>已完成 {g.items.filter((i) => i.state === "finished").length}/{g.items.length}</p>
          )}
          {g.items.map((i) => {
            const d = view.deliveries.find((d) => d.id === i.deliveryId);
            return (
              <section key={i.deliveryId}>
                <strong>
                  {d?.company} · {d?.role}
                </strong>
                {g.status === "prepared" && g.expiresAt > 0 && g.items.length > 1 && (
                  <button
                    disabled={busy}
                    onClick={() => void run({
                      action: "boss-group-remove",
                      id: g.id,
                      deliveryId: i.deliveryId,
                    })}
                  >
                    移出本批
                  </button>
                )}
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
          <p>确认后按顺序发出 BOSS 账号默认招呼和简历图片。</p>
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
              <button
                disabled={
                  busy ||
                  !view.connected ||
                  !ack[g.digest] ||
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
                确认投递 {g.items.length} 个岗位
              </button>
              {g.expiresAt === 0 && <p>此批次已替换，请返回查看新批次。</p>}
              {g.expiresAt > 0 && g.expiresAt <= Date.now() && (
                <button
                  disabled={busy}
                  onClick={() => void run({
                    action: "boss-group-prepare",
                    ids: g.items.map((item) => item.deliveryId),
                  })}
                >
                  重新核对本批
                </button>
              )}
            </>
          ) : (
            <>
              <button
                disabled={busy}
                onClick={() => void run({ action: "boss-group-view", id: g.id })}
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
        </details>
      ))}
    </section>
  );
}
