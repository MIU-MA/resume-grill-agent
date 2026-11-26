import type { CareerDiscovery, CareerPage } from "./contracts.js";
import { sourceUrlSchema } from "./contracts.js";
import { matchesJobTitle, searchKeywords } from "../../domain/job-search.js";
import { discoverCareers } from "./career-discovery.js";
import { readCareerPage } from "./public-page.js";
import { discoverBrowserCareers } from "./browser-careers.js";
import {
  discoverTencentCareers,
  isTencentCareer,
  readTencentCareer,
} from "./tencent-careers.js";

export async function discoverRecruitingPage(
  input: string,
  keywords: string[] = [],
  tools = {
    static: discoverCareers,
    browser: discoverBrowserCareers,
    tencent: discoverTencentCareers,
  },
  limits?: { deadline: number; maxPages: number },
): Promise<CareerDiscovery> {
  sourceUrlSchema.parse(input);
  keywords = searchKeywords(keywords);
  let spent = 0;
  if (isTencentCareer(input)) {
    try {
      return await tools.tencent(input, keywords, undefined, {
        deadline: limits?.deadline,
        maxRequests: limits?.maxPages,
      });
    } catch {
      /* Keep the original page reader available if the public API fails. */
      spent++;
    }
  }
  if (limits && (limits.maxPages <= spent || Date.now() >= limits.deadline))
    throw new Error("已达到招聘页读取限额");
  let initial: CareerDiscovery | undefined;
  let staticError: unknown;
  try {
    initial = await tools.static(input, undefined, limits && { ...limits, maxPages: 1 });
  } catch (error) {
    staticError = error;
    /* A browser can read script-generated navigation and redirects. */
  }
  spent += Math.max(1, initial?.pagesRead ?? 0);
  const titles = [
    ...(initial?.pages ?? []).flatMap((page) => [
      page.role,
      ...(page.jobs ?? []).map((job) => job.role),
    ]),
    ...(initial?.links ?? [])
      .filter((link) => link.kind === "job")
      .map((link) => link.label),
  ].filter(Boolean);
  if (
    titles.length &&
    (!keywords.length ||
      titles.some((title) => matchesJobTitle(title, keywords)))
  )
    return { ...initial!, pagesRead: spent };
  if (limits && (limits.maxPages <= spent || Date.now() >= limits.deadline)) {
    if (initial) return { ...initial, pagesRead: spent, partial: true };
    throw staticError ?? new Error("已达到招聘页读取限额");
  }
  try {
    const rendered = await tools.browser(input, keywords, limits && {
      deadline: limits.deadline,
      maxPages: limits.maxPages - spent,
    });
    if (!initial) return { ...rendered, pagesRead: spent + rendered.pagesRead };
    return {
      ...rendered,
      pagesRead: spent + rendered.pagesRead,
      pages: [
        ...new Map(
          [...(initial?.pages ?? []), ...(rendered.pages ?? [])].map((page) => [
            `${page.url}\n${page.role}`,
            page,
          ]),
        ).values(),
      ],
      listingRead: initial?.listingRead || rendered.listingRead,
      partial: initial.partial || rendered.partial,
      links: [
        ...new Map(
          [...(initial?.links ?? []), ...rendered.links].map((link) => [
            link.url,
            link,
          ]),
        ).values(),
      ],
      notes: [...(initial?.notes ?? []), ...rendered.notes],
    };
  } catch (error) {
    if (initial)
      return {
        ...initial,
        pagesRead: Math.max(spent + 1, limits?.maxPages ?? 0),
        partial: true,
        notes: [
          ...initial.notes,
          `动态读取未完成，已保留原网页的链接和内容。${error instanceof Error ? error.message : ""}`,
        ],
      };
    throw error;
  }
}
export async function readRecruitingDetail(input: string): Promise<CareerPage> {
  sourceUrlSchema.parse(input);
  if (isTencentCareer(input) && new URL(input).searchParams.has("postId"))
    return readTencentCareer(input);
  let original: CareerPage | undefined;
  try {
    original = await readCareerPage(input);
    if (original.role && original.jobDescription) return original;
  } catch {
    /* Use rendered detail. */
  }
  try {
    const result = await discoverBrowserCareers(input, [], { detail: true });
    const detail = result.pages?.find(
      (page) => page.role && page.jobDescription,
    );
    if (detail) return detail;
    if (original) return original;
    throw new Error("招聘详情尚未加载出职责和要求，请重试此来源");
  } catch (error) {
    if (original)
      return {
        ...original,
        notes: [...original.notes, "动态详情未加载，保留原页面信息。"],
      };
    throw error;
  }
}
