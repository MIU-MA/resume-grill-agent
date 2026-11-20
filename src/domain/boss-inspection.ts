import { z } from "zod";

export const bossJobFacts = z.object({
  city: z.string().max(80),
  education: z.string().max(80),
  experience: z.string().max(80),
  salary: z.string().max(80),
});
export type BossJobFacts = z.infer<typeof bossJobFacts>;

export type BossInspection = {
  kind: "detail" | "login" | "verification" | "unknown";
  url: string;
  title: string;
  company: string;
  description: string;
  facts?: BossJobFacts;
  truncated: boolean;
  communication: { count: number; enabled: number; labels: string[] };
  matched: boolean;
  blockers: string[];
};

export class BossDetailError extends Error {
  constructor(message: string, readonly scope: "session" | "job" | "transient") {
    super(message);
  }
}
