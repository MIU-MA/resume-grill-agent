import type { Workspace } from "./workspace.js";
import type { Capability } from "../shared/capabilities.js";
import { baseOperations } from "./operations/base.js";
import { bossOperations } from "./operations/boss.js";
import { mailOperations } from "./operations/mail.js";
import { websiteOperations } from "./operations/website.js";
import { operationModule, type OperationModule } from "./operations/module.js";

export type { Operation } from "./operations/module.js";

const modules = {
  boss: bossOperations,
  mail: mailOperations,
  website: websiteOperations,
} satisfies Record<Capability, (workspace: Workspace) => OperationModule>;

export function operations(workspace: Workspace) {
  const active = [
    baseOperations(workspace),
    ...workspace.capabilities.map((capability) =>
      modules[capability](workspace),
    ),
  ];
  return [
    ...active.flatMap((module) => module.tools),
    ...operationModule((tool) => {
      tool(
        "application_history",
        "读取已启用渠道的投递记录。SMTP 接受或官网回执不代表对方已读。",
        {},
        () => active.flatMap((module) => module.history?.() ?? []),
        true,
      );
      tool(
        "list_workspace",
        "读取简历、岗位、求职目标、查找结果和已启用渠道的任务。",
        {},
        () =>
          Object.assign(
            { capabilities: workspace.capabilities },
            ...active.map((module) => module.snapshot?.()),
          ),
        true,
      );
    }),
  ];
}
