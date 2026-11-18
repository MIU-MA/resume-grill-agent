import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, extname } from "node:path";
import { z } from "zod";
import type { Workspace, Job } from "./workspace.js";
import { Boss } from "./boss.js";
import { bossRun, bossUrl, type BossRun } from "../domain/boss.js";
import { resumeImages } from "../infrastructure/resume-images.js";
const hash = (v: string | Uint8Array) =>
  createHash("sha256").update(v).digest("hex");
export type BossDelivery = {
  id: string;
  jobId: string;
  resumeId: string;
  resumeName: string;
  company: string;
  role: string;
  url: string;
  jdHash: string;
  pdfPath: string;
  pdfHash: string;
  images: { path: string; name: string; sha256: string; size: number }[];
  digest: string;
  createdAt: number;
  updatedAt: number;
  status:
    "prepared" | "submitting" | "running" | "finished" | "paused" | "uncertain";
  previewId?: string;
  expiresAt?: number;
  remoteId: string;
  error?: string;
};
const previewSchema = z.object({
  id: z.string().min(1),
  batchId: z.string().uuid(),
  expiresAt: z.number(),
  greetingMode: z.literal("platform"),
  jobs: z
    .array(z.object({ url: bossUrl, title: z.string(), company: z.string() }))
    .length(1),
  images: z
    .array(
      z.object({
        name: z.string(),
        type: z.literal("image/png"),
        sha256: z.string(),
      }),
    )
    .min(1)
    .max(3),
  skipped: z.array(z.unknown()),
});

