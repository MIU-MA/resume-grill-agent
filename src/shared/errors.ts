import { z } from "zod";

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CAPABILITY_DISABLED"
  | "APPROVAL_REQUIRED"
  | "SSRF_BLOCKED"
  | "INTEGRITY_FAILED"
  | "CONFLICT"
  | "RATE_OR_BUDGET_EXCEEDED"
  | "EXTERNAL_FAILED"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly retryable = false,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "AppError";
  }
}

/**
 * Map both explicit AppError and existing domain/infrastructure Chinese errors
 * to stable machine-readable error codes without breaking human-facing messages.
 */
export function classifyError(error: unknown): {
  code: ErrorCode;
  retryable: boolean;
  message: string;
} {
  if (error instanceof AppError) {
    return {
      code: error.code,
      retryable: error.retryable,
      message: error.message,
    };
  }
  if (error instanceof z.ZodError) {
    return {
      code: "VALIDATION_ERROR",
      retryable: false,
      message: error.issues.map((issue) => issue.message).join("；"),
    };
  }
  const message = error instanceof Error ? error.message : "操作失败。";
  if (/公网地址|内网|HTTPS 地址|跳转次数过多|跳转地址|跨站|跳转到其他网站/.test(message)) {
    return { code: "SSRF_BLOCKED", retryable: false, message };
  }
  if (/缺少人工确认|确认已过期|不能代为批准|尚未启用|未配置真实发件邮箱/.test(message)) {
    return { code: "APPROVAL_REQUIRED", retryable: false, message };
  }
  if (/未启用.*能力|禁用/.test(message)) {
    return { code: "CAPABILITY_DISABLED", retryable: false, message };
  }
  if (/校验失败|已改变|已变化|已变更|篡改/.test(message)) {
    return { code: "INTEGRITY_FAILED", retryable: false, message };
  }
  if (/限额|超过|过大|最多|上限/.test(message)) {
    return { code: "RATE_OR_BUDGET_EXCEEDED", retryable: false, message };
  }
  if (/不存在/.test(message)) {
    return { code: "NOT_FOUND", retryable: false, message };
  }
  if (/已执行|不能重复|已有.*记录|已被.*处理|已被更新|状态已改变|正在进行|正在填写/.test(message)) {
    return { code: "CONFLICT", retryable: false, message };
  }
  if (/超时|连接失败|未响应|中断|HTTP\s*\d{3}|未能|无法读取/.test(message)) {
    return { code: "EXTERNAL_FAILED", retryable: true, message };
  }
  return { code: "INTERNAL_ERROR", retryable: false, message };
}
