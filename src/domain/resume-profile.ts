import { z } from "zod";

export const CONTACT_LABELS = {
  name: "姓名",
  phone: "手机号",
  email: "邮箱",
  city: "现居城市",
  github: "GitHub",
  portfolio: "作品集",
} as const;
export type ContactKey = keyof typeof CONTACT_LABELS;
export const experienceSchema = z
  .object({
    id: z.string().min(1).max(100),
    kind: z.enum(["education", "work", "project"]),
    organization: z.string().max(200),
    title: z.string().max(200),
    degree: z.string().max(50).default(""),
    start: z.string().max(40),
    end: z.string().max(40),
    expectedEnd: z.string().max(40).default(""),
    description: z.string().max(6000),
    evidence: z.string().max(10000),
  })
  .strict();
export const resumeProfileSchema = z
  .object({
    contact: z
      .object({
        name: z.string().max(100).default(""),
        phone: z.string().max(40).default(""),
        email: z.string().max(254).default(""),
        city: z.string().max(100).default(""),
        github: z.string().max(500).default(""),
        portfolio: z.string().max(500).default(""),
      })
      .strict()
      .superRefine((contact, ctx) => {
        if (contact.email && !z.email().safeParse(contact.email).success)
          ctx.addIssue({
            code: "custom",
            path: ["email"],
            message: "请检查邮箱格式。",
          });
        if (contact.phone && !/^\+?[\d ()-]{7,25}$/.test(contact.phone))
          ctx.addIssue({
            code: "custom",
            path: ["phone"],
            message: "请检查电话号码。",
          });
        for (const key of ["github", "portfolio"] as const)
          if (contact[key]) {
            try {
              if (new URL(contact[key]).protocol !== "https:")
                throw new Error();
            } catch {
              ctx.addIssue({
                code: "custom",
                path: [key],
                message: "链接请使用完整的 HTTPS 地址。",
              });
            }
          }
      }),
    contactEvidence: z.record(z.string(), z.string().max(2000)),
    experiences: z.array(experienceSchema).max(30),
  })
  .strict();
export type ResumeProfileData = z.infer<typeof resumeProfileSchema>;
export type ProfileExperience = ResumeProfileData["experiences"][number];

