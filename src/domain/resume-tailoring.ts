import { z } from "zod";
import { parseResumeStructure } from "./resume-structure.js";
import { rewriteFactProblem } from "./resume-tailoring-policy.js";

export function tailoringSections(rawText: string) {
  return parseResumeStructure(rawText).map((section, index) => ({
    id: `section-${index}`,
    title: section.title,
    kind: section.kind,
    lines: section.lines,
  }));
}
type TailoringSection = ReturnType<typeof tailoringSections>[number];
const tailoringPlanSchema = z
  .object({
    company: z.string().trim().max(120),
    role: z.string().trim().max(120),
    sectionOrder: z.array(z.string()).min(1).max(100),
    changes: z
      .array(
        z
          .object({
            sectionId: z.string(),
            lineIndex: z.number().int().nonnegative(),
            after: z.string().trim().min(1).max(3000),
            requirement: z.string().trim().min(1).max(600),
            requirementId: z.string().max(40).optional(),
            requirementQuote: z.string().max(1200).optional(),
            reason: z.string().trim().min(1).max(400),
          })
          .strict(),
      )
      .max(80),
    highlights: z
      .array(
        z
          .object({
            sectionId: z.string(),
            lineIndex: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(3),
    gaps: z.array(z.string().trim().min(1).max(400)).max(8),
    notices: z.array(z.string().trim().min(1).max(200)).max(8).optional(),
  })
  .strict();
export type TailoringPlan = z.infer<typeof tailoringPlanSchema>;
const compact = (value: string) => value.normalize("NFKC").replace(/\s/g, "").toLowerCase();
export function tailoringRequirements(jd: string) {
  return jd.split(/[\r\n。；;]/).map((line) => line.trim()).filter(Boolean)
    .slice(0, 120).map((quote, index) => ({ id: `jd-${index + 1}`, quote: quote.slice(0, 1200) }));
}

export function groundedTailoringSchema(
  rawText: string,
  jd: string,
  options: { job?: { company: string; role: string }; partial?: boolean } = {},
) {
  const sections = tailoringSections(rawText);
  const requirements = tailoringRequirements(jd);
  return tailoringPlanSchema.transform((plan, ctx) => {
    const notices = new Set<string>();
    const fail = (message: string) => {
      if (options.partial) notices.add(message);
      else ctx.addIssue({ code: "custom", message });
    };
    const ids = sections.map((section) => section.id);
    const orderInvalid =
      plan.sectionOrder.length !== ids.length ||
      new Set(plan.sectionOrder).size !== ids.length ||
      plan.sectionOrder.some((id) => !ids.includes(id)) ||
      (sections[0]?.kind === "general" && plan.sectionOrder[0] !== sections[0].id);
    if (orderInvalid) fail("章节排序无法核对，已采用原顺序");
    const changed = new Set<string>();
    const changes: TailoringPlan["changes"] = [];
    for (const { requirementQuote: _providedQuote, ...change } of plan.changes) {
      const section = sections.find((item) => item.id === change.sectionId);
      const key = tailoringChangeKey(change);
      if (!section?.lines[change.lineIndex] || changed.has(key)) {
        fail("修改位置不存在或重复");
        continue;
      }
      const problem = rewriteFactProblem(section, change.lineIndex, change.after, rawText);
      if (problem) {
        fail(`${section.title}第 ${change.lineIndex + 1} 条：${problem}`.slice(0, 200));
        continue;
      }
      changed.add(key);
      const cited = requirements.find(({ id }) => id === change.requirementId) ??
        requirements.find(({ quote }) => compact(quote).includes(compact(change.requirement)));
      changes.push(cited
        ? { ...change, requirementId: cited.id, requirementQuote: cited.quote }
        : change);
    }
    const highlights = plan.highlights.filter((item) =>
      !!sections.find((section) => section.id === item.sectionId)?.lines[item.lineIndex],
    );
    if (highlights.length !== plan.highlights.length) fail("部分邮件引用的经历位置不存在");
    for (const notice of plan.notices ?? []) notices.add(notice);
    const legacyName = (value: string) => compact(jd).includes(compact(value)) ? value : "";
    return {
      ...plan,
      company: options.job?.company ?? legacyName(plan.company),
      role: options.job?.role ?? legacyName(plan.role),
      sectionOrder: orderInvalid ? ids : plan.sectionOrder,
      changes,
      highlights,
      ...(notices.size ? { notices: [...notices].slice(0, 8) } : {}),
    };
  });
}
export const tailoringChangeKey = (change: {
  sectionId: string;
  lineIndex: number;
}) => `${change.sectionId}:${change.lineIndex}`;
function tailoringSourceRanges(
  rawText: string,
  sections: TailoringSection[],
) {
  const positions: number[] = [];
  let normalized = "";
  for (let index = 0; index < rawText.length; index++)
    if (!/\s/.test(rawText[index])) {
      normalized += rawText[index];
      positions.push(index);
    }
  let cursor = 0;
  const ranges = new Map<string, { start: number; end: number }>();
  for (const section of sections)
    for (const [lineIndex, line] of section.lines.entries()) {
      const quote = line.replace(/\s/g, "");
      const match = normalized.indexOf(quote, cursor);
      const key = tailoringChangeKey({ sectionId: section.id, lineIndex });
      if (match < 0 || !quote) continue;
      cursor = match + quote.length;
      ranges.set(key, {
        start: positions[match],
        end: positions[cursor - 1] + 1,
      });
    }
  return ranges;
}
/** Keep the original formatting outside the accepted replacements. */
export function tailoredOriginalResumeText(
  rawText: string,
  sections: TailoringSection[],
  plan: TailoringPlan,
  accepted: ReadonlySet<string>,
) {
  const ranges = tailoringSourceRanges(rawText, sections);
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  for (const section of sections)
    for (const [lineIndex] of section.lines.entries()) {
      const key = tailoringChangeKey({ sectionId: section.id, lineIndex });
      const change = plan.changes.find(
        (change) => tailoringChangeKey(change) === key,
      );
      if (!change || !accepted.has(key)) continue;
      const range = ranges.get(key);
      if (!range)
        throw new Error("这条内容无法对应到上传原文，请核对后再修改。");
      replacements.push({ ...range, text: change.after });
    }
  let text = rawText;
  for (const replacement of replacements.reverse())
    text =
      text.slice(0, replacement.start) +
      replacement.text +
      text.slice(replacement.end);
  return text;
}
