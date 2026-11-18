import type { Workspace } from "../workspace.js";
import { operationModule, type OperationModule } from "./module.js";
import { z } from "zod";
import { Boss } from "../boss.js";
import { BossDeliveries } from "../boss-deliveries.js";
import { BossGroups } from "../boss-groups.js";
import { BossShortlists } from "../boss-shortlists.js";

export function bossOperations(workspace: Workspace): OperationModule {
  const boss = new Boss(workspace);
  const deliveries = new BossDeliveries(workspace);
  return {
    tools: operationModule((tool) => {
      tool(
        "boss_status",
        "检查用户已连接的本机 BOSS 执行器状态。不建立新浏览器，不发送。",
        {},
        () => new Boss(workspace).status(),
        true,
      );
      tool(
        "boss_search",
        "在已连接的 BOSS 页面搜索指定方向并读取当前结果；遇到登录、验证或加载先停下，不重复搜索，不联系招聘方。",
        { query: z.string().trim().min(1).max(120) },
        ({ query }) => new Boss(workspace).search(query),
      );
      tool(
        "boss_read_jobs",
        "读取当前 BOSS 列表快照；遇到登录或验证请用户接管，不自动重试。",
        {},
        () => new Boss(workspace).read(),
      );
      tool(
        "boss_read_detail",
        "核对本次列表中的岗位身份与完整 JD，保存为独立岗位，可 review_context。",
        { scanId: z.string(), url: z.string() },
        ({ scanId, url }) => new Boss(workspace).detail(scanId, url),
      );
      tool(
        "boss_delivery_status",
        "查询已有 BOSS 批次，保存本机回执。无 id 时列最近批次。不恢复发送。",
        { id: z.string().uuid().optional() },
        async ({ id }) => {
          if (!id) return boss.recent();
          if (!deliveries.list().some((delivery) => delivery.id === id))
            return boss.refresh(id);
          const { previewId, ...delivery } = await deliveries.refresh(id);
          return delivery;
        },
      );
      tool(
        "boss_pause_delivery",
        "按用户要求暂停 BOSS 批次，完成当前步骤后停下；之后读取状态，不重复执行。",
        { id: z.string().uuid() },
        ({ id }) =>
          deliveries.list().some((delivery) => delivery.id === id)
            ? deliveries.pause(id)
            : boss.pause(id),
      );
      tool(
        "boss_prepare_delivery",
        "将用户选定的主简历或当前岗位版本转为图片，冻结附件并准备 BOSS 人工核对卡。不确认、不发送，不使用其他岗位的简历版本。",
        { resumeId: z.string(), jobId: z.string() },
        ({ resumeId, jobId }) =>
          new BossDeliveries(workspace)
            .prepare(resumeId, jobId)
            .then(({ previewId, ...delivery }) => delivery),
      );
      tool(
        "boss_shortlist",
        "按用户保存的目标筛选当前 BOSS 列表，最多读取 budget 个完整 JD，保留排除原因与简历原文证据。不编造匹配分数。城市提及不等于实际工作地点，需人工核对。失败停止后续读取，不发信。",
        {
          goalId: z.string(),
          scanId: z.string(),
          budget: z.number().int().min(1).max(10).default(5),
        },
        ({ goalId, scanId, budget }) =>
          new BossShortlists(workspace).collect(goalId, scanId, budget),
      );
      tool(
        "boss_prepare_group",
        "将用户选定且已冻结的岗位附件整理为整批核对卡，最多 10 个岗位。只准备，不确认或执行。",
        { deliveryIds: z.array(z.string().uuid()).min(1).max(10) },
        ({ deliveryIds }) => new BossGroups(workspace).prepare(deliveryIds),
      );
      tool(
        "boss_group_status",
        "读取插件整批任务缓存和逐岗位进度，重启后不自动恢复发送。需要更新当前官网回执请调用 boss_delivery_status。",
        { id: z.string().uuid().optional() },
        ({ id }) =>
          id
            ? new BossGroups(workspace).get(id)
            : new BossGroups(workspace).list(),
        true,
      );
      tool(
        "boss_pause_group",
        "按用户要求停止后续岗位并请求当前岗位完成步骤后暂停。不自动重发或重新批准。",
        { id: z.string().uuid() },
        ({ id }) => new BossGroups(workspace).pause(id),
      );
    }),
    snapshot: () => ({
      bossScans: workspace.store.list("boss-scan").slice(0, 5),
      bossShortlists: workspace.store.list("boss-shortlist").slice(0, 5),
      bossGroups: new BossGroups(workspace).list(),
      bossDeliveries: new BossDeliveries(workspace)
        .list()
        .map(({ previewId, ...delivery }) => delivery),
    }),
    history: () =>
      new BossDeliveries(workspace)
        .list()
        .filter((delivery) => delivery.status !== "prepared")
        .map(({ previewId, ...delivery }) => ({
          ...delivery,
          channel: "boss",
        })),
  };
}
