import type { Job, Resume, Workspace } from "./workspace.js";
import type { TailoringPlan } from "../domain/resume-tailoring.js";
import { auditResumeRisks, type ResumeRiskReport } from "../domain/resume-risk-audit.js";
import { analyzeJdGap, type JdGapAnalysis } from "../domain/jd-gap-analysis.js";
import {
  buildInterviewGrill,
  type InterviewGrillPlan,
} from "../domain/interview-grill.js";

type StoredProposal = {
  id: string;
  resumeId: string;
  jobId: string;
  plan: TailoringPlan;
};

export type ResumeGrillBundle = {
  resumeId: string;
  resumeName: string;
  jobId?: string;
  applicationId?: string;
  riskAudit: ResumeRiskReport;
  jdGapAnalysis?: JdGapAnalysis;
  interviewGrill: InterviewGrillPlan;
};

const compact = (text: string) => text.normalize("NFKC").replace(/\s+/g, "");

/**
 * Orchestrates deterministic resume anti-BS risk auditing, JD track gap / risk isolation,
 * and 3-layer interview grilling over either a working resume or a frozen sent application snapshot.
 */
export class ResumeGrillService {
  constructor(private readonly workspace: Workspace) {}

  auditResume(resumeId: string) {
    const resume = this.workspace.resume(resumeId);
    return {
      resumeId: resume.id,
      resumeName: resume.name,
      riskAudit: auditResumeRisks(resume.text),
    };
  }

  analyzeJobFit(resumeId: string, jobId: string) {
    const resume = this.workspace.resume(resumeId);
    const job = this.workspace.store.get<Job>("job", jobId);
    return {
      resumeId: resume.id,
      jobId: job.id,
      riskAudit: auditResumeRisks(resume.text),
      jdGapAnalysis: analyzeJdGap(resume.text, job.jd, job.role),
    };
  }

  prepareInterviewGrill(input: {
    resumeId?: string;
    jobId?: string;
    applicationId?: string;
    proposalId?: string;
  }): ResumeGrillBundle {
    let resumeId = input.resumeId;
    let jobId = input.jobId;
    let applicationId: string | undefined;

    if (input.applicationId) {
      const app = this.workspace.latestApplication(input.applicationId);
      applicationId = app.id;
      resumeId = app.resumeId;
      jobId = app.jobId ?? jobId;
    }
    if (!resumeId) {
      throw new Error("请提供简历编号或已投递记录编号以生成面试拷打准备。");
    }

    // Frozen application snapshots remain auditable even if the source resume was later trashed.
    const resume = applicationId
      ? this.workspace.store.get<Resume>("resume", resumeId)
      : this.workspace.resume(resumeId);
    const job = jobId
      ? this.workspace.store.get<Job>("job", jobId)
      : resume.jobId
        ? this.workspace.store.get<Job>("job", resume.jobId)
        : undefined;

    const riskAudit = auditResumeRisks(resume.text);
    const jdGapAnalysis = job
      ? analyzeJdGap(resume.text, job.jd, job.role)
      : undefined;

    const proposal = input.proposalId
      ? this.workspace.store.get<StoredProposal>("proposal", input.proposalId)
      : job
        ? this.workspace.store
            .list<StoredProposal>("proposal")
            .find(
              (item) =>
                item.jobId === job.id &&
                (item.resumeId === resume.id ||
                  (resume.parentId && item.resumeId === resume.parentId)),
            )
        : undefined;

    // Only grill tailored lines that were actually accepted into this resume's text.
    const compactResume = compact(resume.text);
    const tailoredQuotes =
      proposal?.plan.changes
        .filter((change) => {
          const quote = compact(change.after);
          return quote.length > 0 && compactResume.includes(quote);
        })
        .map((change) => ({
          after: change.after,
          requirement: change.requirement,
        })) ?? [];

    const interviewGrill = buildInterviewGrill({
      resumeText: resume.text,
      job,
      riskAudit,
      jdGapAnalysis,
      tailoredQuotes,
    });

    return {
      resumeId: resume.id,
      resumeName: resume.name,
      ...(job ? { jobId: job.id } : {}),
      ...(applicationId ? { applicationId } : {}),
      riskAudit,
      ...(jdGapAnalysis ? { jdGapAnalysis } : {}),
      interviewGrill,
    };
  }
}
