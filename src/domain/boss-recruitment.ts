import { z } from "zod";
import { parseResumeStructure } from "./resume-structure.js";

export const bossRecruitmentFilter = z.enum(["all", "internship", "campus", "fulltime"]);
export type BossRecruitmentFilter = z.infer<typeof bossRecruitmentFilter>;
type RecruitmentKind = Exclude<BossRecruitmentFilter, "all"> | "unknown";

export const recruitmentLabels = {
  all: "全部",
  internship: "实习",
  campus: "校招",
  fulltime: "全职",
  unknown: "类型待核对",
} as const;

export type Recruitment = {
  kind: RecruitmentKind;
  evidence: { source: "title" | "list" | "jd"; quote: string }[];
  conflict: boolean;
};

const normalize = (text: string) => text.normalize("NFKC");
const clauses = (text: string) => text.split(/[\n。；;]/).map((line) => line.trim()).filter(Boolean);
const preferences = /优先|加分|更佳|者优|prefer(?:red|able)?\b/i;
const unrestricted = /不限|无要求|可放宽|非必须|不作要求|不强制/;
const cohort = "(?:20)?\\d{2}";
const cohortList = new RegExp(
  '(' + cohort + '(?:\\s*(?:届\\s*)?(?:[、,，/和或及]|[-–—~至到])\\s*' + cohort + ')*)\\s*届',
);
type Signal = "internship" | "campus" | "campusCohort" | "social" | "fulltime";

function recruitmentSignal(text: string, source: Recruitment["evidence"][number]["source"]) {
  const title = source === "title";
  const signals = new Set<Signal>();
  if (title
    ? /实习(?!经验|经历)|\bintern(?:ship)?\b/i.test(text)
    : /(?:招|招聘|招募|招收).{0,12}实习(?!经验|经历)|(?:岗位|职位|工作|用工)(?:类型|性质|形式)\s*[:：]?\s*(?:全职)?实习|(?:^|本岗位[:：为 ]?)(?:日常|暑期|寒假)?实习生\s*$|实习(?:周期|时长)\s*[:：]|(?:可|能|至少|需)实习\s*[\d一二三四五六半]|实习可转正/i.test(text))
    signals.add("internship");
  if (!signals.has("internship") && /校(?:园招聘|招)|(?:应届毕业生|应届生)专项/.test(text) &&
      !/(?:接受|不限|非|不走).{0,8}校(?:园招聘|招)|校(?:园招聘|招)(?:经验|经历)/.test(text))
    signals.add("campus");
  if (!/接受|可投|优先|不限/.test(text) && cohortList.test(text) &&
      (title || /面向|仅限|限招|招聘|应届|毕业生|^\s*(?:20)?\d{2}/.test(text)))
    signals.add("campusCohort");
  if (/社招|社会招聘/.test(text) && !/标准|同等|流程|区别|不接受|非社招/.test(text)) signals.add("social");
  if (!signals.has("internship") && (title ? /全职|\bfull[ -]time\b/i.test(text)
    : /(?:岗位|职位|用工|工作)(?:类型|性质|形式)\s*[:：]?\s*全职|(?:本岗位|本职位)(?:为|是)全职|^\s*(?:正式)?全职(?:岗位|工作)?\s*$/i.test(text)))
    signals.add("fulltime");
  return signals;
}

export function classifyBossRecruitment(title: string, list: string, jd?: string): Recruitment {
  const evidence: Recruitment["evidence"] = [];
  const groups = [
    { source: "title", texts: [title] },
    { source: "jd", texts: clauses(jd ?? "") },
    { source: "list", texts: clauses(list) },
  ] as const;
  const signals = new Set<Signal>();
  const primary = new Set<Signal>();
  for (const { source, texts } of groups) {
    for (const quote of texts) {
      const text = normalize(quote);
      if (!quote) continue;
      const found = recruitmentSignal(text, source);
      if (!found.size) continue;
      if ([...found].some((signal) => !signals.has(signal)))
        evidence.push({ source, quote });
      for (const signal of found) {
        signals.add(signal);
        if (source !== "list") primary.add(signal);
      }
    }
  }
  const conflict = (signals.has("internship") && (signals.has("campus") || signals.has("social") || signals.has("fulltime"))) ||
    (signals.has("campus") && signals.has("social"));
  const confirmed = jd === undefined ? signals : primary;
  const kind = conflict || !confirmed.size ? "unknown"
    : confirmed.has("internship") ? "internship"
    : confirmed.has("campus") || (confirmed.has("campusCohort") && !confirmed.has("social")) ? "campus"
    : "fulltime";
  return { kind, evidence, conflict };
}

export type BossRequirement = {
  label: string;
  quote: string;
  status: "matched" | "mismatch" | "unknown";
  resumeQuote?: string;
};

