import type { Workspace } from "../workspace.js";
import { operationModule, type OperationModule } from "./module.js";
import { z } from "zod";
import { applicationFormContext } from "../application-forms.js";
import { FormRuns, observedFields, type FormRun } from "../form-runs.js";

export function websiteOperations(workspace: Workspace): OperationModule {
  return {
    tools: operationModule((tool) => {
      tool(
        "start_form_run",
        "开始或恢复官网填写任务，绑定已确认资料与附件。先调用本工具，再读取页面并用 plan_form_fill 自动匹配；禁止最终提交。",
        { resumeId: z.string(), jobId: z.string() },
        (args) => new FormRuns(workspace).start(args.resumeId, args.jobId),
      );
      tool(
        "plan_form_fill",
        "把最新浏览器快照中的真实字段交给程序匹配已确认资料，返回批量填写参数、上传入口与缺项。只执行 actions 中 write=true 的项；不要覆盖已有冲突内容。多段经历的 index 为同类经历的零起始序号，不能猜分组。",
        { runId: z.string(), url: z.string().url(), fields: observedFields },
        (args) =>
          new FormRuns(workspace).plan(args.runId, args.url, args.fields),
      );
      tool(
        "verify_form_fill",
        "填写后重新读取实际页面字段和附件名，程序逐项比较并保存进度。ready 只代表已回读一致且没有必填阻塞，不代表已提交；失败最多核查两次后人工处理。",
        {
          runId: z.string(),
          url: z.string().url(),
          values: z
            .array(
              z
                .object({
                  uid: z.string().min(1).max(100),
                  value: z.string().max(10000),
                })
                .strict(),
            )
            .max(200),
          uploadedName: z.string().max(300).optional(),
        },
        (args) =>
          new FormRuns(workspace).verify(
            args.runId,
            args.url,
            args.values,
            args.uploadedName,
          ),
      );
      tool(
        "application_form_context",
        "读取用户选定简历和岗位的官网填写资料、原文证据及实际附件。由宿主已启用的浏览器工具读取字段、填写并回读核对；缺资料/登录/验证码时停下，禁止最终提交及代勾声明。不需要招聘邮箱，不准备邮件。",
        { resumeId: z.string(), jobId: z.string() },
        (args) => applicationFormContext(workspace, args.resumeId, args.jobId),
        true,
      );
    }),
    snapshot: () => ({ formRuns: workspace.store.list<FormRun>("form-run") }),
  };
}
