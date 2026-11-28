import { randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import { Store } from "../../infrastructure/sqlite-store.js";
import { Workspace, type Job } from "../../core/workspace.js";
import { nativeMail } from "./mail-settings.js";
import { activeCapabilities, NativeConfig } from "./config.js";
import { importStagedResume } from "./resume-upload.js";
import { reviewView, workspaceView } from "./views.js";
import { operations } from "../../core/operations.js";
import {
  humanAction,
  cardAction,
  requireCapability,
  restoreView,
} from "./actions.js";
import { viewFor } from "./views.js";
import { requireBrowserTools } from "./browser-tools.js";
import { ResumeProfiles } from "../../core/resume-profiles.js";
import { hasCapability } from "../../shared/capabilities.js";
import { promptSectionsFor } from "../../shared/prompts.js";
import { withTrace } from "../../shared/telemetry.js";
import { Boss } from "../../core/boss.js";
import { BossExecutor } from "../../infrastructure/boss-executor/index.js";
import { requireCompanyWebsite } from "../../domain/boss.js";
import { WebsiteFill } from "../../core/website-fill.js";
import { WebsiteBrowser } from "../../infrastructure/website-browser.js";

export const name = "resume-grill";
export const Config = NativeConfig;
export const inject = [
  "tools",
  "commands",
  "systemPrompt",
  "credentials",
  "settings",
  "attachments",
  "fileUploads",
];
type Context = {
  tools: {
    register: (value: any) => () => void;
    resolve?: (context: any) => Promise<any>;
  };
  commands: { register: (value: any) => () => void };
  systemPrompt: { section: (value: any) => () => void };
  effect: (fn: () => () => void) => unknown;
};
const websiteFillAction = z.strictObject({
  action: z.literal("website-fill"),
  resumeId: z.string().min(1),
  jobId: z.string().min(1),
  goalId: z.string().min(1).optional(),
  approvalId: z.uuid().optional(),
});
// DSH's schema subset omits min/max/format. Zod still enforces the full schema in execute.
export function nativeSchema(schema: any): any {
  const result: any = {};
  for (const key of [
    "type",
    "description",
    "title",
    "enum",
    "const",
    "required",
    "additionalProperties",
  ])
    if (schema[key] !== undefined) result[key] = schema[key];
  if (schema.properties)
    result.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => [
        key,
        nativeSchema(value),
      ]),
    );
  if (schema.items) result.items = nativeSchema(schema.items);
  if (schema.oneOf) result.oneOf = schema.oneOf.map(nativeSchema);
  return result;
}
export function mount(
  ctx: Context,
  workspace: Workspace,
  verifyMail?: () => Promise<unknown>,
  refreshMail?: () => Promise<void>,
  importUpload?: (agent: any, receiptId: string) => Promise<unknown>,
  websiteFill?: WebsiteFill,
) {
  for (const operation of operations(workspace))
    ctx.effect(() =>
      ctx.tools.register({
        name: `resume_grill_${operation.name}`,
        description: operation.description,
        parameters: nativeSchema(
          z.toJSONSchema(operation.schema, {
            io: "input",
            unrepresentable: "any",
          }),
        ),
        output: {
          schema: {},
          render: (_args: unknown, value: unknown) => [
            { type: "text", text: JSON.stringify(value) },
          ],
          presentationMeta: (args: unknown, value: unknown) => ({
            resumeGrill:
              viewFor(workspace, operation.name, args, value) ?? null,
          }),
        },
        execute: async (args: any, exec: { signal: AbortSignal }) => {
          exec.signal.throwIfAborted();
          if (operation.name === "execute_application") await refreshMail?.();
          if (operation.name === "execute_application" && args.dryRun !== true)
            throw new Error(
              "真实发送请用户在投递卡片核对并确认；助手不能代为批准。",
            );
          return JSON.parse(
            JSON.stringify(
              await withTrace("dsh-model", () => operation.run(args)),
            ),
          );
        },
      }),
    );
  ctx.effect(() =>
    ctx.commands.register({
      name: "resume-grill",
      description: "求职资料、简历核对与投递确认",
      input: { hint: "由求职卡片填写操作参数" },
      handler: async ({ rawInput, agent, signal }: any) =>
        withTrace("dsh-human", async () => {
        try {
          signal.throwIfAborted();
          const {
            cardId,
            surface: _surface,
            ...input
          } = rawInput.trim() ? JSON.parse(rawInput) : { action: "workspace" };
          if (input.action === "website-fill") {
            requireCapability(workspace, "website");
            const request = websiteFillAction.safeParse(input);
            if (!request.success) throw new Error("官网代填缺少简历或岗位，请重新打开岗位卡片再试。");
            const { resumeId, jobId, goalId, approvalId } = request.data;
            if (!websiteFill) throw new Error("当前宿主未启用内置官网代填。");
            reviewView(workspace, resumeId, jobId, undefined, goalId);
            const result = await websiteFill.fill(resumeId, jobId, signal, approvalId);
            return {
              kind: "success",
              text: JSON.stringify(reviewView(workspace, resumeId, jobId, undefined, goalId, result.notice, result.approvalId)),
            };
          }
          if (input.action === "browser-check") {
            requireCapability(workspace, "website");
            if (typeof input.jobId !== "string")
              throw new Error("请从「招聘官网」打开具体岗位后，再使用官网代填。");
            requireCompanyWebsite(workspace.store.get<Job>("job", input.jobId).sourceUrl);
            if (typeof input.resumeId !== "string")
              throw new Error("请先选择简历。");
            new ResumeProfiles(workspace).confirmed(input.resumeId);
            if (!ctx.tools.resolve)
              throw new Error("当前 DSH 版本无法检查官网代填工具。你仍可打开招聘官网手动申请。");
            const tools = await ctx.tools.resolve({
              agent,
              modelSelection: agent.model.current(),
              signal,
            });
            try {
              return {
                kind: "success",
                text: JSON.stringify({
                  tools: requireBrowserTools([...tools.view(agent).keys()]),
                }),
              };
            } finally {
              tools.dispose();
            }
          }
          if (input.action === "import-upload") {
            const receiptId = z.string().min(1).max(300).parse(input.receiptId);
            if (!importUpload) throw new Error("当前宿主不支持文件上传。");
            const imported = (await importUpload(agent, receiptId)) as {
              id: string;
            };
            return {
              kind: "success",
              text: JSON.stringify({
                ...workspaceView(workspace),
                importedResumeId: imported.id,
              }),
            };
          }
          if (input.action === "capability-status")
            return {
              kind: "success",
              text: JSON.stringify({ capabilities: workspace.capabilities }),
            };
          if (input.action === "test-mail") {
            requireCapability(workspace, "mail");
            if (!verifyMail) throw new Error("此宿主未提供邮箱连接检查。");
            return {
              kind: "success",
              text: JSON.stringify(await verifyMail()),
            };
          }
          if (input.action === "workspace") await refreshMail?.().catch(() => {});
          if (input.action === "send") await refreshMail?.();
          const view = cardId
            ? await cardAction(workspace, agent.id, cardId, input)
            : input.action === "restore"
              ? await restoreView(workspace, input.reference)
              : await humanAction(workspace, input);
          // inject records the result for the next turn; it does not wake a paid model.
          if (
            input.action !== "restore" &&
            input.action !== "application" &&
            input.action !== "batch-view" &&
            (view?.kind === "application" || view?.kind === "batch")
          )
            agent.inject({
              id: randomUUID(),
              role: "user",
              source: {
                kind: "resume-grill",
                form: "notice",
                summary: "求职操作结果已更新",
              },
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    view.kind === "application"
                      ? {
                          applicationId: view.application.id,
                          status: view.application.status,
                          recipient: view.application.recipient,
                        }
                      : { batch: view.batch },
                  ),
                },
              ],
            });
          return { kind: "success", text: JSON.stringify(view) };
        } catch (error) {
          return {
            kind: "error",
            text: error instanceof Error ? error.message : "求职操作失败。",
          };
        }
      }),
    }),
  );
  for (const section of promptSectionsFor(workspace.capabilities))
    ctx.effect(() =>
      ctx.systemPrompt.section({
        name: section.name,
        order: section.order,
        text: section.text,
      }),
    );
}
export async function apply(ctx: Context, config: any) {
  const active = activeCapabilities(config?.disabledCapabilities);
  const store = new Store(
    resolve(
      process.env.RESUME_AGENT_HOME ??
        join(
          process.env.DSH_HOME ?? join(homedir(), ".dsh"),
          "storages",
          "resume-grill",
        ),
    ),
  );
  ctx.effect(() => () => store.close());
  const mail = active.includes("mail")
    ? await nativeMail(ctx, config)
    : undefined;
  if (typeof (ctx as any).settings.configure === "function")
    ctx.effect(() => (ctx as any).settings.configure({ auto: false }));
  const workspace = new Workspace(store, mail?.send, mail?.enabled, active);
  if (hasCapability(active, "boss")) {
    const executor = new BossExecutor(join(store.home, "boss-executor"));
    new Boss(workspace).useExecutor(executor);
    ctx.effect(() => () => {
      void executor.close().catch(() => {});
    });
  }
  const website = hasCapability(active, "website")
    ? new WebsiteBrowser(join(store.home, "website-browser"))
    : undefined;
  if (website) ctx.effect(() => () => { void website.close().catch(() => {}); });
  mount(ctx, workspace, mail?.verify, mail?.refresh,
    (agent, receiptId) => importStagedResume(ctx, workspace, agent, receiptId),
    website && new WebsiteFill(workspace, (jobId, url) => website.open(jobId, url)),
  );
}
