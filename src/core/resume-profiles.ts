import { createHash, randomUUID } from "node:crypto";
import type { Workspace } from "./workspace.js";
import {
  parseResumeProfile,
  resumeProfileSchema,
  type ResumeProfileData,
} from "../domain/resume-profile.js";
export type ResumeProfile = {
  id: string;
  resumeId: string;
  sourceHash: string;
  data: ResumeProfileData;
  createdAt: number;
  confirmedAt?: number;
  userEdited?: boolean;
};
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export class ResumeProfiles {
  constructor(readonly workspace: Workspace) {}
  current(resumeId: string) {
    const resume = this.workspace.resume(resumeId);
    return this.workspace.store
      .list<ResumeProfile>("resume-profile")
      .find(
        (p) => p.resumeId === resumeId && p.sourceHash === hash(resume.text),
      );
  }
  draft(resumeId: string) {
    const existing = this.current(resumeId);
    if (existing) return existing;
    const resume = this.workspace.resume(resumeId);
    const profile: ResumeProfile = {
      id: randomUUID(),
      resumeId,
      sourceHash: hash(resume.text),
      data: parseResumeProfile(resume.text),
      createdAt: Date.now(),
    };
    this.workspace.store.put("resume-profile", profile);
    return profile;
  }
  confirm(id: string, value: unknown) {
    const profile = this.workspace.store.get<ResumeProfile>(
      "resume-profile",
      id,
    );
    const latest = this.current(profile.resumeId);
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
      userEdited:
        JSON.stringify(data) !==
        JSON.stringify(
          parseResumeProfile(this.workspace.resume(profile.resumeId).text),
        ),
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
