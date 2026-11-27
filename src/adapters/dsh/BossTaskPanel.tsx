import { useState } from "react";
import type { NativeView } from "./views.js";
import { BossResumePreview } from "./BossResumePreview.js";
import { BossResumeSwitch } from "./BossResumeSwitch.js";
import { BossJobDescription } from "./BossJobDescription.js";
import type { ReadResumeImage } from "./controls.js";
type View = Extract<NativeView, { kind: "boss" }>;
export function BossTaskPanel({
  view,
  busy,
  run,
  readResumeImage,
}: {
  view: View;
  busy: boolean;
  run: (v: any) => Promise<unknown>;
  readResumeImage?: ReadResumeImage;
}) {
  const [ack, setAck] = useState<Record<string, boolean>>({});
  const groups = view.groups.filter((group) => group.id === view.groupFocus);
  const archived = view.archivedTaskIds?.includes(view.groupFocus ?? "");
  return (
    <section aria-label="BOSS 整批任务">
      {groups.map((g) => (
        <div key={g.id}>
          <h4>
            {g.items.length} 个岗位 ·{" "}
            {
              {
                prepared: "待确认",
                running: "执行中",
                paused: "已暂停",
                finished: "已完成",
              }[g.status]
            }
          </h4>
          {archived && (
            <div>
              <span className="rg-status">已归档</span>
              <button disabled={busy} onClick={() => void run({ action: "boss-archive-task", kind: "group", id: g.id, archived: false })}>恢复</button>
            </div>
          )}
          {g.status !== "prepared" && (
            <p>已完成 {g.items.filter((i) => i.state === "finished").length}/{g.items.length}</p>
          )}
          {g.items.map((i, index) => {
            const d = view.deliveries.find((d) => d.id === i.deliveryId);
            const editable = view.canEditQueue && !archived && g.status === "prepared" && g.expiresAt !== 0 && d?.status === "prepared" && !d.withdrawnAt;
            return (
              <article key={i.deliveryId}>
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
                {d && <BossJobDescription jd={view.jobDescriptions?.[d.jobId]} role={d.role} reviewReasons={d.reviewReasons} />}
                {editable && d && (
                  <div className="rg-boss-item-actions">
                    {g.items.length > 1 && <>
                      <button disabled={busy || index === 0} onClick={() => void run({ action: "boss-queue-move", id: g.id, deliveryId: d.id, step: -1 })}>上移</button>
                      <button disabled={busy || index === g.items.length - 1} onClick={() => void run({ action: "boss-queue-move", id: g.id, deliveryId: d.id, step: 1 })}>下移</button>
                    </>}
                    <BossResumeSwitch view={view} delivery={d} busy={busy} run={run} groupId={g.id} />
                    <button disabled={busy} onClick={() => void run({ action: "boss-group-remove", id: g.id, deliveryId: d.id })}>移出待投</button>
                  </div>
                )}
                {d && <BossResumePreview images={d.images} readImage={readResumeImage} />}
              </article>
            );
          })}
          {!archived && g.status === "prepared" && <p>实验功能。确认后按顺序发出账号默认招呼，简历以聊天图片发送。</p>}
          {g.error && <p role="alert">{g.error}</p>}
          {g.status === "prepared" && !archived && (
            <>
              <label>
                <input
                  type="checkbox"
                checked={!!ack[g.id]}
                  disabled={busy}
                  onChange={(e) =>
                  setAck({ ...ack, [g.id]: e.target.checked })
                  }
                />
                已逐项核对全部公司、岗位、简历图片和默认招呼方式
              </label>
              <button
                className="rg-primary"
                disabled={
                  busy ||
                  !view.connected ||
                  !ack[g.id] ||
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
          )}
          {g.status !== "prepared" && (
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
              {!archived && g.status === "paused" &&
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
        </div>
      ))}
    </section>
  );
}