/** Conservative local extraction. Every result is a draft for human review. */
export function parseResumeProfile(text: string): ResumeProfileData {
  const contact: ResumeProfileData["contact"] = {
    name: "",
    phone: "",
    email: "",
    city: "",
    github: "",
    portfolio: "",
  };
  const evidence: Record<string, string> = {};
  const lines = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const set = (key: ContactKey, value: string, line: string) => {
    contact[key] = value;
    evidence[key] = line;
  };
  const nameLine = lines.find((l) => /^姓名\s*[:：]/.test(l));
  if (nameLine)
    set(
      "name",
      nameLine.replace(/^姓名\s*[:：]\s*/, "").split(/[|｜\s]/)[0],
      nameLine,
    );
  else if (
    lines[0] &&
    /^[\p{Script=Han}·]{2,4}$/u.test(lines[0]) &&
    !/简历|开发|工程|设计|运营|经理|个人|信息/.test(lines[0])
  )
    set("name", lines[0], lines[0]);
  const emails = [
    ...new Set(text.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g) ?? []),
  ];
  if (emails.length === 1)
    set("email", emails[0], lines.find((l) => l.includes(emails[0]))!);
  const phoneMatches = [
    ...text.matchAll(/(?<!\d)1[3-9]\d[ -]?\d{4}[ -]?\d{4}(?!\d)/g),
  ];
  const phones = [
    ...new Set(phoneMatches.map((m) => m[0].replace(/[ -]/g, ""))),
  ];
  if (phones.length === 1)
    set(
      "phone",
      phones[0],
      lines.find((l) => l.replace(/[ -]/g, "").includes(phones[0]))!,
    );
  const links = [
    ...new Set(text.match(/https:\/\/github\.com\/[\w.-]+\/?/g) ?? []),
  ];
  if (links.length === 1)
    set("github", links[0], lines.find((l) => l.includes(links[0]))!);
  const city = lines.find((l) => /^(现居城市|现居地|所在城市)\s*[:：]/.test(l));
  if (city) set("city", city.replace(/^[^:：]+[:：]\s*/, ""), city);
  const experiences: ProfileExperience[] = [];
  let kind: ProfileExperience["kind"] | undefined,
    entry: ProfileExperience | undefined;
  const dateRange =
    /((?:19|20)\d{2}[./年-]\d{1,2}月?)\s*(?:-|—|–|~|～|至)\s*((?:19|20)\d{2}[./年-]\d{1,2}月?|至今|现在|Present)/i;
  const date = (s: string) =>
    s.replace(
      /^(\d{4})[./年-](\d{1,2})月?$/,
      (_, y, m) => `${y}-${m.padStart(2, "0")}`,
    );
  for (const raw of lines) {
    const line = raw.replace(/^#{1,6}\s*/, "").replace(/\*\*/g, "");
    const section = /^(教育经历|教育背景|Education)[:：]?$/i.test(line)
      ? "education"
      : /^(工作经历|实习经历|工作与实习经历|Work Experience|Internship Experience)[:：]?$/i.test(
            line,
          )
        ? "work"
        : /^(项目经历|项目经验|Projects)[:：]?$/i.test(line)
          ? "project"
          : undefined;
    if (section) {
      kind = section;
      entry = undefined;
      continue;
    }
    if (
      /^(技能|专业技能|个人信息|联系方式|自我评价|个人总结|获奖经历|证书|Skills|Summary|Certifications)[:：]?$/i.test(
        line,
      )
    ) {
      kind = undefined;
      entry = undefined;
      continue;
    }
    if (!kind) continue;
    const range = line.match(dateRange);
    const labelledSchool =
      kind === "education" && /^(学校|院校)\s*[:：]/.test(line);
    if ((range && !/^[-•·]/.test(line)) || labelledSchool) {
      const parts = line
        .replace(range?.[0] ?? "", "")
        .replace(/^[\s|｜]+|[\s|｜]+$/g, "")
        .split(/\s*[|｜]\s*/);
      entry = {
        id: `experience-${experiences.length + 1}`,
        kind,
        organization: labelledSchool
          ? line.replace(/^[^:：]+[:：]\s*/, "")
          : parts[0],
        title: labelledSchool ? "" : parts.slice(1).join(" / "),
        degree: "",
        start: range ? date(range[1]) : "",
        end: range ? date(range[2]) : "",
        expectedEnd: "",
        description: "",
        evidence: raw,
      };
      if (experiences.length < 30) experiences.push(entry);
    } else if (entry) {
      entry.description = [entry.description, raw]
        .filter(Boolean)
        .join("\n")
        .slice(0, 6000);
      entry.evidence = [entry.evidence, raw].join("\n").slice(0, 10000);
      if (entry.kind === "education") {
        const degree = line.match(/^学历\s*[:：]\s*(.+)$/)?.[1];
        if (degree) entry.degree = degree;
        const expected = line.match(
          /预计\s*((?:19|20)\d{2})\s*[年./-]\s*(\d{1,2})\s*月?\s*毕业/,
        );
        if (expected)
          entry.expectedEnd = `${expected[1]}-${expected[2].padStart(2, "0")}`;
      }
    }
  }
  const education = experiences.filter((e) => e.kind === "education");
  if (education.length === 1 && !education[0].degree) {
    const degreeLines = lines.filter((l) => /本科|硕士|博士|大专/.test(l));
    const values = [
      ...new Set(
        degreeLines.flatMap((l) => l.match(/本科|硕士|博士|大专/g) ?? []),
      ),
    ];
    if (values.length === 1) {
      education[0].degree = values[0];
      education[0].evidence += "\n" + degreeLines[0];
    }
  }
  return resumeProfileSchema.parse({
    contact,
    contactEvidence: evidence,
    experiences,
  });
}
