import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  groundedTailoringSchema,
  tailoringSections,
} from "../../src/domain/resume-tailoring.js";
import { classifyBossRecruitment } from "../../src/domain/boss-recruitment.js";
import { formFieldSchema, matchFormField } from "../../src/domain/form-fields.js";
import { auditResumeRisks } from "../../src/domain/resume-risk-audit.js";
import { analyzeJdGap } from "../../src/domain/jd-gap-analysis.js";
import type { ResumeProfileData } from "../../src/domain/resume-profile.js";

const root = fileURLToPath(new URL("../../", import.meta.url));

type TailoringCase = {
  id: string;
  category: string;
  resume: string;
  jd: string;
  lineMatch: string;
  after: string;
  expectedBlocked: boolean;
};

type RecruitmentCase = {
  id: string;
  title: string;
  list: string;
  jd?: string;
  facts?: { experience: string; salary: string; education: string };
  expectedKind: string;
  expectedConflict: boolean;
};

type FormCase = {
  id: string;
  field: Record<string, unknown>;
  expectedPath?: string;
  expectedValue?: string;
  expectedBlocked?: boolean;
};

const syntheticProfile: ResumeProfileData = {
  contact: {
    name: "林示例",
    email: "lin@example.com",
    phone: "13800138000",
    city: "杭州",
    github: "https://github.com/example-lin",
    portfolio: "",
  },
  experiences: [
    {
      kind: "education",
      organization: "示例大学",
      title: "计算机科学与技术",
      degree: "本科",
      start: "2020-09",
      end: "2024-06",
      summary: "主修操作系统与分布式基础",
    },
    {
      kind: "work",
      organization: "示例科技",
      title: "后端工程师",
      degree: "",
      start: "2024-07",
      end: "2025-06",
      summary: "负责核心订单服务开发",
    },
    {
      kind: "work",
      organization: "云帆软件",
      title: "高级后端工程师",
      degree: "",
      start: "2025-07",
      end: "至今",
      summary: "负责网关稳定性治理",
    },
    {
      kind: "project",
      organization: "订单网关",
      title: "核心后端开发",
      degree: "",
      start: "2024-08",
      end: "2025-05",
      summary: "基于 Go 和 Redis 构建接口网关",
    },
  ],
};

function rate(numerator: number, denominator: number) {
  return denominator === 0 ? 1 : Number((numerator / denominator).toFixed(4));
}

async function runTailoringEval() {
  const cases = JSON.parse(
    await readFile(resolve(root, "eval/datasets/tailoring-guardrail.json"), "utf8"),
  ) as TailoringCase[];
  let tp = 0,
    fp = 0,
    tn = 0,
    fn = 0;
  const badcases: Array<{ id: string; category: string; detail: string }> = [];

  for (const item of cases) {
    const sections = tailoringSections(item.resume);
    let targetSectionId = "";
    let targetLineIndex = -1;
    for (const section of sections) {
      const idx = section.lines.findIndex((line) => line.includes(item.lineMatch));
      if (idx >= 0) {
        targetSectionId = section.id;
        targetLineIndex = idx;
        break;
      }
    }
    if (!targetSectionId) {
      throw new Error(`Eval 样本 ${item.id} 未匹配到行：${item.lineMatch}`);
    }
    const plan = {
      company: "测试公司",
      role: "测试岗位",
      sectionOrder: sections.map((s) => s.id),
      changes: [
        {
          sectionId: targetSectionId,
          lineIndex: targetLineIndex,
          after: item.after,
          requirement: item.jd.slice(0, 60),
          reason: "对齐 JD 表达",
        },
      ],
      highlights: [],
      gaps: [],
    };
    const parsed = groundedTailoringSchema(item.resume, item.jd, {
      job: { company: "测试公司", role: "测试岗位" },
      partial: true,
    }).parse(plan);
    const actualBlocked = parsed.changes.length === 0;
    if (item.expectedBlocked && actualBlocked) tp++;
    else if (!item.expectedBlocked && !actualBlocked) tn++;
    else if (!item.expectedBlocked && actualBlocked) {
      fp++;
      badcases.push({
        id: item.id,
        category: item.category,
        detail: `误杀合法改写: ${(parsed.notices ?? []).join("; ")}`,
      });
    } else {
      fn++;
      badcases.push({
        id: item.id,
        category: item.category,
        detail: "漏检幻觉/违规改写",
      });
    }
  }

  const precision = rate(tp, tp + fp);
  const recall = rate(tp, tp + fn);
  const f1 =
    precision + recall === 0
      ? 0
      : Number(((2 * precision * recall) / (precision + recall)).toFixed(4));
  const fpr = rate(fp, fp + tn);
  const fnr = rate(fn, fn + tp);
  const accuracy = rate(tp + tn, cases.length);
  return {
    name: "tailoring-guardrail",
    total: cases.length,
    tp,
    fp,
    tn,
    fn,
    precision,
    recall,
    f1,
    falsePositiveRate: fpr,
    falseNegativeRate: fnr,
    accuracy,
    badcases,
  };
}