const degree = /大专|专科|本科|学士|硕士|研究生|博士/;
function degreeRank(text: string) {
  if (/博士/.test(text)) return 4;
  if (/硕士|研究生/.test(text)) return 3;
  if (/本科|学士/.test(text)) return 2;
  if (/大专|专科/.test(text)) return 1;
  return 0;
}
const chineseNumbers: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const number = (text: string) => chineseNumbers[text] ?? Number(text);
const years = /(\d+(?:\.\d+)?|[一二两三四五六七八九十])\s*(?:[-–—~至到]\s*\d+\s*)?年/;
const workExperience = /(?:工作|从业|开发|岗位|行业)(?:年限|经验)|(?:^|\s)经验(?:要求)?\s*[:：]/;
const weekDays = /每周\s*(?:可|至少|不少于|能|到岗|出勤|实习|工作|\s)*([1-7一二两三四五六七])\s*天/;
const duration = /(\d+|[一二两三四五六七八九十])\s*(?:[-–—~至到]\s*\d+\s*)?个?月|半年/;

function findResumeValue(lines: string[], pattern: RegExp, convert: (match: RegExpMatchArray) => number) {
  for (const quote of lines) {
    const match = normalize(quote).match(pattern);
    if (match) return { value: convert(match), quote };
  }
}

const asYear = (text: string) => text.length === 2 ? 2000 + Number(text) : Number(text);

export function checkBossRequirements(jd: string, resume: string, cities: string[], kind: RecruitmentKind): BossRequirement[] {
  const resumeLines = resume.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const cohortLines = resumeLines.flatMap((quote) => {
    const text = normalize(quote);
    const match = text.match(/\b((?:20)?\d{2})\s*届(?:毕业生|应届生|本科|硕士|博士|学生|[，,。；; ]|$)/)
      ?? text.match(/(?:预计|计划)\s*(20\d\d)\s*年(?:\s*\d{1,2}\s*月)?\s*毕业/);
    return match ? [{ value: asYear(match[1]), quote }] : [];
  });
  const graduation = new Set(cohortLines.map(({ value }) => value)).size === 1 ? cohortLines[0] : undefined;
  const educationLines = parseResumeStructure(resume).filter((section) => section.kind === "education")
    .flatMap((section) => section.lines);
  const highest = resumeLines.find((line) => /^最高学历\s*[:：]/.test(line) && degree.test(line));
  const education = [...educationLines, ...resumeLines.filter((line) => /^(?:最高)?学历\s*[:：]|20\d\d\s*届(?:本科|硕士|博士)/.test(line))]
    .map((quote) => ({ value: degreeRank(quote), quote }))
    .filter(({ value }) => value > 0)
    .sort((a, b) => b.value - a.value)[0];
  const experience = findResumeValue(
    resumeLines,
    /^(?:全职|正式|相关)?工作(?:年限|经验)\s*[:：]\s*(\d+(?:\.\d+)?)\s*年|^(\d+(?:\.\d+)?)\s*年(?:及?以上|\+)?(?:全职|正式)?工作经验/,
    (match) => Number(match[1] ?? match[2]),
  );
  const daysAvailable = findResumeValue(resumeLines, /(?:可|保证|能够|计划)(?:每周|到岗[：:\s]*每周)\s*(?:到岗|出勤|实习|\s)*([1-7一二两三四五六七])\s*天/, (match) => number(match[1]));
  const monthsAvailable = findResumeValue(resumeLines, /(?:可|能够|计划|保证)实习\s*(?:(\d+|[一二两三四五六七八九十])\s*个?月|半年)/, (match) => match[1] ? number(match[1]) : 6);
  const results: BossRequirement[] = [];
  const minimum = (label: string, quote: string, required: number, known?: { value: number; quote: string }, canExclude = true) => {
    const status = !known ? "unknown" : known.value >= required ? "matched" : canExclude ? "mismatch" : "unknown";
    results.push({ label, quote, status, ...(known ? { resumeQuote: known.quote } : {}) });
  };

  for (const quote of clauses(jd)) {
    const parts = quote.split(/[，,](?!\s*(?:20)?\d{2}\s*届)/).map((part) => part.trim());
    for (const part of parts) {
      const text = normalize(part);
      if (preferences.test(text) || unrestricted.test(text)) continue;
      const cohorts = text.match(cohortList);
      if (cohorts && /面向|限|招聘|毕业生|应届|^\s*(?:20)?\d{2}/.test(text) &&
          !/接受|可投/.test(text)) {
        const values = [...cohorts[1].matchAll(new RegExp(cohort, "g"))].map(([value]) => asYear(value));
        const range = values.length === 2 && /[-–—~至到]/.test(cohorts[1]);
        const matched = graduation && (range
          ? graduation.value >= values[0] && graduation.value <= values[1]
          : values.includes(graduation.value));
        results.push({ label: "毕业届别", quote: part, status: graduation ? matched ? "matched" : "mismatch" : "unknown",
          ...(graduation ? { resumeQuote: graduation.quote } : {}) });
      }
      if (degree.test(text) && /学历(?:要求)?\s*[:：]|(?:大专|专科|本科|学士|硕士|研究生|博士)(?:学历|及以上|以上)|(?:要求|需为|仅限).{0,5}(?:大专|本科|硕士|博士)/.test(text)) {
        const levels = [...text.matchAll(/大专|专科|本科|学士|硕士|研究生|博士/g)].map(([name]) => degreeRank(name));
        const alternatives = /或|\/|、/.test(text);
        const needsAward = /已取得|已获得|已毕业/.test(text);
        const known = needsAward && !/已取得|已获得|已毕业/.test(education?.quote ?? "") ? undefined : education;
        minimum("学历", part, alternatives ? Math.min(...levels) : degreeRank(text), known, Boolean(highest));
      }
      if (workExperience.test(text) && !/实习(?:工作)?经验/.test(text)) {
        const required = text.match(years);
        if (required && !/以内|以下|不超过|毕业|或/.test(text))
          minimum("工作年限", part, number(required[1]), experience, !/年\s*(?:及?以上|\+|起)/.test(experience?.quote ?? ""));
        else if (required || /必须|要求|需具备/.test(text))
          results.push({ label: "工作经验", quote: part, status: "unknown" });
      }
      const days = kind === "internship" && text.match(weekDays);
      if (days) minimum("每周到岗", part, number(days[1]), daysAvailable);
      else if (kind === "internship" && /每周.*[\d一二三四五六七].*天/.test(text))
        results.push({ label: "每周到岗", quote: part, status: "unknown" });
      const months = kind === "internship" && /实习|^(?:至少|不少于|连续)/.test(text) && text.match(duration);
      if (months && !/试用期|到岗时间|开始日期/.test(text)) {
        if (/以内|以下|不超过|最多|或/.test(text))
          results.push({ label: "实习时长", quote: part, status: "unknown" });
        else minimum("实习时长", part, months[1] ? number(months[1]) : 6, monthsAvailable);
      }
    }
  }
  if (cities.length) {
    const location = jd.match(/(?:工作地点|工作地址|工作城市|工作地)\s*[:：]\s*([^\r\n。；;]+)/);
    const value = normalize(location?.[1].split(/[，,](?=\s*(?:团队|总部|出差|要求|办公时间))/)[0] ?? "");
    const matches = cities.some((city) => value.includes(normalize(city)));
    const flexible = /远程|全国|不限|可选|待定|多地|出差|总部/.test(value);
    results.push({
      label: "工作地点",
      quote: location?.[0] ?? "",
      status: matches ? "matched" : location && !flexible ? "mismatch" : "unknown",
    });
  }
  return results;
}

