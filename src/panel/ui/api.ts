import type { Application, Job, Resume } from "../../service.js";
import type { TailoringPlan } from "../../domain/resume-tailoring.js";
import type { Goal, SearchRun, Batch, Candidate } from "../../tasks.js";
export type Proposal = {
  id: string;
  resumeId: string;
  jobId: string;
  plan: TailoringPlan;
};
export type Snapshot = {
  resumes: Resume[];
  jobs: Job[];
  proposals: Proposal[];
  applications: Array<
    Application & {
      events: Array<{ type: string; detail: string; created_at: number }>;
    }
  >;
  sendingEnabled: boolean;
  goals: Goal[];
  searches: SearchRun[];
  batches: Batch[];
  goalCandidates: Record<string, Array<Candidate & { job: Job }>>;
};
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    cache: "no-store",
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "操作未完成。");
  return result;
}
