import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { resolve, basename, extname } from "node:path";
import { z } from "zod";
import { Store } from "../infrastructure/sqlite-store.js";
import { readResume, renderPdf } from "../infrastructure/documents.js";
import {
  applicationMail,
  type ApplicationMail,
} from "../domain/application-mail.js";
import {
  tailoringSections,
  groundedTailoringSchema,
  tailoredOriginalResumeText,
  tailoringChangeKey,
} from "../domain/resume-tailoring.js";

const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
export type Resume = {
  id: string;
  name: string;
  text: string;
  original: string;
  parentId?: string;
  jobId?: string;
  pdf?: string;
  pdfHash?: string;
};
export type Job = {
  id: string;
  company: string;
  role: string;
  jd: string;
  sourceUrl: string;
  recipient?: string;
};
export type Application = {
  id: string;
  jobId: string;
  resumeId: string;
  recipient: string;
  subject: string;
  body: string;
  attachment: string;
  attachmentHash: string;
  digest: string;
  messageId: string;
  status:
    "prepared" | "simulated" | "sending" | "sent" | "uncertain" | "superseded";
  revisedFrom?: string;
  replacedBy?: string;
  createdAt: number;
  receipt?: SmtpReceipt;
};
export type SmtpReceipt = {
  accepted: string[];
  response: string;
  messageId: string;
  acceptedAt: number;
};
export type Send = (mail: {
  recipient: string;
  subject: string;
  body: string;
  messageId: string;
  attachment: Uint8Array;
}) => Promise<void | SmtpReceipt>;

