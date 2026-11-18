import { useState } from "react";
import type { NativeView } from "./views.js";
import { BossTaskPanel } from "./BossTaskPanel.js";

type View = Extract<NativeView, { kind: "boss" }>;
const deliveryStatus = {
  prepared: "待确认",
  submitting: "等待回执",
  running: "执行中",
  finished: "已投递",
  paused: "已暂停",
  uncertain: "待核对",
};

export function BossDeliveryPanel({
  view,
  busy,
  run,
  openFile,
}: {
  view: View;
  busy: boolean;
  run: (input: any) => Promise<unknown>;
  openFile: (path: string) => void;
}) {
  const [ack, setAck] = useState<Record<string, boolean>>({});
  const [confirmation, setConfirmation] = useState<Record<string, string>>({});
  const { deliveryFocus: focusedDelivery, groupFocus: focusedGroup } = view;
  const deliveries = focusedGroup
    ? []
    : focusedDelivery
      ? view.deliveries.filter((d) => d.id === focusedDelivery)
      : view.deliveries;
  const preparedCount = deliveries.filter((d) => d.status === "prepared").length;
  return (
    <>
      {!focusedDelivery && (preparedCount >= 2 || view.groups.length > 0) && (
        <details open={!!focusedGroup}>
          <summary>批量投递</summary>
          <BossTaskPanel view={view} busy={busy} run={run} openFile={openFile} />
        </details>
      )}
      {deliveries.map((d) => (
        <details key={d.id} open={d.id === focusedDelivery} aria-label="BOSS 投递核对">
          <summary>{d.company} · {d.role} · {deliveryStatus[d.status]}</summary>
          <p>
            简历：{d.resumeName} · {d.images.length} 张图片
          </p>
          <p>首次沟通使用 BOSS 账号默认招呼，不追加自定义文字。</p>
          <button onClick={() => openFile(d.pdfPath)}>查看实际 PDF</button>
          {d.images.map((i, n) => (
            <button key={i.sha256} onClick={() => openFile(i.path)}>
              查看第 {n + 1} 张实际图片
            </button>
          ))}
          {d.error && <p role="alert">{d.error}</p>}
          {d.status === "prepared" ? (
            <>
              <button
                disabled={busy || !view.connected}
                onClick={() => void run({ action: "boss-preview", id: d.id })}
              >
                刷新核对有效期
              </button>
              <label>
                <input
                  type="checkbox"
                  checked={!!ack[d.digest]}
                  disabled={busy}
                  onChange={(e) =>
                    setAck({ ...ack, [d.digest]: e.target.checked })
                  }
                />
                已核对公司、岗位、默认招呼方式和全部图片
              </label>
              <label>
                输入“投递”后执行
                <input
                  value={confirmation[d.digest] ?? ""}
                  disabled={busy}
                  onChange={(e) =>
                    setConfirmation({
                      ...confirmation,
                      [d.digest]: e.target.value,
                    })
                  }
                />
              </label>
              <button
                disabled={
                  busy ||
                  !view.connected ||
                  !ack[d.digest] ||
                  confirmation[d.digest] !== "投递" ||
                  (d.expiresAt ?? 0) <= Date.now()
                }
                onClick={() =>
                  void run({
                    action: "boss-confirm",
                    id: d.id,
                    digest: d.digest,
                    acknowledged: true,
                    confirmation: "投递",
                  })
                }
              >
                确认并投递此岗位
              </button>
            </>
          ) : (
            <>
              <button
                disabled={busy || !view.connected}
                onClick={() =>
                  void run({ action: "boss-delivery-refresh", id: d.id })
                }
              >
                读取执行回执
              </button>
              {d.status === "running" && (
                <button
                  disabled={busy || !view.connected}
                  onClick={() =>
                    void run({ action: "boss-delivery-pause", id: d.id })
                  }
                >
                  完成当前步骤后暂停
                </button>
              )}
            </>
          )}
        </details>
      ))}
      {(!focusedDelivery && !focusedGroup ? view.runs : [])
        .filter((r) => !view.deliveries.some((d) => d.remoteId === r.id))
        .map((r) => (
          <article key={r.id}>
            <h4>批次 · {r.state}</h4>
            {r.tasks.map((t) => (
              <p key={t.url}>
                {t.company} · {t.title} · {t.state}
                {t.error ? `：${t.error}` : ""}
              </p>
            ))}
            <button
              disabled={busy || !view.connected}
              onClick={() => void run({ action: "boss-refresh", id: r.id })}
            >
              更新回执
            </button>
            {r.state === "running" && (
              <button
                disabled={busy || !view.connected}
                onClick={() => void run({ action: "boss-pause", id: r.id })}
              >
                完成当前步骤后暂停
              </button>
            )}
          </article>
        ))}
    </>
  );
}
