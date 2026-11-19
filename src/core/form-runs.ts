import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Workspace } from "./workspace.js";
import { applicationFormContext } from "./application-forms.js";
import { requireCompanyWebsite } from "../domain/boss.js";
import {
  formFieldSchema,
  matchFormField,
  normalizeFormValue,
} from "../domain/form-fields.js";
export type FormRun = {
  id: string;
  resumeId: string;
  jobId: string;
  profileId: string;
  attachmentHash: string;
  origin: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
  verifiedRevision?: number;
  status:
    | "inspecting"
    | "filling"
    | "needs_input"
    | "needs_review"
    | "ready"
    | "stale";
  actions: Array<{
    uid: string;
    label: string;
    value: string;
    path: string;
    write: boolean;
  }>;
  uploads: Array<{ uid: string; path: string; name: string; write: boolean }>;
  issues: Array<{
    uid: string;
    label: string;
    reason: string;
    required: boolean;
  }>;
  checks: Array<{
    uid: string;
    label: string;
    status: "matched" | "missing" | "mismatch";
    attempt: number;
  }>;
  attempts: Record<string, number>;
};
export const observedFields = z
  .array(formFieldSchema)
  .max(200)
  .refine(
    (rows) => new Set(rows.map((f) => f.uid)).size === rows.length,
    "字段 UID 不能重复",
  );
