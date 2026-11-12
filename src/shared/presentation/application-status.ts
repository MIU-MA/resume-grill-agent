import type { Application } from "../../core/workspace.js";
import type { BatchItem } from "../../core/tasks.js";

export const applicationStatusLabel: Record<Application["status"], string> = {
  prepared: "待确认，未发送",
  simulated: "附件已检查，未发送",
  sending: "发送中，先核对结果",
  sent: "SMTP 已接受",
  uncertain: "结果待核对，不要重发",
  superseded: "已被新预览替代，不能发送",
};
export function batchItemLabel(item: BatchItem) {
  if (item.applicationStatus && item.applicationStatus !== "prepared")
    return applicationStatusLabel[item.applicationStatus];
  return item.status === "prepared"
    ? "简历与邮件已准备"
    : (item.reason ?? "准备结果待核对");
}
