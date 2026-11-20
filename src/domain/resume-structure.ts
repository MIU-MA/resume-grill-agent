export type ResumeSectionKind =
  | "general"
  | "profile"
  | "education"
  | "work"
  | "internship"
  | "project"
  | "skills"
  | "awards"
  | "selfReview"
  | "custom";

type ParsedResumeSection = {
  kind: ResumeSectionKind;
  title: string;
  lines: string[];
};

const HEADING_MATCHERS: Array<[ResumeSectionKind, RegExp]> =
  [
    ["general", /^(个人信息|基本信息|联系方式|personal information|contact)$/i],
    [
      "profile",
      /^(个人总结|个人简介|个人优势|职业概述|求职意向|profile|summary|objective)$/i,
    ],
    ["selfReview", /^(自我评价|self[- ]?(?:evaluation|review))$/i],
    ["education", /^(教育背景|教育经历|教育|education)$/i],
    [
      "work",
      /^(工作经历|工作经验|全职经历|职业经历|任职经历|professional experience|work experience|employment history|experience)$/i,
    ],
    ["internship", /^(实习经历|实习经验|internship|internships)$/i],
    ["custom", /^(?:工作(?:与|及|和|[ /／]+)实习经历|work and internship experience)$/i],
    ["project", /^(项目经历|项目经验|项目|projects?)$/i],
    [
      "skills",
      /^(技能特长|专业技能|技术技能|技术能力|专业能力|职业技能|技能|技术栈|核心技能|skills?|technical skills|technical competencies)$/i,
    ],
    [
      "awards",
      /^(荣誉奖项|获奖经历|证书|资格证书|奖项|awards?|certifications?)$/i,
    ],
  ];

const ACTION =
  /负责|主导|参与|协助|支持|执行|跟进|推动|组织|统筹|协调|带领|管理|搭建|建立|设计|开发|实现|落地|优化|改进|重构|制定|规划|分析|调研|解决|交付|完成|维护|监控|运营|销售|签约|获客|转化|培养|审核|控制|提升|降低|增长|减少|缩短|提高|下降|节约|达成|获得|熟练|掌握|使用|运用/;
const OUTCOME =
  /\d+(?:\.\d+)?\s*(?:%|万\+?|亿|人|元|秒|分钟|小时|天|fps|ms|条|个|次|倍)/i;
const DATE_RANGE = /(?:19|20)\d{2}(?:[.\-/年]\d{1,2})?\s*(?:-|~|—|–|至|到)/;
const STARTS_AS_STATEMENT =
  /^(?:(?:19|20)\d{2}年|在职期间[，,]?)?(?:负责|主导|参与|协助|支持|执行|跟进|推动|组织|统筹|协调|带领|管理|搭建|建立|设计|开发|实现|落地|优化|改进|重构|制定|规划|分析|调研|解决|交付|完成|维护|监控|运营|达成|通过|采用|基于|将|为客户)/;

export function parseResumeStructure(rawText: string): ParsedResumeSection[] {
  const sections: ParsedResumeSection[] = [
    { kind: "general", title: "个人概况", lines: [] },
  ];
  let current = sections[0];

  for (const text of mergeWrappedResumeLines(rawText)) {
    const heading = matchHeading(text);
    if (heading) {
      current = { kind: heading.kind, title: heading.title, lines: [] };
      sections.push(current);
      continue;
    }
    current.lines.push(text);
  }

  return sections.filter((section) => section.lines.length > 0);
}

function mergeWrappedResumeLines(rawText: string): string[] {
  const merged: string[] = [];
  for (const rawLine of normalizeText(rawText).split("\n")) {
    const text = rawLine.trim();
    if (!text) continue;
    const previous = merged.at(-1);
    if (
      previous &&
      !/[。.!！?？；;：:]$/.test(previous) &&
      isBulletLine(previous) &&
      !matchHeading(text) &&
      !isBulletLine(text) &&
      !looksLikeEntryHeader(text)
    ) {
      merged[merged.length - 1] = joinResumeLine(previous, text);
      continue;
    }
    merged.push(text);
  }
  return merged;
}

function looksLikeEntryHeader(text: string): boolean {
  return DATE_RANGE.test(text) && !STARTS_AS_STATEMENT.test(cleanBullet(text));
}

function joinResumeLine(previous: string, current: string): string {
  const left = previous.trimEnd();
  const right = current.trimStart();
  const last = left.at(-1) ?? "";
  const first = right[0] ?? "";
  const needsSpace =
    (/[A-Za-z0-9)]/.test(last) && /[A-Za-z0-9(]/.test(first)) ||
    (/[\p{Script=Han}]/u.test(last) && /[A-Za-z0-9]/.test(first)) ||
    (/[A-Za-z0-9]/.test(last) && /[\p{Script=Han}]/u.test(first));
  return `${left}${needsSpace ? " " : ""}${right}`;
}

function matchHeading(
  line: string,
): { kind: ResumeSectionKind; title: string } | null {
  const explicitlyMarked = /^#+\s*/.test(line) || /[：:]\s*$/.test(line);
  const normalized = line
    .replace(/^#+\s*/, "")
    .replace(/[：:\s]+$/, "")
    .trim();
  if (!normalized || normalized.length > 40) return null;
  const known = HEADING_MATCHERS.find(([, matcher]) =>
    matcher.test(normalized),
  );
  if (known) return { kind: known[0], title: normalized };
  if (
    explicitlyMarked &&
    /^[\p{L}\d /&·_-]{2,20}$/u.test(normalized) &&
    !ACTION.test(normalized) &&
    !OUTCOME.test(normalized)
  ) {
    return { kind: "custom", title: normalized };
  }
  return null;
}

function isBulletLine(line: string): boolean {
  return (
    /^[oO]\s+/.test(line) ||
    /^[-*•·●▪◦‣⁃▸►○◆◇]/.test(line) ||
    /^\d+[.)、]\s+/.test(line)
  );
}

function cleanBullet(value: string): string {
  return value
    .replace(/^[oO]\s+/, "")
    .replace(/^[-*•·●▪◦‣⁃▸►○◆◇]\s*/, "")
    .replace(/^\d+[.)、]\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value: string): string {
  return value
    .replaceAll(String.fromCharCode(0), "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
