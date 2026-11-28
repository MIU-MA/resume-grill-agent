import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { resolve, basename, extname } from "node:path";
import { z } from "zod";
import { Store } from "../infrastructure/sqlite-store.js";
import { readPdfHeaderPhoto, readResume, renderPdf } from "../infrastructure/documents.js";
import { capabilities as defaultCapabilities, type Capability } from "../shared/capabilities.js";
import {
  applicationMail,
  applicationAttachmentName,
  directMailDraft,
  type ApplicationMail,
} from "../domain/application-mail.js";
import { parseResumeProfile } from "../domain/resume-profile.js";
import { ResumeProfiles } from "./resume-profiles.js";
import {
  tailoringSections,
  tailoringRequirements,
  groundedTailoringSchema,
  tailoredOriginalResumeText,
  tailoringChangeKey,
} from "../domain/resume-tailoring.js";
import { auditResumeRisks } from "../domain/resume-risk-audit.js";
import { analyzeJdGap } from "../domain/jd-gap-analysis.js";
import { buildInterviewGrill } from "../domain/interview-grill.js";

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
  headerPhoto?: "copied" | "unidentified";
  sourcePages?: number;
  createdAt?: number;
  updatedAt?: number;
  deletedAt?: number;
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
  jobId?: string;
  resumeId: string;
  recipient: string;
  subject: string;
  body: string;
  attachment: string;
  attachmentName?: string;
  attachmentHash: string;
  digest: string;
  messageId: string;
  status:
    | "prepared"
    | "simulated"
    | "sending"
    | "sent"
    | "uncertain"
    | "superseded";
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
  attachmentName: string;
}) => Promise<void | SmtpReceipt>;

