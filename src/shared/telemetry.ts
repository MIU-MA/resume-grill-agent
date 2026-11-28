import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export type CallerChannel =
  | "mcp"
  | "dsh-model"
  | "dsh-human"
  | "panel"
  | "cli"
  | "internal";

export type TraceContext = {
  traceId: string;
  caller: CallerChannel;
  startedAt: number;
};

const traceStorage = new AsyncLocalStorage<TraceContext>();

export function currentTrace(): TraceContext | undefined {
  return traceStorage.getStore();
}

export function withTrace<T>(
  caller: CallerChannel,
  fn: () => T,
  traceId = currentTrace()?.traceId ?? randomUUID(),
): T {
  return traceStorage.run({ traceId, caller, startedAt: Date.now() }, fn);
}

const SAFE_AUDIT_KEYS = new Set([
  "id",
  "jobId",
  "resumeId",
  "goalId",
  "scanId",
  "runId",
  "proposalId",
  "dryRun",
  "budget",
  "recruitment",
  "keepOriginal",
]);

const SAFE_ID_PATTERN = /^[A-Za-z0-9_:-]{1,80}$/;

/**
 * Produce a strictly allowlisted summary of tool arguments for local audit logs.
 * Never persists resume text, JD body, email body/recipients, tokens, or file contents.
 */
export function sanitizeAuditArgs(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  const record = args as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (SAFE_AUDIT_KEYS.has(key)) {
      if (typeof value === "number" || typeof value === "boolean") {
        summary[key] = value;
      } else if (typeof value === "string") {
        summary[key] = SAFE_ID_PATTERN.test(value) ? value : "<redacted>";
      }
      continue;
    }
    if ((key === "url" || key === "sourceUrl") && typeof value === "string") {
      try {
        summary.host = new URL(value).hostname;
      } catch {
        summary.host = "invalid-url";
      }
      continue;
    }
    if (Array.isArray(value) && ["choices", "deliveryIds", "accepted", "fields", "values", "keywords", "directions"].includes(key)) {
      summary[`${key}Count`] = value.length;
    }
  }
  return summary;
}
