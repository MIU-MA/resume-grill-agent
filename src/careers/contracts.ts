import { z } from "zod";
export const emailSchema = z
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());
export const sourceUrlSchema = z
  .url()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        (!url.port || url.port === "443")
      );
    } catch {
      return false;
    }
  }, "请填写官网招聘页面的 HTTPS 地址");

export type EmailCandidate = { email: string; context: string };
export type CareerLink = {
  url: string;
  label: string;
  kind: "entry" | "job" | "apply";
  sourceUrl: string;
};
export type CareerJob = {
  id: string;
  role: string;
  company?: string;
  emails: EmailCandidate[];
  recommendedEmail: string;
  emailAmbiguous?: boolean;
  jobDescription?: string;
};
export type CareerPage = {
  url: string;
  title: string;
  emails: EmailCandidate[];
  company: string;
  role: string;
  recommendedEmail: string;
  notes: string[];
  links?: CareerLink[];
  jobDescription?: string;
  jobs?: CareerJob[];
};
