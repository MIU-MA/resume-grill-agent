import { useState } from "react";
import type { NativeView } from "./views.js";
import { groupedBossDeliveryIds } from "./boss-task-view.js";
import { BossTaskPanel } from "./BossTaskPanel.js";
import { BossResumePreview } from "./BossResumePreview.js";
import type { ReadResumeImage } from "./controls.js";
import { JobList, JobListRow } from "./JobList.js";

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
  readResumeImage,
}: {
  view: View;
  busy: boolean;
  run: (input: any) => Promise<unknown>;
  readResumeImage?: ReadResumeImage;
}) {
  const [ack, setAck] = useState<Record<string, boolean>>({});
  const { deliveryFocus: focusedDelivery, groupFocus: focusedGroup } = view;
  const grouped = groupedBossDeliveryIds(view);
  const deliveries = focusedGroup
    ? []
    : focusedDelivery
      ? view.deliveries.filter((d) => d.id === focusedDelivery)
      : view.deliveries.filter((d) => !grouped.has(d.id));
  const groups = view.groups.filter((g) => g.expiresAt !== 0 || g.id === focusedGroup);
  return (
    <>
      {focusedGroup && (
        <BossTaskPanel view={view} busy={busy} run={run} readResumeImage={readResumeImage} />
      )}
      {!focusedDelivery && !focusedGroup && (groups.length > 0 || deliveries.length > 0) && (
        <JobList>
          {groups.map((g) => (
            <JobListRow key={g.id}
              title={`${g.items.length} 个岗位 · ${groupStatus[g.status]}`}
              meta={g.items.map((i) => view.deliveries.find((d) => d.id === i.deliveryId)?.company)
                .filter(Boolean).join("、")}
              action={<button disabled={busy} onClick={() => void run({ action: "boss", groupFocus: g.id })}>查看批次</button>}
            />
          ))}
          {deliveries.map((d) => (
            <JobListRow key={d.id} title={d.role} meta={`${d.company} · ${deliveryStatus[d.status]}`}
              action={<button disabled={busy} onClick={() => void run({ action: "boss", deliveryFocus: d.id })}>查看投递</button>}
            />
          ))}
        </JobList>
      )}
      {focusedDelivery && deliveries.map((d) => (
        <section key={d.id} aria-label="单个岗位投递">
          <h4>{d.company} · {d.role} · {deliveryStatus[d.status]}</h4>
          <p>
            简历：{d.resumeName} · {d.images.length} 张图片
          </p>
          <p>首次沟通使用 BOSS 账号默认招呼，不追加自定义文字。</p>
          <BossResumePreview images={d.images} readImage={readResumeImage} />
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
              <button
                className="rg-primary"
                disabled={
                  busy ||
                  !view.connected ||
                  !ack[d.digest] ||
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
        </section>
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

const groupStatus = {
  prepared: "待确认",
  running: "执行中",
  paused: "已暂停",
  finished: "已完成",
};
