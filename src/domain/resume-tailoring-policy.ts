import type { ResumeSectionKind } from "./resume-structure.js";

type Section = { kind: ResumeSectionKind; lines: string[] };
const IDENTITY_LABEL =
  /(?:姓名|性别|出生|年龄|电话|手机|邮箱|微信|住址|现居|籍贯|政治面貌|婚姻|证件|毕业院校|学历|学位|name|phone|email|address|date of birth)\s*[:：]/i;
const NARRATIVE =
  /开发|熟悉|掌握|擅长|具备|实践|参与|负责|项目|经验|基础|使用|推进|技术栈|求职意向|develop|experience|familiar|proficien|project|built|worked/i;
const dateOrEntry = /(?:19|20)\d{2}(?:[./年-]\d{1,2}月?)?\s*(?:[-–—~～至到]|至今)|^(?:项目名称|雇主|公司名称|任职单位)\s*[:：]/;
const contribution = ["主导", "独立负责", "独立完成", "带领团队", "从零搭建", "精通"];
const technology = /\b(?:rest(?:ful)?|ci\s*\/\s*cd|git(?:hub|lab)?|api|https?|grpc|graphql|go(?:lang)?|rust|java(?:script)?|typescript|python|ruby|php|swift|kotlin|scala|react|vue(?:\.js)?|angular|svelte|next\.js|node(?:\.js|js)|spring|django|flask|fastapi|sql|mysql|postgres(?:ql)?|mongodb|redis|kafka|docker|kubernetes|k8s|jenkins|npm|webpack|vite|tailwind|linux|nginx|aws|azure|pytorch|tensorflow|llm|rag|html|css|oauth|jwt|\w+\.js)(?=\d|\b)|\bc(?:\+\+|#)/gi;
const numbers = /[+−-]?\d+(?:[.,]\d+)*(?:\s*(?:%|‰|ms\b|fps\b|MB\b|GB\b|秒|毫秒|分钟|小时|天|周|个月|月|年|人|条|次|个|倍|万|亿|元))?/gi;

/** Model restrictions apply to individual facts; users may still edit any source line. */
export function modelCanRewriteLine(
  section: Section,
  lineIndex: number,
): boolean {
  const line = section.lines[lineIndex]?.trim();
  if (!line || ["education", "awards"].includes(section.kind)) return false;
  if (section.kind !== "general") return true;
  if (
    IDENTITY_LABEL.test(line) ||
    /@|https?:\/\/|(?:\+?86[- ]?)?1[3-9]\d{9}/i.test(line)
  )
    return false;
  return line.length >= 20 && NARRATIVE.test(line);
}

export function preservedIntroductionFacts(
  before: string,
  after: string,
): boolean {
  const compactAfter = after.replace(/\s/g, "");
  const facts =
    before.match(/(?:19|20)\d{2}\s*届|本科|硕士|博士|学士|大专|在读|应届/g) ??
    [];
  return facts.every((fact) => compactAfter.includes(fact.replace(/\s/g, "")));
}

function technologies(text: string) {
  const value = text.normalize("NFKC");
  // Keep ordinary English prose out of this check, but recognize common
  // spelling variations and code identifiers as evidence-bearing terms.
  const aliases: Record<string, string> = { restful: "rest", golang: "go", postgres: "postgresql", "vue.js": "vue", nodejs: "node.js" };
  const tokens = [...value.matchAll(technology)]
    .map(([token]) => token.toLowerCase().replace(/\s/g, ""));
  for (const [token] of value.matchAll(/\b\w*?[a-z][A-Z]\w*\b/g)) tokens.push(token.toLowerCase());
  if (/接口/.test(value)) tokens.push("api");
  if (/持续集成.*(?:持续交付|持续部署)/.test(value)) tokens.push("ci/cd");
  return [...new Set(tokens.map((token) => aliases[token] ?? token))];
}

function numericFacts(text: string) {
  return [...text.normalize("NFKC").matchAll(numbers)].map(([token]) =>
    token.toLowerCase().replace(/\s/g, "").replace("毫秒", "ms"),
  );
}

function experienceEvidence(section: Section, index: number) {
  const before = section.lines[index];
  const starts = section.lines.flatMap((line, i) => dateOrEntry.test(line) ? [i] : []);
  const start = starts.findLast((i) => i <= index);
  if (start === undefined) {
    const bullet = /^(?:[-*•·●▪]|\d+[.)、])/;
    if (!bullet.test(before)) return before;
    const first = section.lines.slice(0, index).findLastIndex((line) => !bullet.test(line)) + 1;
    const last = section.lines.findIndex((line, i) => i > index && !bullet.test(line));
    return section.lines.slice(first, last < 0 ? undefined : last).join("\n");
  }
  const end = starts.find((i) => i > index);
  return section.lines.slice(start, end).join("\n");
}

export function rewriteFactProblem(
  section: Section,
  index: number,
  after: string,
  resume: string,
) {
  const before = section.lines[index];
  if (!modelCanRewriteLine(section, index))
    return "身份、联系、教育或证书信息需要你自行修改";
  if (section.kind === "general" && !preservedIntroductionFacts(before, after))
    return "自我介绍中的毕业届别和学历须保留";
  if (contribution.some((claim) => after.includes(claim) && !before.includes(claim)))
    return "贡献或能力表述比原文更强，请先确认";
  const supportedNumbers = new Set(numericFacts(before));
  if (numericFacts(after).some((fact) => !supportedNumbers.has(fact)))
    return "新增或改变了数字，请先补充原始依据";
  const evidence = ["general", "profile", "skills", "selfReview"].includes(section.kind)
    ? resume : experienceEvidence(section, index);
  const supportedTools = new Set(technologies(evidence));
  const missing = technologies(after).filter((term) => !supportedTools.has(term));
  if (missing.length) return `缺少技术或工具依据（${missing.slice(0, 4).join("、")}）`;
}
