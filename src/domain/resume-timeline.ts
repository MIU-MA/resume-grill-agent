import type { parseResumeStructure } from "./resume-structure.js";

type Section = ReturnType<typeof parseResumeStructure>[number];
const monthDate = "((?:19|20)\\d{2})\\s*[./年-]\\s*(0?[1-9]|1[0-2])月?";
const timelineRange = new RegExp(
  `(?<!\\d)${monthDate}\\s*(?:至今|[-–—~～至到]\\s*(?:${monthDate}|至今|现在|Present|Current)|(?:至\\s*)?今)(?!\\d)`,
  "i",
);
const nonEmployment = /实习|兼职|志愿|校内|课程设计|intern(?:ship)?\b|part[- ]time|volunteer/i;
const duty = /^(?:[-*•]\s*|\d+[.、]\s*)?(?:负责|参与|主导|协助|使用|维护|完成|荣获)/;
const month = (year: string, value: string) => Number(year) * 12 + Number(value) - 1;

function datedEntries(section: Section) {
  const rows = section.lines.flatMap((line, index) => {
    const match = line.normalize("NFKC").match(timelineRange);
    return match && !duty.test(line) ? [{ line, index, match }] : [];
  });
  const metadata = (line?: string) => line && !duty.test(line) && !timelineRange.test(line) ? line : "";
  const labelBefore = !!metadata(section.lines[(rows[0]?.index ?? 0) - 1]);
  return rows.map(({ line, index, match }, position) => {
    // PDF extraction often places the employer or degree on its own line.
    const standalone = line.normalize("NFKC").trim() === match[0];
    const before = standalone && labelBefore ? metadata(section.lines[index - 1]) : "";
    const after = (standalone && !labelBefore) || index + 2 < (rows[position + 1]?.index ?? Infinity)
      ? metadata(section.lines[index + 1]) : "";
    return {
      start: month(match[1], match[2]),
      end: match[3] ? month(match[3], match[4]) : undefined,
      endYear: match[3] ? Number(match[3]) : undefined,
      quote: [before, line, after].filter(Boolean).join("\n"),
      heading: [before, line, after].filter(Boolean).join(" "),
    };
  });
}

export function workTimelineEvidence(sections: Section[], today = new Date()) {
  const now = today.getFullYear() * 12 + today.getMonth();
  const periods = sections.flatMap((section) => {
    if (section.kind === "work") return datedEntries(section);
    if (section.kind === "custom" && /工作.*实习|work and internship/i.test(section.title))
      return datedEntries(section).filter(({ heading }) => /全职|full[- ]time/i.test(heading));
    return [];
  })
    .filter(({ heading }) => !nonEmployment.test(heading))
    .map(({ start, end, quote }) => ({ start, end: Math.min(end ?? now, now), quote }))
    .filter(({ start, end }) => end > start)
    .sort((a, b) => a.start - b.start);
  if (!periods.length) return undefined;
  let months = 0;
  let countedThrough = periods[0].start;
  for (const { start, end } of periods) {
    months += Math.max(0, end - Math.max(start, countedThrough));
    countedThrough = Math.max(countedThrough, end);
  }
  return { value: months / 12, quote: periods.map(({ quote }) => quote).join("\n"), months };
}

export function educationTimelineEvidence(sections: Section[], degreeRank: (text: string) => number) {
  const entries = sections.filter(({ kind }) => kind === "education").flatMap(datedEntries)
    .filter(({ start, end }) => end === undefined || end > start)
    .map((entry) => ({ ...entry, degree: degreeRank(entry.heading) }));
  const highest = Math.max(0, ...entries.map(({ degree }) => degree));
  const relevant = highest && entries.every(({ degree }) => degree > 0)
    ? entries.filter(({ degree }) => degree === highest)
    : entries;
  const years = new Set(relevant.map(({ endYear }) => endYear));
  const entry = relevant[0];
  if (years.size === 1 && entry.endYear !== undefined)
    return { value: entry.endYear, quote: entry.quote };
}
