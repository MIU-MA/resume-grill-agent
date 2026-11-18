import { matchesJobTitle } from "./job-search.js";

const intent =
  /^(?:求职(?:意向|方向|岗位|目标)|目标(?:岗位|职位)|期望(?:岗位|职位)|应聘(?:岗位|职位)|target role|desired position)\s*[:：]?\s*/i;
const contact =
  /@|https?:|\b\d{7,}\b|邮箱|电话|手机号|微信|姓名|密码|身份证|现居|到岗|薪资/i;
const roles = [
  ["AI 应用开发", "大模型应用", "LLM 应用"],
  ["前端开发", "前端", "Frontend"],
  ["后端开发", "后端", "Backend"],
  ["全栈开发", "全栈", "Full Stack"],
  ["数据分析", "Data Analyst"],
  ["数据工程", "数据开发", "Data Engineer"],
  ["机器学习", "算法工程师"],
  ["软件测试", "测试开发", "QA Engineer"],
  ["运维工程师", "DevOps", "SRE"],
  ["嵌入式开发", "嵌入式"],
  ["产品经理", "产品运营"],
  ["交互设计", "视觉设计", "平面设计", "UI设计", "UX设计"],
  ["电气工程师", "机械工程师"],
  ["财务", "会计", "审计"],
  ["市场营销", "新媒体运营", "内容运营", "销售"],
  ["人力资源", "招聘专员"],
  ["供应链", "采购"],
  ["教师", "护士", "法务", "视频剪辑", "游戏策划"],
];
const roleEnding =
  /(?:工程师|开发(?:实习生)?|分析师|研究员|设计师|策划|运营(?:实习生)?|助理|专员|顾问|经理|教师|护士|会计|审计|法务|engineer|developer|analyst|designer|manager|specialist|consultant)(?:\s*(?:实习生?|岗|intern))?$/i;

function direction(value: string) {
  const term = value
    .normalize("NFKC")
    .split(/[，,；;|、]/, 1)[0]
    .trim()
    .replace(/[。.]$/, "");
  return term.length >= 2 &&
    term.length <= 40 &&
    !contact.test(term) &&
    /^[\p{L}\p{N}\s+#/.&()·-]+$/u.test(term) &&
    !/^(?:不限|待定|均可|实习生?|开发|工程师|职员|管理|resume|intern)$/i.test(term)
    ? term
    : undefined;
}

/** Extract a short role label, never a raw résumé paragraph. */
export function resumeSearchDirection(
  text: string,
  name: string,
  knownDirections: readonly string[] = [],
): string | undefined {
  const lines = text
    .normalize("NFKC")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const [index, line] of lines.entries()) {
    if (!intent.test(line)) continue;
    const value = line.replace(intent, "").trim();
    const term = direction(value || lines[index + 1] || "");
    if (term && (value || roleEnding.test(term) ||
      roles.some((group) => matchesJobTitle(term, group))))
      return term;
  }
  for (const value of knownDirections) {
    const term = direction(value);
    if (term) return term;
  }

  const filename = name.normalize("NFKC")
    .replace(/\.(?:pdf|docx?|txt|md)$/i, "")
    .replace(/(?:\s*\(\d+\)|\s*v\d+|\s*简历)+$/gi, "")
    .trim();
  const fileRole = filename.split(/\s*[-_—·]\s*/).at(-1) ?? "";
  const title = direction(fileRole);
  if (title && roleEnding.test(title) && !/^(个人|求职|应届|最新|正式|通用)/.test(title))
    return title;

  const counts = roles
    .map((group) => ({
      query: group[0],
      count: lines.filter(
        (line) => !contact.test(line) && matchesJobTitle(line, group),
      ).length,
    }))
    .sort((a, b) => b.count - a.count);
  return counts[0].count > counts[1].count ? counts[0].query : undefined;
}