export class BossDeliveries {
  constructor(readonly workspace: Workspace) {}
  list() {
    return this.workspace.store.list<BossDelivery>("boss-delivery");
  }
  get(id: string) {
    return this.workspace.store.get<BossDelivery>("boss-delivery", id);
  }
  private save(d: BossDelivery) {
    d.updatedAt = Math.max(Date.now(), d.updatedAt + 1);
    this.workspace.store.put("boss-delivery", d);
    return d;
  }
  private async check(d: BossDelivery) {
    const resume = this.workspace.resume(d.resumeId),
      job = this.workspace.store.get<Job>("job", d.jobId);
    if (
      job.sourceUrl !== d.url ||
      hash(job.jd) !== d.jdHash ||
      (resume.pdf ?? resume.original) !== d.pdfPath ||
      hash(await readFile(d.pdfPath)) !== d.pdfHash
    )
      throw new Error("岗位或简历版本已变化，请重新准备并核对。");
    for (const image of d.images)
      if (hash(await readFile(image.path)) !== image.sha256)
        throw new Error("冻结的简历图片已变化，请重新准备。");
  }
  async validate(d: BossDelivery) {
    await this.check(d);
  }
  async prepare(resumeId: string, jobId: string) {
    const resume = this.workspace.resume(resumeId),
      job = this.workspace.store.get<Job>("job", jobId);
    bossUrl.parse(job.sourceUrl);
    if (resume.jobId && resume.jobId !== jobId)
      throw new Error("这份岗位简历属于其他 JD，请选择主简历或当前岗位版本。");
    const evidence = this.workspace.store
      .list<{ id: string; jobId: string; jdHash: string }>("boss-evidence")
      .find((e) => e.jobId === jobId);
    if (!evidence || evidence.jdHash !== hash(job.jd))
      throw new Error("请先从 BOSS 列表读取并核对完整 JD。");
    if (
      this.list().some(
        (d) => d.url === job.sourceUrl && d.status !== "prepared",
      )
    )
      throw new Error("本机已有执行或待核对记录，不准备重复联系。");
    const pdfPath = resume.pdf ?? resume.original;
    if (extname(pdfPath).toLowerCase() !== ".pdf")
      throw new Error("请先保存 PDF 简历版本再准备 BOSS 图片。");
    const rendered = await resumeImages(pdfPath);
    if (resume.pdfHash && rendered.pdfHash !== resume.pdfHash)
      throw new Error("简历 PDF 校验失败。");
    const digest = hash(
      JSON.stringify({
        resumeId,
        jobId,
        jd: job.jd,
        pdfHash: rendered.pdfHash,
        images: rendered.images.map((i) => i.sha256),
      }),
    );
    const existing = this.list().find(
      (d) => d.digest === digest && d.status === "prepared",
    );
    if (existing) {
      await this.check(existing);
      if ((existing.expiresAt ?? 0) > Date.now()) return existing;
      return this.preview(existing);
    }
    const id = randomUUID(),
      folder = join(this.workspace.store.home, "boss-images", id);
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const images = [];
    for (const [n, image] of rendered.images.entries()) {
      const name = `简历-${n + 1}.png`,
        path = join(folder, `${n + 1}.png`);
      await writeFile(path, image.bytes, { flag: "wx", mode: 0o600 });
      images.push({
        path,
        name,
        sha256: image.sha256,
        size: image.bytes.length,
      });
    }
    const now = Date.now();
    const d: BossDelivery = {
      id,
      jobId,
      resumeId,
      resumeName: resume.name,
      company: job.company,
      role: job.role,
      url: job.sourceUrl,
      jdHash: hash(job.jd),
      pdfPath,
      pdfHash: rendered.pdfHash,
      images,
      digest,
      createdAt: now,
      updatedAt: now,
      status: "prepared",
      remoteId: randomUUID(),
    };
    this.save(d);
    return this.preview(d);
  }
  async preview(d: BossDelivery) {
    if (d.status !== "prepared")
      throw new Error("已执行或结果不明的任务不能重新准备。");
    await this.check(d);
    const images = await Promise.all(
      d.images.map(async (i) => ({
        name: i.name,
        type: "image/png",
        sha256: i.sha256,
        base64: (await readFile(i.path)).toString("base64"),
      })),
    );
    const p = previewSchema.parse(
      await new Boss(this.workspace).gateway().request("/boss-batch/preview", {
        id: d.remoteId,
        jobs: [
          {
            url: d.url,
            title: d.role,
            company: d.company,
            greeting: "使用账号默认招呼；不追加自定义文字。",
          },
        ],
        images,
      }),
    );
    if (
      p.batchId !== d.remoteId ||
      p.jobs[0].url !== d.url ||
      p.jobs[0].company !== d.company ||
      p.jobs[0].title !== d.role ||
      p.skipped.length ||
      JSON.stringify(p.images.map((i) => i.sha256)) !==
        JSON.stringify(d.images.map((i) => i.sha256)) ||
      p.expiresAt <= Date.now()
    )
      throw new Error("执行器预览与当前岗位附件不一致，不能确认。");
    return this.workspace.store.transaction(() => {
      const current = this.get(d.id);
      if (current.status !== "prepared" || current.updatedAt !== d.updatedAt)
        throw new Error("预览期间任务状态已变化，请重新读取，不重复发送。");
      d.previewId = p.id;
      d.expiresAt = p.expiresAt;
      delete d.error;
      return this.save(d);
    });
  }
  /** Called only by the user command channel, never an MCP/model operation. */
  async confirm(id: string, digest: string) {
    const d = this.get(id);
    if (
      d.status !== "prepared" ||
      d.digest !== digest ||
      !d.previewId ||
      (d.expiresAt ?? 0) <= Date.now()
    )
      throw new Error("预览已过期或已执行，请重新核对；不要重复发送。");
    await this.check(d);
    // Atomic reservation prevents double clicks, multiple windows and other instances.
    this.workspace.store.transaction(() => {
      if (
        this.get(id).status !== "prepared" ||
        this.list().some(
          (o) => o.id !== id && o.url === d.url && o.status !== "prepared",
        )
      )
        throw new Error("此岗位已有执行记录，不重复联系。");
      d.status = "submitting";
      this.save(d);
    });
    try {
      const result = bossRun.parse(
        await new Boss(this.workspace)
          .gateway()
          .request("/boss-batch/confirm", {
            id: d.previewId,
            confirmed: true,
            defaultGreetingAccepted: true,
          }),
      );
      this.apply(d, result);
      return d;
    } catch {
      d.status = "uncertain";
      d.error = "执行请求结果不明确，请读取回执并检查官网；不会自动重发。";
      this.save(d);
      return d;
    }
  }
  private apply(d: BossDelivery, run: BossRun) {
    if (d.status === "finished" && run.state !== "finished")
      throw new Error("已完成记录不能回退为待执行。");
    if (
      run.id !== d.remoteId ||
      run.tasks.length !== 1 ||
      run.tasks[0].url !== d.url ||
      run.tasks[0].title !== d.role ||
      run.tasks[0].company !== d.company
    )
      throw new Error("批次身份不一致。");
    const task = run.tasks[0],
      verified = task.steps.every((s) => s.state === "verified" && !!s.receipt);
    const images = task.steps.filter((s) => s.kind === "image");
    if (
      run.state === "finished" &&
      !(
        task.state === "verified" &&
        verified &&
        task.steps.filter((s) => s.kind === "contact").length === 1 &&
        task.steps.filter(
          (s) => s.kind === "greeting" && s.source === "platform",
        ).length === 1 &&
        images.length === d.images.length &&
        images.every((s, n) => s.value === d.images[n].sha256)
      )
    )
      throw new Error("缺少匹配的招呼或图片回执，不能记为完成。");
    d.status =
      task.state === "uncertain"
        ? "uncertain"
        : run.state === "finished"
          ? "finished"
          : run.state === "running"
            ? "running"
            : "paused";
    delete d.error;
    this.save(d);
    this.workspace.store.put("boss-run", run);
  }
  async refresh(id: string) {
    const d = this.get(id);
    if (d.status === "prepared") return d;
    try {
      const run = await new Boss(this.workspace).refresh(d.remoteId);
      this.apply(d, run);
    } catch (error) {
      if (d.status !== "finished") {
        d.status = "uncertain";
        d.error = "未获得可靠回执，请在官网核对，不重复投递。";
        this.save(d);
      }
      throw error;
    }
    return d;
  }
  async pause(id: string) {
    const d = this.get(id);
    if (d.status === "prepared")
      throw new Error("该岗位还在等待确认，尚无需暂停。");
    const result = await new Boss(this.workspace).pause(d.remoteId);
    return { ...result, id };
  }
}