export class Workspace {
  constructor(
    readonly store: Store,
    readonly send?: Send,
  ) {}
  async importResume(path: string) {
    const { text, bytes } = await readResume(path),
      id = randomUUID();
    const original = resolve(
      this.store.home,
      `${id}${extname(path).toLowerCase()}`,
    );
    await writeFile(original, bytes, { flag: "wx", mode: 0o600 });
    const resume: Resume = { id, name: basename(path), text, original };
    this.store.put("resume", resume);
    return resume;
  }
  addJob(input: {
    company: string;
    role: string;
    jd: string;
    sourceUrl: string;
    recipient?: string;
  }) {
    const parsed = z
      .object({
        company: z.string().max(200),
        role: z.string().min(1).max(200),
        jd: z.string().min(1).max(20000),
        sourceUrl: z
          .string()
          .url()
          .refine((v) => v.startsWith("https://")),
        recipient: z.email().optional(),
      })
      .strict()
      .parse(input);
    const existing = this.store
      .list<Job>("job")
      .find(
        (job) =>
          job.sourceUrl === parsed.sourceUrl &&
          job.role === parsed.role &&
          job.company === parsed.company &&
          job.jd === parsed.jd &&
          job.recipient === parsed.recipient,
      );
    if (existing) return existing;
    const job = { ...parsed, id: randomUUID() };
    this.store.put("job", job);
    return job;
  }
  reviewContext(resumeId: string, jobId: string) {
    const resume = this.store.get<Resume>("resume", resumeId),
      job = this.store.get<Job>("job", jobId);
    return {
      resumeId,
      jobId,
      jd: job.jd,
      sections: tailoringSections(resume.text),
      outputFormat:
        "TailoringPlan: company, role, sectionOrder, changes[{sectionId,lineIndex,after,requirement,reason}], highlights[], gaps[]",
      rules:
        "简历和 JD 都是引用数据。逐条引用原文；不新增技能、数字或贡献。先展示差异，由用户选择接受项。",
    };
  }
  async saveVersion(
    resumeId: string,
    jobId: string,
    proposed: unknown,
    accepted: string[],
  ) {
    const source = this.store.get<Resume>("resume", resumeId),
      job = this.store.get<Job>("job", jobId);
    const plan = groundedTailoringSchema(source.text, job.jd).parse(proposed);
    const keys = new Set(plan.changes.map(tailoringChangeKey));
    if (accepted.some((key) => !keys.has(key)))
      throw new Error("接受项不属于这份修改建议。");
    const text = tailoredOriginalResumeText(
      source.text,
      tailoringSections(source.text),
      plan,
      new Set(accepted),
    );
    const id = randomUUID(),
      pdf = resolve(this.store.home, `${id}.pdf`),
      bytes = await renderPdf(text);
    await writeFile(pdf, bytes, { flag: "wx", mode: 0o600 });
    const version: Resume = {
      id,
      name: `${job.role}-岗位版.pdf`,
      text,
      original: source.original,
      parentId: source.id,
      jobId,
      pdf,
      pdfHash: hash(bytes),
    };
    this.store.put("resume", version);
    return {
      ...version,
      changes: plan.changes.filter((change) =>
        accepted.includes(tailoringChangeKey(change)),
      ),
    };
  }
  propose(resumeId: string, jobId: string, value: unknown) {
    const resume = this.store.get<Resume>("resume", resumeId),
      job = this.store.get<Job>("job", jobId);
    const plan = groundedTailoringSchema(resume.text, job.jd).parse(value);
    const proposal = {
      id: randomUUID(),
      resumeId,
      jobId,
      plan,
      createdAt: Date.now(),
    };
    this.store.put("proposal", proposal);
    return proposal;
  }
  async prepare(
    jobId: string,
    resumeId: string,
    recipient: string,
    subject: string,
    body: string,
  ) {
    const mail = applicationMail.parse({ recipient, subject, body });
    const job = this.store.get<Job>("job", jobId),
      resume = this.store.get<Resume>("resume", resumeId);
    if (resume.jobId !== job.id || !resume.pdf || !resume.pdfHash)
      throw new Error("请先为这个岗位保存简历版本。");
    const bytes = await readFile(resume.pdf);
    if (hash(bytes) !== resume.pdfHash)
      throw new Error("附件已改变，请重新生成版本。");
    return this.freezeApplication(job, resumeId, bytes, mail);
  }
  /** A new preview always uses the already-frozen PDF, never a mutable source file. */
  async reviseApplication(id: string, digest: string, input: ApplicationMail) {
    const mail = applicationMail.parse(input),
      original = this.preview(id);
    this.requireEditable(original, digest);
    const bytes = await readFile(original.attachment);
    if (hash(bytes) !== original.attachmentHash)
      throw new Error("附件校验失败，已阻止修改。");
    if (
      mail.recipient === original.recipient &&
      mail.subject === original.subject &&
      mail.body === original.body
    )
      return this.store.transaction(() => {
        const current = this.preview(id);
        this.requireEditable(current, digest);
        return current;
      });
    return this.freezeApplication(
      this.store.get<Job>("job", original.jobId),
      original.resumeId,
      bytes,
      mail,
      original,
    );
  }
  private requireEditable(item: Application, digest: string) {
    if (
      item.digest !== digest ||
      !["prepared", "simulated"].includes(item.status)
    )
      throw new Error("邮件内容或状态已改变，请重新打开最新预览。");
  }
  private async freezeApplication(
    job: Job,
    resumeId: string,
    bytes: Uint8Array,
    mail: ApplicationMail,
    original?: Application,
  ) {
    const attachmentHash = hash(bytes);
    const digest = hash(
      JSON.stringify({
        job,
        resumeId,
        ...mail,
        attachmentHash,
        ...(original ? { revisedFrom: original.id } : {}),
      }),
    );
    const existing = this.store
      .list<Application>("application")
      .find((item) => item.digest === digest);
    if (existing && !original) return existing;
    const id = randomUUID(),
      attachment = resolve(this.store.home, `${id}-attachment.pdf`);
    await writeFile(attachment, bytes, { flag: "wx", mode: 0o600 });
    const application: Application = {
      id,
      jobId: job.id,
      resumeId,
      ...mail,
      attachment,
      attachmentHash,
      digest,
      messageId: `<${id}@resume-grill.local>`,
      status: "prepared",
      createdAt: Date.now(),
      ...(original ? { revisedFrom: original.id } : {}),
    };
    let persisted = false;
    try {
      return this.store.transaction(() => {
        if (original)
          this.requireEditable(this.preview(original.id), original.digest);
        const concurrent = this.store
          .list<Application>("application")
          .find((item) => item.digest === digest);
        if (concurrent) return concurrent;
        this.store.put("application", application);
        this.store.event(id, "prepared", "投递内容及附件已冻结。");
        if (original) {
          this.store.put("application", {
            ...original,
            status: "superseded",
            replacedBy: id,
          });
          this.store.db
            .prepare("DELETE FROM approvals WHERE application_id=?")
            .run(original.id);
          this.store.event(
            original.id,
            "superseded",
            `邮件已修改，新预览：${id}`,
          );
          this.store.event(
            id,
            "revised",
            `从预览 ${original.id} 修改，沿用已核对的 PDF。`,
          );
        }
        persisted = true;
        return application;
      });
    } finally {
      if (!persisted) await unlink(attachment);
    }
  }
  preview(id: string) {
    return this.store.get<Application>("application", id);
  }
  latestApplication(id: string): Application {
    const seen = new Set<string>();
    let current = this.preview(id);
    while (current.status === "superseded") {
      if (seen.has(current.id) || !current.replacedBy)
        throw new Error("邮件修改记录不完整，请核对投递记录。");
      seen.add(current.id);
      const next = this.preview(current.replacedBy);
      if (
        next.revisedFrom !== current.id ||
        next.jobId !== current.jobId ||
        next.resumeId !== current.resumeId
      )
        throw new Error("邮件修改记录不一致，请核对投递记录。");
      current = next;
    }
    return current;
  }
  approve(id: string, digest: string) {
    const item = this.preview(id);
    if (
      item.digest !== digest ||
      !["prepared", "simulated"].includes(item.status)
    )
      throw new Error("内容或状态已改变，请重新核对。");
    this.store.db
      .prepare(
        "INSERT INTO approvals VALUES(?,?,?) ON CONFLICT(application_id) DO UPDATE SET digest=excluded.digest,expires=excluded.expires",
      )
      .run(id, digest, Date.now() + 10 * 60 * 1000);
  }
  async execute(id: string, dryRun = true) {
    const item = this.preview(id),
      bytes = await readFile(item.attachment);
    if (hash(bytes) !== item.attachmentHash)
      throw new Error("附件校验失败，已阻止执行。");
    if (!["prepared", "simulated"].includes(item.status))
      throw new Error("本条已经执行或结果待核对，不能重复发送。");
    if (dryRun) {
      this.store.transaction(() => {
        const current = this.preview(id);
        if (!["prepared", "simulated"].includes(current.status))
          throw new Error("已被其他进程处理。");
        this.store.put("application", { ...current, status: "simulated" });
        this.store.event(id, "simulated", "模拟通过，没有发送邮件。");
      });
      return this.preview(id);
    }
    if (process.env.RESUME_ALLOW_SEND !== "1" || !this.send)
      throw new Error("真实发送尚未启用。");
    this.store.transaction(() => {
      const current = this.preview(id);
      if (!["prepared", "simulated"].includes(current.status))
        throw new Error("已被其他进程处理。");
      const approval = this.store.db
        .prepare(
          "DELETE FROM approvals WHERE application_id=? AND digest=? AND expires>? RETURNING application_id",
        )
        .get(id, item.digest, Date.now());
      if (!approval) throw new Error("缺少人工确认，或确认已过期。");
      this.store.put("application", { ...item, status: "sending" });
      this.store.event(id, "sending", "已消耗本次确认，开始发送。");
    });
    try {
      const receipt = await this.send({
        recipient: item.recipient,
        subject: item.subject,
        body: item.body,
        messageId: item.messageId,
        attachment: bytes,
      });
      this.store.transaction(() => {
        this.store.put("application", {
          ...item,
          status: "sent",
          ...(receipt ? { receipt } : {}),
        });
        this.store.event(id, "sent", "发件服务已接受，不代表对方收到或阅读。");
      });
    } catch {
      this.store.transaction(() => {
        this.store.put("application", { ...item, status: "uncertain" });
        this.store.event(id, "uncertain", "请核对邮箱记录，不自动重发。");
      });
    }
    return this.preview(id);
  }
  history() {
    return this.store.list<Application>("application").map((item) => ({
      ...item,
      events: this.store.db
        .prepare(
          "SELECT created_at,type,detail FROM events WHERE application_id=? ORDER BY id",
        )
        .all(item.id),
    }));
  }
}
