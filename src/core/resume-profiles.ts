import { createHash, randomUUID } from "node:crypto";
import type { Workspace } from "./workspace.js";
import {
  parseResumeProfile,
  experienceLimit,
  resumeProfileSchema,
  type ProfileExperience,
  type ResumeProfileData,
} from "../domain/resume-profile.js";
import type { Resume } from "./workspace.js";
import { readResume } from "../infrastructure/documents.js";
export type ResumeProfile = {
  id: string;
  resumeId: string;
  sourceHash: string;
  data: ResumeProfileData;
  createdAt: number;
  confirmedAt?: number;
  userEdited?: boolean;
  pendingRefresh?: boolean;
  sourcePages?: number;
};
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const experienceFields = ["organization", "title", "degree", "award", "start", "end", "expectedEnd", "description", "evidence"] as const;
function sameExperience(saved: ProfileExperience, parsed: ProfileExperience) {
  if (saved.kind !== parsed.kind || (saved.start && parsed.start && saved.start !== parsed.start)) return false;
  const firstLine = saved.evidence.split("\n", 1)[0].trim();
  return (!!firstLine && firstLine === parsed.evidence.split("\n", 1)[0].trim()) ||
    (!!saved.organization.trim() && saved.organization.trim() === parsed.organization.trim());
}
export class ResumeProfiles {
  constructor(readonly workspace: Workspace) {}
  current(resumeId: string) {
    return this.forResume(this.workspace.resume(resumeId)).find((profile) => !profile.pendingRefresh);
  }
  private forResume(resume: Resume) {
    const sourceHash = hash(resume.text);
    return this.workspace.store
      .list<ResumeProfile>("resume-profile")
      .filter((p) => p.resumeId === resume.id && p.sourceHash === sourceHash);
  }
  draft(resumeId: string) {
    const resume = this.workspace.resume(resumeId);
    const [existing] = this.forResume(resume);
    if (existing) return existing;
    const profile: ResumeProfile = {
      id: randomUUID(),
      resumeId,
      sourceHash: hash(resume.text),
      data: parseResumeProfile(resume.text),
      createdAt: Date.now(),
      ...(resume.sourcePages ? { sourcePages: resume.sourcePages } : {}),
    };
    this.workspace.store.put("resume-profile", profile);
    return profile;
  }
  async reparse(resumeId: string) {
    const resume = this.workspace.resume(resumeId);
    const source = !resume.pdf && /\.pdf$/i.test(resume.original)
      ? await readResume(resume.original) : { text: resume.text, pageCount: resume.sourcePages };
    this.workspace.resume(resumeId);
    const data = parseResumeProfile(source.text);
    const current = this.current(resumeId);
    if (current?.confirmedAt && current.userEdited) {
      const previouslyParsed = parseResumeProfile(resume.text);
      for (const [key, value] of Object.entries(current.data.contact) as [keyof typeof data.contact, string][]) {
        if (value !== previouslyParsed.contact[key]) {
          data.contact[key] = value;
          if (current.data.contactEvidence[key]) data.contactEvidence[key] = current.data.contactEvidence[key];
          else delete data.contactEvidence[key];
        }
      }
      const merged = current.data.experiences.slice();
      for (const experience of data.experiences) {
        const index = merged.findIndex((saved) => sameExperience(saved, experience));
        if (index < 0) {
          merged.push({ ...experience, id: randomUUID() });
          continue;
        }
        const saved = merged[index];
        const baseline = previouslyParsed.experiences.find((item) => sameExperience(item, saved));
        if (!baseline) continue;
        const updated = { ...experience, id: saved.id };
        for (const field of experienceFields)
          if (saved[field] !== baseline[field]) Object.assign(updated, { [field]: saved[field] });
        merged[index] = updated;
      }
      data.experiences = merged.slice(0, experienceLimit);
    }
    const profile: ResumeProfile = {
      id: randomUUID(), resumeId, sourceHash: hash(resume.text), data, createdAt: Date.now(),
      pendingRefresh: true,
      ...(current?.confirmedAt && current.userEdited ? { userEdited: true } : {}),
      ...(source.pageCount ? { sourcePages: source.pageCount } : {}),
    };
    this.workspace.store.put("resume-profile", profile);
    return profile;
  }
  confirm(id: string, value: unknown) {
    const profile = this.workspace.store.get<ResumeProfile>(
      "resume-profile",
      id,
    );
    const [latest] = this.forResume(this.workspace.resume(profile.resumeId));
    if (latest?.id !== id)
      throw new Error("简历已变化，请重新解析并核对资料。");
    const data = resumeProfileSchema.parse(value);
    if (
      profile.confirmedAt &&
      JSON.stringify(profile.data) === JSON.stringify(data)
    )
      return profile;
    const next = {
      ...profile,
      id: randomUUID(),
      data,
      createdAt: Date.now(),
      confirmedAt: Date.now(),
      pendingRefresh: undefined,
      userEdited: !!profile.userEdited || JSON.stringify(data) !==
        JSON.stringify(profile.pendingRefresh ? profile.data : parseResumeProfile(this.workspace.resume(profile.resumeId).text)),
    };
    this.workspace.store.put("resume-profile", next);
    return next;
  }
  confirmed(resumeId: string) {
    const p = this.current(resumeId);
    if (!p?.confirmedAt)
      throw new Error("请先解析简历并确认可复用资料，再填写官网。");
    return p;
  }
}
