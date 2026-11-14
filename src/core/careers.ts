import { randomUUID } from "node:crypto";
import type { Workspace } from "./workspace.js";
import {
  discoverRecruitingPage,
  readRecruitingDetail,
} from "../infrastructure/careers/career-reader.js";
import {
  sourceUrlSchema,
  type CareerDiscovery,
  type CareerPage,
} from "../infrastructure/careers/contracts.js";
export type CareerScan = {
  id: string;
  url: string;
  fetchedAt: number;
  result?: CareerDiscovery;
  error?: string;
};
/** The same bounded live readers used by the web workbench, independent of email and resume selection. */
export class Careers {
  constructor(
    readonly workspace: Workspace,
    readonly discover = discoverRecruitingPage,
    readonly detail = readRecruitingDetail,
  ) {}
  private save(page: CareerPage) {
    const rows = page.jobs?.length
      ? page.jobs
      : [
          {
            role: page.role,
            company: page.company,
            jobDescription: page.jobDescription,
            recommendedEmail: page.recommendedEmail,
            emailAmbiguous: page.emails.length !== 1,
          },
        ];
    return rows
      .filter((row) => row.role && row.jobDescription?.trim())
      .map((row) =>
        this.workspace.addJob({
          company: row.company || page.company,
          role: row.role,
          jd: row.jobDescription!,
          sourceUrl: page.url,
          ...(row.recommendedEmail && !row.emailAmbiguous
            ? { recipient: row.recommendedEmail }
            : {}),
        }),
      );
  }
  async scan(url: string, keywords: string[] = []) {
    url = sourceUrlSchema.parse(url);
    const scan: CareerScan = { id: randomUUID(), url, fetchedAt: Date.now() };
    try {
      scan.result = await this.discover(url, keywords);
      for (const page of scan.result.pages ?? []) this.save(page);
    } catch (e) {
      scan.error = e instanceof Error ? e.message : "读取失败";
    }
    scan.fetchedAt = Date.now();
    this.workspace.store.put("career-scan", scan);
    return scan;
  }
  async read(url: string) {
    const page = await this.detail(sourceUrlSchema.parse(url));
    const jobs = this.save(page);
    if (!jobs.length)
      throw new Error(
        "官网没有返回可用的岗位职责与任职要求，请重试或粘贴 JD。",
      );
    return jobs[0];
  }
}
