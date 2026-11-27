import { useState } from "react";
import type { NativeView } from "./views.js";
import { groupedBossDeliveryIds } from "./boss-task-view.js";
import { BossTaskPanel } from "./BossTaskPanel.js";
import { BossResumePreview } from "./BossResumePreview.js";
import { BossResumeSwitch } from "./BossResumeSwitch.js";
import { BossJobDescription } from "./BossJobDescription.js";
import type { ReadResumeImage } from "./controls.js";
import { JobList, JobListRow } from "./JobList.js";
import type { BossTaskKind } from "../../core/boss-archives.js";

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
  archiveFilter,
}: {
  view: View;
  busy: boolean;
  run: (input: any) => Promise<unknown>;
  readResumeImage?: ReadResumeImage;
  archiveFilter?: { archivedOnly: boolean; setArchivedOnly: (value: boolean) => void };
}) {
  const [ack, setAck] = useState<Record<string, boolean>>({});
  const { deliveryFocus: focusedDelivery, groupFocus: focusedGroup } = view;
  const grouped = groupedBossDeliveryIds(view);
  const deliveries = focusedGroup
    ? []
    : focusedDelivery
      ? view.deliveries.filter((d) => d.id === focusedDelivery)
      : view.deliveries.filter((d) => !d.withdrawnAt && !grouped.has(d.id));
  const groups = view.groups.filter((g) => g.expiresAt !== 0 || g.id === focusedGroup);
  const runs = view.runs.filter((r) => !view.deliveries.some((d) => d.remoteId === r.id));
  const archived = new Set(view.archivedTaskIds ?? []);
  const isList = !focusedDelivery && !focusedGroup;
  const rows = [...groups, ...deliveries, ...runs];
  const visible = ({ id }: { id: string }) => archived.has(id) === Boolean(archiveFilter?.archivedOnly);
  const archivedCount = rows.filter(({ id }) => archived.has(id)).length;
  const archiveButton = (id: string, kind: BossTaskKind, executing = false) => {
    if (!view.archivedTaskIds || executing) return null;
    const restoring = archived.has(id);
    return <button disabled={busy} onClick={() => void run({
      action: "boss-archive-task", kind, id, archived: !restoring,
    })}>{restoring ? "恢复" : "归档"}</button>;
  };
  return (
    <>
      {focusedGroup && (
        <BossTaskPanel view={view} busy={busy} run={run} readResumeImage={readResumeImage} />
      )}
      {isList && archiveFilter && view.archivedTaskIds && (
        <div className="rg-task-filter" role="group" aria-label="投递任务筛选">
          <button aria-pressed={!archiveFilter.archivedOnly} onClick={() => archiveFilter.setArchivedOnly(false)}>当前任务</button>
          <button aria-pressed={archiveFilter.archivedOnly} onClick={() => archiveFilter.setArchivedOnly(true)}>已归档 {archivedCount}</button>
        </div>
      )}
      {isList && !rows.some(visible) && (
        <p className="rg-note">{archiveFilter?.archivedOnly ? "没有已归档的任务。" : "没有当前任务。"}</p>
      )}
      {isList && (groups.some(visible) || deliveries.some(visible)) && (
        <JobList>
          {groups.filter(visible).map((g) => (
            <JobListRow key={g.id}
              title={`${g.items.length} 个岗位 · ${groupStatus[g.status]}`}
              meta={g.items.map((i) => view.deliveries.find((d) => d.id === i.deliveryId)?.company)
                .filter(Boolean).join("、")}
              action={<>
                <button disabled={busy} onClick={() => void run({ action: "boss", groupFocus: g.id })}>查看批次</button>
                {archiveButton(g.id, "group", g.status === "running" || view.deliveries.some((d) =>
                  (d.status === "running" || d.status === "submitting") && g.items.some((i) => i.deliveryId === d.id))) }
              </>}
            />
          ))}
          {deliveries.filter(visible).map((d) => (
            <JobListRow key={d.id} title={d.role} meta={`${d.company} · ${deliveryStatus[d.status]}`}
              action={<>
                <button disabled={busy} onClick={() => void run({ action: "boss", deliveryFocus: d.id })}>查看投递</button>
                {archiveButton(d.id, "delivery", d.status === "running" || d.status === "submitting")}
              </>}
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
          <p>实验功能。首次沟通使用账号默认招呼，简历以聊天图片发送。</p>
          <BossJobDescription jd={view.jobDescriptions?.[d.jobId]} role={d.role} reviewReasons={d.reviewReasons} />
          <BossResumePreview images={d.images} readImage={readResumeImage} />
          {d.error && <p role="alert">{d.error}</p>}
          {archived.has(d.id) && (
            <div><span className="rg-status">已归档</span>{archiveButton(d.id, "delivery")}</div>
          )}
          {d.withdrawnAt && <p role="status">这条任务已移出待投，请查看当前清单。</p>}
          {d.status === "prepared" && !d.withdrawnAt && !archived.has(d.id) && (
            <>
              {view.canEditQueue && (
                <div className="rg-boss-item-actions">
                  <BossResumeSwitch view={view} delivery={d} busy={busy} run={run} />
                  <button disabled={busy} onClick={() => void run({ action: "boss-queue-remove", id: d.id })}>移出待投</button>
                </div>
              )}
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
          )}
          {d.status !== "prepared" && (
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
      {(isList ? runs : []).filter(visible)
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
            {archiveButton(r.id, "run", r.state === "running")}
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
