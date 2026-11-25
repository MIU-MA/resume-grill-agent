import { z } from "zod";
import { resumeSectionHeading } from "./resume-structure.js";

export const CONTACT_LABELS = {
  name: "姓名",
  phone: "手机号",
  email: "邮箱",
  city: "现居城市",
  github: "GitHub",
  portfolio: "作品集",
} as const;
export type ContactKey = keyof typeof CONTACT_LABELS;
export const experienceKinds = ["education", "work", "project", "competition", "campus"] as const;
export const experienceLimit = 60;
export const EXPERIENCE_LABELS = {
  education: { section: "教育经历", organization: "学校", title: "专业" },
  work: { section: "工作 / 实习经历", organization: "公司 / 单位", title: "职位 / 角色" },
  project: { section: "项目经历", organization: "项目名称", title: "项目角色" },
  competition: { section: "竞赛经历", organization: "竞赛名称", title: "参赛角色" },
  campus: { section: "校园经历", organization: "活动 / 社团", title: "职务 / 角色" },
} as const;
export const experienceSchema = z
  .object({
    id: z.string().min(1).max(100),
    kind: z.enum(experienceKinds),
    organization: z.string().max(200),
    title: z.string().max(200),
    degree: z.string().max(50).default(""),
    award: z.string().max(200).optional(),
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
    experiences: z.array(experienceSchema).max(experienceLimit),
  })
  .strict();
export type ResumeProfileData = z.infer<typeof resumeProfileSchema>;
export type ProfileExperience = ResumeProfileData["experiences"][number];

const rangePattern =
  /((?:19|20)\d{2}\s*[./年-]\s*(?:1[0-2]|0?[1-9])月?)\s*(?:[-—–~～至到]\s*)?((?:19|20)\d{2}\s*[./年-]\s*(?:1[0-2]|0?[1-9])月?|至今|现在|Present)/i;
const awardSuffix = /((?:(?:国家级?|省级?|市级?|校级?|国赛|省赛|校赛|全国)\s*)?(?:(?:特等|[一二三四]等)奖|[金银铜](?:奖|牌)|优胜奖|优秀奖))\s*[）)]?$/;
const awardLabel = /^(?:奖项|获奖|奖级|成绩|名次|award|result)\s*[:：]\s*/i;
const details = /^(?:(?:负责|参与|协助|主导|推动|实现|完成|维护|获得|荣获|主要|工作内容|内容|描述|学历|预计|职责)|(?:built|led|developed|responsible)\b|[（(])/i;
const bullet = /^(?:[-*•●▪◦·]\s*|\d{1,2}[.)、]\s*)/;
const fieldLabel = /^(?:学校|院校|公司|单位|雇主|项目名称|项目|竞赛名称|竞赛|比赛名称|活动名称|社团名称|社团)\s*[:：]\s*/i;
const roleLabel = /^(?:专业|岗位|职位|职务|参赛角色|角色|role)\s*[:：]\s*/i;
const elapsedDate = (value: string) =>
  value.replace(/^(\d{4})\s*[./年-]\s*(\d{1,2})月?$/, (_, year, month) => `${year}-${month.padStart(2, "0")}`);

function profileKind(heading: ReturnType<typeof resumeSectionHeading>): ProfileExperience["kind"] | undefined {
  if (!heading) return;
  if (heading.kind === "internship" || /^(?:工作.*实习经历|work and internship experience)$/i.test(heading.title)) return "work";
  return experienceKinds.find((kind) => kind === heading.kind);
}

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
    entry: ProfileExperience | undefined,
    pending: { start: string; end: string; evidence: string } | undefined;
  for (const raw of lines) {
    const heading = resumeSectionHeading(raw);
    if (heading) {
      kind = profileKind(heading);
      entry = undefined;
      pending = undefined;
      continue;
    }
    if (!kind) continue;
    if (/^(?:第\s*)?\d+\s*(?:页)?(?:\s*[/／]\s*\d+\s*页?)?$|^page\s+\d+(?:\s+of\s+\d+)?$/i.test(raw)) continue;
    const line = raw.replace(/\*\*/g, "").normalize("NFKC");
    const content = line.replace(bullet, "").trim();
    const range = content.match(rangePattern);
    const competitionDate = kind === "competition" && !range && content.match(/^((?:19|20)\d{2})(年|[./-]\s*(?:1[0-2]|0?[1-9])月?)?\s*(?=$|[\s\p{Script=Han}])/u);
    const dateText = range?.[0] ?? (competitionDate ? competitionDate[0] : undefined);
    const titleText = (dateText ? content.replace(dateText, " ") : content)
      .replace(/^[\s|·,，]+|[\s|·,，]+$/g, "");
    const dates = range ? { start: elapsedDate(range[1]), end: elapsedDate(range[2]), evidence: raw }
      : competitionDate ? { start: elapsedDate(competitionDate[0].trim()).replace(/年$/, ""), end: "", evidence: raw } : undefined;
    if (dates && !titleText) {
      if (entry && !entry.start && !entry.end) {
        entry.start = dates.start;
        entry.end = dates.end;
        entry.evidence = (entry.evidence + "\n" + raw).slice(0, 10000);
      } else pending = dates;
      continue;
    }
    const labelled = fieldLabel.test(titleText);
    const detail = details.test(content) || awardLabel.test(content) || roleLabel.test(content);
    const titleLine = !detail && (dates || pending || !entry ||
      /\s*[|]\s*|\s+·\s+/.test(titleText) ||
      (bullet.test(line) && (kind === "competition" && /竞赛|比赛|大赛|挑战赛|杯/.test(titleText) ||
        kind === "campus" && /学生会|志愿|社团|协会|团委|社会实践|校园活动/.test(titleText))));
    if (labelled || titleLine) {
      if (experiences.length >= experienceLimit) break;
      const named = titleText.replace(fieldLabel, "");
      const award = kind === "competition" ? named.match(awardSuffix) : undefined;
      const parts = (award ? named.slice(0, award.index) : named)
        .replace(/[\s，,、|｜·（(]+$/, "").trim().split(/\s*\|\s*|\s+·\s+/);
      const period = dates ?? pending;
      entry = {
        id: `experience-${experiences.length + 1}`,
        kind,
        organization: parts[0].slice(0, 200),
        title: parts.slice(1).join(" / ").slice(0, 200),
        degree: "",
        ...(award ? { award: award[1].trim() } : {}),
        start: period?.start ?? "",
        end: period?.end ?? "",
        expectedEnd: "",
        description: "",
        evidence: (pending && !dates ? pending.evidence + "\n" + raw : raw).slice(0, 10000),
      };
      pending = undefined;
      experiences.push(entry);
    } else if (entry) {
      entry.description = [entry.description, raw]
        .filter(Boolean)
        .join("\n")
        .slice(0, 6000);
      entry.evidence = [entry.evidence, raw].join("\n").slice(0, 10000);
      if (entry.kind === "competition" && awardLabel.test(content))
        entry.award = content.replace(awardLabel, "").slice(0, 200);
      if (roleLabel.test(content))
        entry.title = content.replace(roleLabel, "").slice(0, 200);
      if (entry.kind === "education") {
        const degree = line.match(/^学历\s*[:：]\s*(.+)$/)?.[1];
        if (degree) entry.degree = degree.slice(0, 50);
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
      education[0].evidence = (education[0].evidence + "\n" + degreeLines[0]).slice(0, 10000);
    }
  }
  return resumeProfileSchema.parse({
    contact,
    contactEvidence: evidence,
    experiences,
  });
}
