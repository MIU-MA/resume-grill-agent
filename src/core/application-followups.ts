import { createHash } from "node:crypto";
import { z } from "zod";
import type { Application, Job, Workspace } from "./workspace.js";
import type { BossDelivery } from "./boss-deliveries.js";
import { requireCompanyWebsite } from "../domain/boss.js";
import { sourceUrlSchema } from "../infrastructure/careers/contracts.js";

export const followupChannel = z.enum(["boss", "mail", "website"]);
export const followupFields = z.strictObject({
  stage: z.enum(["waiting", "interview", "closed"]),
  dueDate: z.union([z.iso.date(), z.literal("")]),
  note: z.string().trim().max(1000),
});
export type FollowupFields = z.infer<typeof followupFields>;
export type FollowupChannel = z.infer<typeof followupChannel>;
export type Followup = FollowupFields & {
  id: string;
  channel: FollowupChannel;
  applicationId: string;
  revision: number;
};
export type WebsiteSubmission = {
  id: string;
  company: string;
  role: string;
  sourceUrl: string;
  submittedAt: number;
};

const websiteKey = ({ sourceUrl, company, role }: Job) => `website-application:${createHash("sha256")
  .update(JSON.stringify([new URL(sourceUrl).href, company.trim(), role.trim()])).digest("hex")}`;

export class ApplicationFollowups {
  constructor(private workspace: Workspace) {}

  websiteSubmissions() {
    return this.workspace.store.list<WebsiteSubmission>("website-application");
  }

  websiteSubmission(job: Job) {
    return this.websiteSubmissions().find((item) => item.id === websiteKey(job));
  }

  recordWebsiteSubmission(jobId: string) {
    const { store } = this.workspace;
    return store.transaction(() => {
      const job = store.get<Job>("job", jobId);
      requireCompanyWebsite(job.sourceUrl);
      const sourceUrl = sourceUrlSchema.parse(job.sourceUrl);
      const id = websiteKey(job);
      const current = this.websiteSubmissions().find((item) => item.id === id);
      if (current) return current;
      const submission = { id, company: job.company, role: job.role, sourceUrl, submittedAt: Date.now() };
      store.put("website-application", submission);
      return submission;
    });
  }

  list() {
    return this.workspace.store.list<Followup>("application-followup");
  }

  save(channel: FollowupChannel, applicationId: string, revision: number, input: FollowupFields) {
    const data = followupFields.parse(input);
    const id = `application-followup:${channel}:${applicationId}`;
    const { store } = this.workspace;
    return store.transaction(() => {
      if (channel === "website") store.get<WebsiteSubmission>("website-application", applicationId);
      if (channel === "mail" && !["sent", "uncertain"].includes(store.get<Application>("application", applicationId).status))
        throw new Error("这封邮件还在准备，投递后才能记录跟进。");
      if (channel === "boss" && !["finished", "uncertain", "paused"].includes(store.get<BossDelivery>("boss-delivery", applicationId).status))
        throw new Error("这条 BOSS 任务尚未结束执行，请先查看回执。");
      const prior = this.list().find((item) => item.id === id);
      if ((prior?.revision ?? 0) !== revision)
        throw new Error("跟进已被更新，请刷新记录后重试。");
      const followup = { ...data, id, channel, applicationId, revision: revision + 1,
        dueDate: data.stage === "closed" ? "" : data.dueDate };
      store.put("application-followup", followup);
      return followup;
    });
  }
}
