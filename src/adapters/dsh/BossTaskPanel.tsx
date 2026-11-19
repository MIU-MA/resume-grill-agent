import { useState } from "react";
import type { NativeView } from "./views.js";
import { BossResumePreview } from "./BossResumePreview.js";
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
          {g.items.map((i) => {
            const d = view.deliveries.find((d) => d.id === i.deliveryId);
            return (
              <article key={i.deliveryId}>
                <strong>
                  {d?.company} · {d?.role}
                </strong>
                {!archived && g.status === "prepared" && g.expiresAt > 0 && g.items.length > 1 && (
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
                {d && <BossResumePreview images={d.images} readImage={readResumeImage} />}
              </article>
            );
          })}
          {!archived && g.status === "prepared" && <p>确认后按顺序发出 BOSS 账号默认招呼和简历图片。</p>}
          {g.error && <p role="alert">{g.error}</p>}
          {g.status === "prepared" && !archived && (
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
                className="rg-primary"
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
