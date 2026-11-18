import { z } from "zod";

export const bossUrl = z.string().url().refine(value => {
  const u = new URL(value);
  return u.origin === "https://www.zhipin.com" && /^\/job_detail\/[^/]+\.html$/.test(u.pathname) && !u.search && !u.hash && !u.username && !u.password;
}, "需要 BOSS 的具体岗位链接");
export const bossJob = z.object({ url: bossUrl, title: z.string().min(1).max(200), company: z.string().max(200), salary: z.string().max(200).default(""), description: z.string().max(20000).default("") });
export const bossInspection = z.object({ kind: z.enum(["detail", "login", "verification", "unknown"]), url: z.string(), title: z.string(), company: z.string(), description: z.string().max(20000), truncated: z.boolean(), matched: z.boolean(), blockers: z.array(z.string()) });
export type BossScan = { id: string; readId: string; createdAt: number; jobs: z.infer<typeof bossJob>[]; blocked?: string };
export const bossStep = z.object({ id: z.string(), kind: z.enum(["contact", "greeting", "image"]), value: z.string(), state: z.enum(["pending", "sending", "verified", "uncertain"]), receipt: z.string().optional(), source: z.literal("platform").optional() });
export const bossRun = z.object({ id: z.string().uuid(), mode: z.literal("boss"), state: z.enum(["running", "paused", "finished", "failed"]), createdAt: z.number(), updatedAt: z.number(), tasks: z.array(z.object({ url: bossUrl, title: z.string(), company: z.string(), state: z.enum(["queued", "running", "verified", "failed", "uncertain"]), error: z.string().optional(), steps: z.array(bossStep) })) });
export type BossRun = z.infer<typeof bossRun>;