export class FormRuns {
  constructor(readonly workspace: Workspace) {}
  private put(run: FormRun) {
    run.updatedAt = Math.max(Date.now(), run.updatedAt + 1);
    this.workspace.store.put("form-run", run);
    return run;
  }
  async start(resumeId: string, jobId: string) {
    const context = await applicationFormContext(
      this.workspace,
      resumeId,
      jobId,
    );
    const origin = new URL(context.url).origin;
    return this.workspace.store.transaction(() => {
      const existing = this.workspace.store
        .list<FormRun>("form-run")
        .find(
          (r) =>
            r.resumeId === resumeId &&
            r.jobId === jobId &&
            r.origin === origin &&
            r.profileId === context.profileId &&
            r.attachmentHash === context.attachment.sha256 &&
            r.status !== "stale",
        );
      if (existing) return existing;
      const now = Date.now();
      return this.put({
        id: randomUUID(),
        resumeId,
        jobId,
        profileId: context.profileId,
        attachmentHash: context.attachment.sha256,
        origin,
        createdAt: now,
        updatedAt: now,
        revision: 0,
        status: "inspecting",
        actions: [],
        uploads: [],
        issues: [],
        checks: [],
        attempts: {},
      });
    });
  }
  private async active(id: string) {
    const run = this.workspace.store.get<FormRun>("form-run", id);
    try {
      const context = await applicationFormContext(
        this.workspace,
        run.resumeId,
        run.jobId,
      );
      if (
        context.profileId !== run.profileId ||
        context.attachment.sha256 !== run.attachmentHash ||
        new URL(context.url).origin !== run.origin
      )
        throw new Error("资料或附件已变化");
      return { run, context };
    } catch (error) {
      this.put({ ...run, status: "stale" });
      throw new Error("填写任务已失效，请按当前资料重新开始。", {
        cause: error,
      });
    }
  }
  async plan(id: string, url: string, input: unknown) {
    requireCompanyWebsite(url);
    const { run, context } = await this.active(id),
      fields = observedFields.parse(input);
    if (new URL(url).origin !== run.origin) {
      return this.put({
        ...run,
        status: "needs_review",
        actions: [],
        uploads: [],
        checks: [],
        issues: [
          {
            uid: "origin",
            label: "申请网站",
            reason: "申请域名发生变化，需要用户核对；没有生成填写动作",
            required: true,
          },
        ],
      });
    }
    const actions: FormRun["actions"] = [],
      uploads: FormRun["uploads"] = [],
      issues: FormRun["issues"] = [];
    for (const field of fields) {
      const match = matchFormField(field, context.profile);
      const issue = (reason: string) =>
        issues.push({
          uid: field.uid,
          label: field.label,
          reason,
          required: field.required,
        });
      if (match.path === "attachment") {
        const selected =
          field.value.replaceAll("\\", "/").split("/").at(-1) ?? "";
        const basename = context.attachment.path
          .replaceAll("\\", "/")
          .split("/")
          .at(-1);
        const empty =
          !selected ||
          /^(未选择文件|no file chosen|no file selected)$/i.test(selected);
        if (
          !empty &&
          selected !== context.attachment.name &&
          selected !== basename
        ) {
          issue("已有其他附件，需要用户核对，未替换");
          continue;
        }
        if (empty && (run.attempts.attachment ?? 0) >= 2) {
          issue("附件已检查失败两次，停止自动重试");
          continue;
        }
        uploads.push({
          uid: field.uid,
          path: context.attachment.path,
          name: context.attachment.name,
          write: empty,
        });
        continue;
      }
      if (!match.value || !match.path) {
        issue(match.reason ?? "缺少资料");
        continue;
      }
      const currentValue =
        field.type === "select" &&
        /^(请选择(?:.*)?|请选择|选择学历|select(?: an? option)?|choose(?: an? option)?)$/i.test(
          field.value.trim(),
        )
          ? ""
          : field.value;
      let value = match.value;
      if (field.type === "select") {
        const matching = field.options.filter(
          (option) =>
            normalizeFormValue(option, match.path!) ===
            normalizeFormValue(value, match.path!),
        );
        if (matching.length !== 1) {
          issue("下拉选项没有唯一匹配值，需要用户核对");
          continue;
        }
        value = matching[0];
      }
      if (
        currentValue &&
        normalizeFormValue(currentValue, match.path) !==
          normalizeFormValue(value, match.path)
      ) {
        issue("页面已有不同内容，未覆盖");
        continue;
      }
      if (
        (run.attempts[match.path] ?? 0) >= 2 &&
        normalizeFormValue(currentValue, match.path) !==
          normalizeFormValue(value, match.path)
      ) {
        issue("已检查失败两次，停止自动重试");
        continue;
      }
      actions.push({
        uid: field.uid,
        label: field.label,
        value,
        path: match.path,
        write: !normalizeFormValue(currentValue, match.path),
      });
    }
    if (!fields.length)
      issues.push({
        uid: "form",
        label: "申请表",
        reason: "未读取到字段；请检查登录、验证码或页面加载状态",
        required: true,
      });
    if (uploads.length > 1) {
      issues.push({
        uid: "attachment",
        label: "简历附件",
        reason: "存在多个简历入口，需要用户选择",
        required: true,
      });
      uploads.length = 0;
    }
    return this.put({
      ...run,
      revision: (run.revision ?? 0) + 1,
      actions,
      uploads,
      issues,
      checks: [],
      status: issues.some((i) => /已有|多个|没有唯一|两次/.test(i.reason))
        ? "needs_review"
        : issues.some((i) => i.required)
          ? "needs_input"
          : "filling",
    });
  }
  async verify(
    id: string,
    url: string,
    values: Array<{ uid: string; value: string }>,
    uploadedName?: string,
  ) {
    requireCompanyWebsite(url);
    const { run } = await this.active(id);
    if (new URL(url).origin !== run.origin)
      throw new Error("回读域名与填写任务不一致");
    const seen = new Map(values.map((f) => [f.uid, f.value]));
    if (seen.size !== values.length) throw new Error("回读 UID 重复");
    const attempts = { ...run.attempts };
    const failedPaths = new Set<string>();
    const recordFailure = (path: string) => {
      if (run.verifiedRevision === run.revision || failedPaths.has(path)) return;
      failedPaths.add(path);
      attempts[path] = (attempts[path] ?? 0) + 1;
    };
    const checks: FormRun["checks"] = run.actions.map((action) => {
      const value = seen.get(action.uid);
      const status =
        value === undefined || !value
          ? "missing"
          : normalizeFormValue(value, action.path) ===
              normalizeFormValue(action.value, action.path)
            ? "matched"
            : "mismatch";
      if (status !== "matched") recordFailure(action.path);
      return {
        uid: action.uid,
        label: action.label,
        status,
        attempt: attempts[action.path] ?? 0,
      };
    });
    if (run.uploads.length) {
      const expected = run.uploads[0];
      const basename = expected.path.replaceAll("\\", "/").split("/").at(-1);
      const matched = uploadedName === expected.name || uploadedName === basename;
      if (!matched) recordFailure("attachment");
      checks.push({
        uid: expected.uid,
        label: "简历附件",
        status: matched ? "matched" : uploadedName ? "mismatch" : "missing",
        attempt: attempts.attachment ?? 0,
      });
    }
    const blocked = run.issues.some((i) => i.required);
    const status =
      checks.some((c) => c.status !== "matched" && (c.status === "mismatch" || c.attempt >= 2)) ||
      run.issues.some((i) => /已有|多个|没有唯一|两次|域名/.test(i.reason))
        ? "needs_review"
        : checks.some((c) => c.status !== "matched") || blocked
          ? "needs_input"
          : run.actions.length || run.uploads.length
            ? "ready"
            : "needs_input";
    return this.put({
      ...run,
      verifiedRevision: run.revision,
      checks,
      attempts,
      status,
    });
  }
}
