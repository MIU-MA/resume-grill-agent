import type { Workspace } from "../workspace.js";
import { operationModule, type OperationModule } from "./module.js";
import { z } from "zod";
import { Tasks, batchChoice, type Batch } from "../tasks.js";
import { applicationMail } from "../../domain/application-mail.js";

export function mailOperations(workspace: Workspace): OperationModule {
  const tasks = new Tasks(workspace);
  return {
    tools: operationModule((tool) => {
      tool(
        "prepare_application_batch",
        "用户核对修改后，一次准备所选岗位的专属简历和邮件。每项要提供已查看的 proposalId 与接受项，或用户明确选择 keepOriginal。只准备，不批准或发送；逐项报告阻塞原因。",
        { goalId: z.string(), choices: z.array(batchChoice).min(1).max(20) },
        async (args) => {
          const batch = await tasks.prepareBatch(args.goalId, args.choices);
          return tasks.batchSnapshot(batch.id);
        },
      );
      tool(
        "prepare_application",
        "冻结岗位版附件与邮件正文。相同内容返回已有记录，不重复创建。",
        {
          jobId: z.string(),
          resumeId: z.string(),
          recipient: z.string(),
          subject: z.string(),
          body: z.string(),
        },
        (args) =>
          workspace.prepare(
            args.jobId,
            args.resumeId,
            args.recipient,
            args.subject,
            args.body,
          ),
      );
      tool(
        "revise_application",
        "修改未发送邮件的收件人、主题和正文，沿用已冻结的 PDF。传入当前预览 digest；保存新预览并停用旧预览及其确认，不批准或发送。",
        { id: z.string(), digest: z.string(), ...applicationMail.shape },
        ({ id, digest, ...mail }) =>
          workspace.reviseApplication(id, digest, mail),
      );
      tool(
        "preview_application",
        "向用户完整展示收件人、正文、附件及 digest。确认由人工 CLI 完成，不能由模型自行生成批准。",
        { id: z.string() },
        (args) => workspace.preview(args.id),
        true,
      );
      tool(
        "execute_application",
        "dryRun 必填：true 仅检查，不发信；用户要求真实投递时用 false。实际发送需要环境开关和对应 digest 的人工确认。结果不明确时禁止重发。",
        { id: z.string(), dryRun: z.boolean() },
        (args) => workspace.execute(args.id, args.dryRun),
      );
    }),
    snapshot: () => ({
      batches: workspace.store
        .list<Batch>("batch")
        .map((batch) => tasks.batchSnapshot(batch.id)),
    }),
    history: () => workspace.history(),
  };
}
