import { randomUUID } from "node:crypto";
import type { Workspace } from "./workspace.js";
import type { Capability } from "../shared/capabilities.js";
import { classifyError } from "../shared/errors.js";
import {
  currentTrace,
  sanitizeAuditArgs,
  withTrace,
} from "../shared/telemetry.js";
import { baseOperations } from "./operations/base.js";
import { bossOperations } from "./operations/boss.js";
import { mailOperations } from "./operations/mail.js";
import { websiteOperations } from "./operations/website.js";
import {
  operationModule,
  type Operation,
  type OperationModule,
} from "./operations/module.js";

export type { Operation } from "./operations/module.js";

const modules = {
  boss: bossOperations,
  mail: mailOperations,
  website: websiteOperations,
} satisfies Record<Capability, (workspace: Workspace) => OperationModule>;

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function instrumentOperation(workspace: Workspace, op: Operation): Operation {
  return {
    ...op,
    run: (args: unknown) => {
      const execute = () => {
        const trace = currentTrace();
        const traceId = trace?.traceId ?? randomUUID();
        const caller = trace?.caller ?? "internal";
        const started = performance.now();
        const summary = sanitizeAuditArgs(args);
        const recordOk = () => {
          try {
            workspace.store.recordToolAudit({
              traceId,
              caller,
              toolName: op.name,
              readOnly: op.readOnly,
              status: "ok",
              durationMs: performance.now() - started,
              summary,
            });
          } catch {
            /* Audit recording must never break a completed tool invocation. */
          }
        };
        const recordErr = (error: unknown) => {
          try {
            const classified = classifyError(error);
            workspace.store.recordToolAudit({
              traceId,
              caller,
              toolName: op.name,
              readOnly: op.readOnly,
              status: "error",
              errorCode: classified.code,
              durationMs: performance.now() - started,
              summary,
            });
          } catch {
            /* Audit recording must never mask the primary domain error. */
          }
        };
        try {
          const result = op.run(args);
          if (isPromiseLike(result)) {
            return Promise.resolve(result).then(
              (resolved) => {
                recordOk();
                return resolved;
              },
              (error) => {
                recordErr(error);
                throw error;
              },
            );
          }
          recordOk();
          return result;
        } catch (error) {
          recordErr(error);
          throw error;
        }
      };
      return currentTrace() ? execute() : withTrace("internal", execute);
    },
  };
}

export function operations(workspace: Workspace) {
  const active = [
    baseOperations(workspace),
    ...workspace.capabilities.map((capability) =>
      modules[capability](workspace),
    ),
  ];
  const raw: Operation[] = [
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
  return raw.map((op) => instrumentOperation(workspace, op));
}