async function runRecruitmentEval() {
  const cases = JSON.parse(
    await readFile(resolve(root, "eval/datasets/boss-recruitment.json"), "utf8"),
  ) as RecruitmentCase[];
  let passed = 0;
  const badcases: Array<{ id: string; detail: string }> = [];
  for (const item of cases) {
    const result = classifyBossRecruitment(
      item.title,
      item.list,
      item.jd,
      item.facts
        ? { ...item.facts, company: "", location: "" }
        : undefined,
    );
    if (
      result.kind === item.expectedKind &&
      result.conflict === item.expectedConflict
    ) {
      passed++;
    } else {
      badcases.push({
        id: item.id,
        detail: `expected (${item.expectedKind}, conflict=${item.expectedConflict}), got (${result.kind}, conflict=${result.conflict})`,
      });
    }
  }
  return {
    name: "boss-recruitment",
    total: cases.length,
    passed,
    accuracy: rate(passed, cases.length),
    badcases,
  };
}

async function runFormMatchingEval() {
  const cases = JSON.parse(
    await readFile(resolve(root, "eval/datasets/form-matching.json"), "utf8"),
  ) as FormCase[];
  let passed = 0;
  const badcases: Array<{ id: string; detail: string }> = [];
  for (const item of cases) {
    const field = formFieldSchema.parse(item.field);
    const matched = matchFormField(field, syntheticProfile);
    if (item.expectedBlocked) {
      if (!matched.path && !matched.value && matched.reason) passed++;
      else
        badcases.push({
          id: item.id,
          detail: `expected blocked, got ${JSON.stringify(matched)}`,
        });
    } else {
      const pathOk = matched.path === item.expectedPath;
      const valueOk =
        item.expectedValue === undefined || matched.value === item.expectedValue;
      if (pathOk && valueOk) passed++;
      else
        badcases.push({
          id: item.id,
          detail: `expected (${item.expectedPath}, ${item.expectedValue}), got ${JSON.stringify(matched)}`,
        });
    }
  }
  return {
    name: "form-matching",
    total: cases.length,
    passed,
    accuracy: rate(passed, cases.length),
    badcases,
  };
}

async function runRiskAndGapEval() {
  const dataset = JSON.parse(
    await readFile(resolve(root, "eval/datasets/resume-risk-and-gap.json"), "utf8"),
  ) as {
    riskAuditCases: Array<{
      id: string;
      resume: string;
      expectedHighRisk: boolean;
      expectedMinMedium?: number;
    }>;
    jdGapCases: Array<{
      id: string;
      role: string;
      jd: string;
      resume: string;
      expectedPrimaryTrack: string;
      expectedFitLevel: string;
      expectRiskIsolation: boolean;
    }>;
  };
  let riskPassed = 0;
  const riskBadcases: Array<{ id: string; detail: string }> = [];
  for (const item of dataset.riskAuditCases) {
    const result = auditResumeRisks(item.resume);
    const hasHigh = result.summary.highCount > 0;
    const mediumOk =
      item.expectedMinMedium === undefined ||
      result.summary.mediumCount >= item.expectedMinMedium;
    if (hasHigh === item.expectedHighRisk && mediumOk) riskPassed++;
    else
      riskBadcases.push({
        id: item.id,
        detail: `expected (highRisk=${item.expectedHighRisk}, minMedium=${item.expectedMinMedium ?? 0}), got (high=${result.summary.highCount}, medium=${result.summary.mediumCount})`,
      });
  }
  let gapPassed = 0;
  const gapBadcases: Array<{ id: string; detail: string }> = [];
  for (const item of dataset.jdGapCases) {
    const result = analyzeJdGap(item.resume, item.jd, item.role);
    const hasIsolation = result.riskIsolations.length > 0;
    if (
      result.primaryTrack === item.expectedPrimaryTrack &&
      result.fitLevel === item.expectedFitLevel &&
      hasIsolation === item.expectRiskIsolation
    ) {
      gapPassed++;
    } else {
      gapBadcases.push({
        id: item.id,
        detail: `expected (${item.expectedPrimaryTrack}, ${item.expectedFitLevel}, isolation=${item.expectRiskIsolation}), got (${result.primaryTrack}, ${result.fitLevel}, isolation=${hasIsolation})`,
      });
    }
  }
  return {
    riskAudit: {
      name: "resume-risk-audit",
      total: dataset.riskAuditCases.length,
      passed: riskPassed,
      accuracy: rate(riskPassed, dataset.riskAuditCases.length),
      badcases: riskBadcases,
    },
    jdGap: {
      name: "jd-gap-isolation",
      total: dataset.jdGapCases.length,
      passed: gapPassed,
      accuracy: rate(gapPassed, dataset.jdGapCases.length),
      badcases: gapBadcases,
    },
  };
}

const tailoring = await runTailoringEval();
const recruitment = await runRecruitmentEval();
const formMatching = await runFormMatchingEval();
const { riskAudit, jdGap } = await runRiskAndGapEval();

const report = {
  evaluatedAt: new Date().toISOString(),
  node: process.version,
  suites: { tailoring, recruitment, formMatching, riskAudit, jdGap },
};

console.log(JSON.stringify(report, null, 2));

const failed =
  tailoring.falseNegativeRate > 0 ||
  tailoring.falsePositiveRate > 0 ||
  recruitment.accuracy < 1 ||
  formMatching.accuracy < 1 ||
  riskAudit.accuracy < 1 ||
  jdGap.accuracy < 1;

if (failed) {
  console.error("离线 Eval 阈值未达标，请检查 badcases。");
  process.exitCode = 1;
}