export class Workspace {
  constructor(
    readonly store: Store,
    readonly send?: Send,
    readonly sendEnabled?: () => boolean,
    readonly capabilities: readonly Capability[] = defaultCapabilities,
  ) {}
  listResumes(deleted = false) {
    return this.store
      .list<Resume>("resume")
      .filter((item) => Boolean(item.deletedAt) === deleted)
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }
  resume(id: string) {
    const item = this.store.get<Resume>("resume", id);
    if (item.deletedAt) throw new Error("这份简历已移到回收站，请先恢复。");
    return item;
  }
  renameResume(id: string, name: string) {
    const item = this.resume(id);
    name = z.string().trim().min(1).max(160).parse(name);
    const next = { ...item, name, updatedAt: Date.now() };
    this.store.put("resume", next);
    return next;
  }
  duplicateResume(id: string) {
    const item = this.resume(id),
      now = Date.now();
    const copy: Resume = {
      ...item,
      id: randomUUID(),
      parentId: item.id,
      name: `${item.name.replace(/\.[^.]+$/, "").slice(0, 140)}-副本${item.pdf ? ".pdf" : extname(item.original)}`,
      createdAt: now,
      updatedAt: now,
    };
    this.store.put("resume", copy);
    return copy;
  }
  trashResume(id: string) {
    const item = this.resume(id);
    // Versions and sent attachments may share the original. Keep bytes and
    // immutable references; only hide this record from active selections.
    this.store.put("resume", {
      ...item,
      deletedAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
  restoreResume(id: string) {
    const item = this.store.get<Resume>("resume", id);
    const { deletedAt, ...restored } = item;
    const next = { ...restored, updatedAt: Date.now() };
    this.store.put("resume", next);
    return next;
  }
  async createResume(name: string, text: string) {
    name = z.string().trim().min(1).max(160).parse(name);
    text = z.string().trim().min(1).max(30000).parse(text);
    const id = randomUUID(),
      pdf = resolve(this.store.home, `${id}.pdf`),
      bytes = await renderPdf(text);
    await writeFile(pdf, bytes, { flag: "wx", mode: 0o600 });
    const now = Date.now();
    const item: Resume = {
      id,
      name,
      text,
      original: pdf,
      pdf,
      pdfHash: hash(bytes),
      createdAt: now,
      updatedAt: now,
    };
    this.store.put("resume", item);
    return item;
  }
  async importResume(path: string) {
    const { text, bytes, pageCount } = await readResume(path),
      id = randomUUID();
    const original = resolve(
      this.store.home,
      `${id}${extname(path).toLowerCase()}`,
    );
    await writeFile(original, bytes, { flag: "wx", mode: 0o600 });
    const now = Date.now();
    const resume: Resume = {
      id,
      name: basename(path),
      text,
      original,
      ...(pageCount ? { sourcePages: pageCount } : {}),
      createdAt: now,
      updatedAt: now,
    };
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
    const resume = this.resume(resumeId),
      job = this.store.get<Job>("job", jobId);
    const riskAudit = auditResumeRisks(resume.text);
    const jdGapAnalysis = analyzeJdGap(resume.text, job.jd, job.role);
    const interviewGrill = buildInterviewGrill({
      resumeText: resume.text,
      job,
      riskAudit,
      jdGapAnalysis,
    });
    return {
      resumeId,
      jobId,
      jd: job.jd,
      job: { company: job.company, role: job.role },
      requirements: tailoringRequirements(job.jd),
      sections: tailoringSections(resume.text),
      riskAudit,
      jdGapAnalysis,
      interviewGrill,
      outputFormat:
        "TailoringPlan: company, role, sectionOrder, changes[{sectionId,lineIndex,after,requirement,requirementId?,reason}], highlights[], gaps[]",
      rules:
        "公司与职位使用 job 字段。requirement 可以概括岗位要求，requirementId 用 requirements 中对应证据的 ID。润色措辞可调整，同一段经历中已出现的技术可以复用。禁止新增未经证实的技能、数字或夸大主导词（如主导整体架构/零故障/千万级），缺口放入 gaps 请用户补充。结合 jdGapAnalysis 明确提示赛道差距与风险隔离（不把 API 调用包装成模型推理优化，不把单机实现硬包装成分布式存储），结合 riskAudit 提醒原简历高风险表述；用户需要面试演练时可基于 interviewGrill 展开三层追问。先展示差异，由用户选择接受项。",
    };
  }
  async saveVersion(
    resumeId: string,
    jobId: string,
    proposed: unknown,
    accepted: string[],
    options: { reuseExisting?: boolean } = {},
  ) {
    const source = this.resume(resumeId),
      job = this.store.get<Job>("job", jobId);
    const plan = groundedTailoringSchema(source.text, job.jd, { job, partial: true }).parse(proposed);
    const keys = new Set(plan.changes.map(tailoringChangeKey));
    if (accepted.some((key) => !keys.has(key)))
      throw new Error("所选修改不存在或依据不足，请核对后再保存。");
    const text = tailoredOriginalResumeText(
      source.text,
      tailoringSections(source.text),
      plan,
      new Set(accepted),
    );
    const findExisting = () =>
      this.listResumes().find(
        (entry) =>
          entry.parentId === source.id &&
          entry.jobId === jobId &&
          entry.text === text &&
          !!entry.pdf &&
          !!entry.pdfHash,
      );
    const matchedChanges = plan.changes.filter((change) =>
      accepted.includes(tailoringChangeKey(change)),
    );
    if (options.reuseExisting) {
      const existing = findExisting();
      if (existing) return { ...existing, changes: matchedChanges };
    }
    const id = randomUUID(),
      pdf = resolve(this.store.home, `${id}.pdf`),
      { bytes, headerPhoto } = await this.renderResumeVersion(source, text);
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
      ...(headerPhoto ? { headerPhoto } : {}),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    let persisted = false;
    try {
      const saved = this.store.transaction(() => {
        if (options.reuseExisting) {
          const concurrent = findExisting();
          if (concurrent) return concurrent;
        }
        this.store.put("resume", version);
        persisted = true;
        return version;
      });
      return {
        ...saved,
        changes: matchedChanges,
      };
    } finally {
      if (!persisted) await unlink(pdf).catch(() => {});
    }
  }
  propose(resumeId: string, jobId: string, value: unknown) {
    const resume = this.resume(resumeId),
      job = this.store.get<Job>("job", jobId);
    const plan = groundedTailoringSchema(resume.text, job.jd, { job, partial: true }).parse(value);
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
  async saveEditedResume(resumeId: string, text: string, jobId?: string) {
    z.string().trim().min(1).max(30000).parse(text);
    const source = this.resume(resumeId);
    const job = jobId ? this.store.get<Job>("job", jobId) : undefined;
    const id = randomUUID(),
      pdf = resolve(this.store.home, `${id}.pdf`),
      { bytes, headerPhoto } = await this.renderResumeVersion(source, text);
    await writeFile(pdf, bytes, { flag: "wx", mode: 0o600 });
    const version: Resume = {
      id,
      name: job
        ? `${job.role}-修改稿.pdf`
        : `${source.name.replace(/\.[^.]+$/, "")}-修改稿.pdf`,
      text,
      original: source.original,
      parentId: source.id,
      ...(jobId ? { jobId } : {}),
      pdf,
      pdfHash: hash(bytes),
      ...(headerPhoto ? { headerPhoto } : {}),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.store.put("resume", version);
    return version;
  }
  private async renderResumeVersion(source: Resume, text: string) {
    const current = source.pdf ?? source.original;
    if (text.replace(/\r\n?/g, "\n").trim() === source.text.replace(/\r\n?/g, "\n").trim() &&
        extname(current).toLowerCase() === ".pdf") {
      const bytes = await readFile(current);
      if (source.pdfHash && hash(bytes) !== source.pdfHash)
        throw new Error("原简历 PDF 已变化，请重新上传后再保存。");
      return { bytes, headerPhoto: source.headerPhoto };
    }
    const fromPdf = extname(source.original).toLowerCase() === ".pdf";
    const photo = fromPdf ? await readPdfHeaderPhoto(source.original).catch(() => undefined) : undefined;
    const headerPhoto: Resume["headerPhoto"] = photo ? "copied" : fromPdf ? "unidentified" : undefined;
    return {
      bytes: await renderPdf(text, { photo }),
      headerPhoto,
    };
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
      resume = this.resume(resumeId);
    if (resume.jobId !== job.id || !resume.pdf || !resume.pdfHash)
      throw new Error("请先为这个岗位保存简历版本。");
    const bytes = await readFile(resume.pdf);
    if (hash(bytes) !== resume.pdfHash)
      throw new Error("附件已改变，请重新生成版本。");
    return this.freezeApplication(job, resumeId, bytes, mail);
  }
  async prepareDirectMail(resumeId: string, recipient: string) {
    const resume = this.resume(resumeId);
    const job = resume.jobId ? this.store.get<Job>("job", resume.jobId) : undefined;
    const contact = this.mailContact(resume);
    const role = this.mailRole(resume, job);
    const mail = applicationMail.parse({
      recipient,
      ...directMailDraft(contact, role),
    });
    const path = resume.pdf ?? resume.original;
    const bytes = extname(path).toLowerCase() === ".pdf"
      ? await readFile(path)
      : await renderPdf(resume.text, { updateMetadata: false });
    if (resume.pdfHash && hash(bytes) !== resume.pdfHash)
      throw new Error("附件已改变，请重新生成版本。");
    return this.freezeApplication(undefined, resumeId, bytes, mail, {
      attachmentName: applicationAttachmentName(role, contact, resume.name),
    });
  }
  private mailContact(resume: Resume) {
    const profiles = new ResumeProfiles(this);
    const profile = profiles.current(resume.id);
    return profile?.confirmedAt ? profile.data.contact : parseResumeProfile(resume.text).contact;
  }
  private mailRole(resume: Resume, job?: Job) {
    const role = job?.role ?? (resume.jobId ? this.store.get<Job>("job", resume.jobId).role : undefined);
    return role || resume.text.match(/^(?:求职意向|应聘岗位|求职方向)\s*[:：][ \t]*([^\r\n|｜]{1,100})/m)?.[1].trim() || "";
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
      original.jobId ? this.store.get<Job>("job", original.jobId) : undefined,
      original.resumeId,
      bytes,
      mail,
      { original },
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
    job: Job | undefined,
    resumeId: string,
    bytes: Uint8Array,
    mail: ApplicationMail,
    { original, attachmentName: selectedName }: { original?: Application; attachmentName?: string } = {},
  ) {
    const fallbackName = () => {
      const resume = this.resume(resumeId);
      return applicationAttachmentName(this.mailRole(resume, job), this.mailContact(resume), resume.name);
    };
    const attachmentName = selectedName ?? (original ? original.attachmentName ?? "resume.pdf" : fallbackName());
    const attachmentHash = hash(bytes);
    const digest = hash(
      JSON.stringify({
        job,
        resumeId,
        ...mail,
        attachmentHash,
        attachmentName,
        ...(original ? { revisedFrom: original.id } : {}),
      }),
    );
    const existing = this.store.applicationByDigest<Application>(digest);
    if (existing && !original) return existing;
    const id = randomUUID(),
      attachment = resolve(this.store.home, `${id}-attachment.pdf`);
    await writeFile(attachment, bytes, { flag: "wx", mode: 0o600 });
    const application: Application = {
      id,
      ...(job ? { jobId: job.id } : {}),
      resumeId,
      ...mail,
      attachment,
      attachmentName,
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
        const concurrent = this.store.applicationByDigest<Application>(digest);
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
    if (
      !(this.sendEnabled
        ? this.sendEnabled()
        : process.env.RESUME_ALLOW_SEND === "1") ||
      !this.send
    )
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
        attachmentName: item.attachmentName ?? "resume.pdf",
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
    const events = this.store.applicationEvents();
    return this.store.list<Application>("application").map((item) => ({
      ...item,
      events: events.get(item.id) ?? [],
    }));
  }
}
