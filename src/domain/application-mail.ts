import { z } from "zod";
import type { ResumeProfileData } from "./resume-profile.js";

export const applicationMail = z
  .object({
    recipient: z.email(),
    subject: z
      .string()
      .min(1)
      .max(200)
      .refine(
        (value) => /\S/.test(value) && !/[\r\n]/.test(value),
        "主题不能为空或包含换行。",
      ),
    body: z
      .string()
      .min(1)
      .max(20000)
      .refine((value) => /\S/.test(value), "正文不能为空。"),
  })
  .strict();
export type ApplicationMail = z.infer<typeof applicationMail>;

type Contact = ResumeProfileData["contact"];
const inline = (value: string) => value.replace(/[\s\u0000-\u001f\u007f]+/gu, " ").trim();

export function directMailDraft(contact: Contact, role: string) {
  const name = inline(contact.name), position = inline(role);
  const details = [contact.phone && `电话：${inline(contact.phone)}`, contact.email && `邮箱：${inline(contact.email)}`].filter(Boolean);
  return {
    subject: [position ? `应聘${position}` : "简历投递", name].filter(Boolean).join(" - ").slice(0, 200),
    body: [
      "您好，",
      [name ? `我是${name}。` : "", position ? `我想应聘${position}岗位。` : "我想向您投递一份简历。", "简历随信附上，期待有机会进一步沟通。"].join(""),
      details.join("\n"),
    ].filter(Boolean).join("\n\n"),
  };
}

export function applicationAttachmentName(role: string, contact: Contact, resumeName: string) {
  const safe = (value: string) => inline(value).replace(/[<>:"/\\|?*]/g, "-")
    .replace(/^[. -]+|[. -]+$/g, "").slice(0, 50);
  const fallback = safe(resumeName.replace(/\.(?:pdf|docx|txt|md|markdown)$/i, ""));
  const stem = [safe(role), safe(contact.name) || (!contact.phone ? fallback : ""), safe(contact.phone)]
    .filter(Boolean).join("-") || "求职简历";
  return `${/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem) ? "简历-" : ""}${stem}.pdf`;
}