const technology = /\b(?:go|golang|java|javascript|typescript|python|rust|swift|kotlin|react|vue(?:\.js)?|angular|svelte|next\.js|node\.js|sql|mysql|postgresql|sqlite|redis|docker|kubernetes|k8s|git|linux|nginx|restful|grpc|html|css|spring(?:\s+boot)?|flask|django|fastapi|graphql|mongodb|elasticsearch|kafka|pytorch|tensorflow|llm|rag|spark|hadoop|excel|figma|selenium|playwright)\b|c\+\+|c#|数据分析|统计建模|自动化测试|性能优化|需求分析|用户研究|跨境电商/gi;
const skillKey = (text: string) => normalize(text).toLowerCase().replace(/^(?:golang|vue\.js)$/, (term) => term === "golang" ? "go" : "vue");
export function bossSkillEvidence(jd: string, resume: string) {
  const requirements = new Map<string, string>();
  for (const quote of clauses(jd)) {
    for (const term of normalize(quote).match(technology) ?? []) {
      const key = skillKey(term);
      if (!requirements.has(key)) requirements.set(key, quote);
    }
  }
  const matches = new Map<string, { skill: string; quote: string; resumeQuote: string }>();
  for (const resumeQuote of resume.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)) {
    if (/暂无|未掌握|未接触|尚未|没有相关/.test(resumeQuote)) continue;
    for (const term of normalize(resumeQuote).match(technology) ?? []) {
      const key = skillKey(term);
      const quote = requirements.get(key);
      if (quote && !matches.has(key)) matches.set(key, { skill: term, quote, resumeQuote });
    }
  }
  return [...matches.values()];
}
