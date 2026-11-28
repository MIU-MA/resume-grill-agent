import { parseResumeStructure } from "./resume-structure.js";
import type { ResumeRiskReport } from "./resume-risk-audit.js";
import type { JdGapAnalysis } from "./jd-gap-analysis.js";

export type GrillTopicSource = "risk" | "tailored" | "experience";

export type InterviewGrillTopic = {
  id: string;
  source: GrillTopicSource;
  sectionTitle: string;
  quote: string;
  layer1FactCheck: string;
  layer2TradeOff: string;
  layer3StressAndFailure: string;
  antiBsChallenge: string;
  weakPointAtLayer3: string;
  conservativeMetricReply: string;
};

export type InterviewGrillPlan = {
  target: {
    company: string;
    role: string;
    fitLevel?: JdGapAnalysis["fitLevel"];
    primaryTrackLabel?: string;
  };
  topics: InterviewGrillTopic[];
  pitch1MinOutline: {
    maxChars: number;
    steps: string[];
    rules: string[];
  };
  pitch5MinOutline: string[];
  doNotSayList: string[];
};

const METRIC_FALLBACK =
  "若缺乏线上压测或监控数据，直接说明未统计线上百分比，转而阐述瓶颈定位路径、代码边界与自动化测试/本地基准验证方式。";

function inferLayer3Stress(quote: string): {
  stress: string;
  weakPoint: string;
} {
  if (/agent|llm|大模型|prompt|rag|模型|ai/i.test(quote)) {
    return {
      stress:
        "如果上游模型返回不稳定、出现幻觉/提示词注入，或上下文与 Token 成本激增，系统如何在代码层硬兜底与降级？",
      weakPoint:
        "说不清 Prompt 软引导与代码硬护栏的边界，或拿不出离线 Eval 误杀率/漏检率评估思路。",
    };
  }
  if (/缓存|redis|索引|sql|sqlite|mysql|postgres|查询|存储/i.test(quote)) {
    return {
      stress:
        "当数据量放大 100 倍或并发写加剧时，索引失效、缓存一致性、慢查询与锁竞争最先暴露在哪里？如何平滑演进？",
      weakPoint:
        "说不清读写路径、锁升级/并发冲突边界、缓存失效策略与从单机向分布式演进的取舍。",
    };
  }
  if (/并发|异步|队列|批|消息|事务|幂等|重试|状态机/i.test(quote)) {
    return {
      stress:
        "若网络超时导致「外部已执行但回执未落盘」或进程崩溃重启，如何防止重复执行与状态错乱？",
      weakPoint:
        "混淆 At-Least-Once 与 At-Most-Once 语义，说不清事务边界、幂等键设计与未知态（uncertain）人工兜底。",
    };
  }
  if (/安全|权限|ssrf|csrf|隔离|鉴权|抓取|爬虫|浏览器/i.test(quote)) {
    return {
      stress:
        "面对恶意输入（如 302 跳转内网、DNS 重绑定、跨站请求或异常大包），你的纵深防线有哪几层？哪一层最薄弱？",
      weakPoint:
        "只讲表层黑名单校验，说不清 TOCTOU 时间窗、资源流式上限或信任边界假设。",
    };
  }
  return {
    stress:
      "如果请求量、数据规模扩大 10 倍，或外部依赖出现超时与部分失败，当前设计最先扛不住哪个环节？怎么改造？",
    weakPoint:
      "只停留在正常主流程功能描述，缺乏故障模式分析（Failure Mode）与架构演进预案。",
  };
}

export function buildInterviewGrill(options: {
  resumeText: string;
  job?: { company: string; role: string; jd: string };
  riskAudit: ResumeRiskReport;
  jdGapAnalysis?: JdGapAnalysis;
  tailoredQuotes?: Array<{ sectionTitle?: string; after: string; requirement?: string }>;
}): InterviewGrillPlan {
  const { resumeText, job, riskAudit, jdGapAnalysis, tailoredQuotes = [] } =
    options;
  const topics: InterviewGrillTopic[] = [];
  const usedQuotes = new Set<string>();

  const pushTopic = (topic: Omit<InterviewGrillTopic, "id">) => {
    const key = topic.quote.replace(/\s+/g, "").slice(0, 48);
    if (!key || usedQuotes.has(key) || topics.length >= 5) return;
    usedQuotes.add(key);
    topics.push({ ...topic, id: `grill-${topics.length + 1}` });
  };

  // Priority 1: High-severity anti-BS risk items (most likely to be grilled hard)
  for (const finding of riskAudit.findings) {
    if (finding.severity !== "high" && topics.length >= 2) continue;
    const { stress } = inferLayer3Stress(finding.line);
    pushTopic({
      source: "risk",
      sectionTitle: finding.sectionTitle,
      quote: finding.line,
      layer1FactCheck: `你在简历中写了「${finding.matchedTerm}」，请具体说明本人负责的模块边界、代码入口和可验证产出。`,
      layer2TradeOff:
        "当时为什么选择这个方案而不是更简单的替代实现？该设计牺牲了什么代价（Trade-off）？",
      layer3StressAndFailure: stress,
      antiBsChallenge: finding.interviewerChallenge,
      weakPointAtLayer3: finding.weakPointAtLayer3,
      conservativeMetricReply: METRIC_FALLBACK,
    });
  }

  // Priority 2: Tailored lines modified specifically for this job
  for (const change of tailoredQuotes) {
    const quote = change.after.trim().slice(0, 220);
    const { stress, weakPoint } = inferLayer3Stress(quote);
    pushTopic({
      source: "tailored",
      sectionTitle: change.sectionTitle ?? "本岗位定制修改项",
      quote,
      layer1FactCheck: `这条是针对目标岗位重点突出的经历${change.requirement ? `（对应要求：${change.requirement.slice(0, 60)}）` : ""}，请讲清核心调用链与关键代码实现。`,
      layer2TradeOff:
        "这个方案对比其他成熟实践的取舍是什么？如果不这么设计会遇到什么真实工程问题？",
      layer3StressAndFailure: stress,
      antiBsChallenge:
        "面试官会重点核验你是否真的亲手写过该链路，还是只为了贴合 JD 做了措辞包装。",
      weakPointAtLayer3: weakPoint,
      conservativeMetricReply: METRIC_FALLBACK,
    });
  }

  // Priority 3: Core work / project bullet lines from resume
  const sections = parseResumeStructure(resumeText);
  const bulletPattern = /^(?:[-*•·●▪]|\d+[.)、])/;
  for (const section of sections) {
    if (!["work", "project", "experience"].includes(section.kind)) continue;
    for (const rawLine of section.lines) {
      const line = rawLine.trim();
      if (line.length < 18) continue;
      if (!bulletPattern.test(line) && !/负责|参与|设计|实现|优化|构建|开发/.test(line))
        continue;
      const { stress, weakPoint } = inferLayer3Stress(line);
      pushTopic({
        source: "experience",
        sectionTitle: section.title,
        quote: line.slice(0, 220),
        layer1FactCheck:
          "请用具体模块名、接口入口与数据流向讲清楚你在这段经历里实际落地了什么。",
        layer2TradeOff:
          "核心设计上做了哪些技术选型与 Trade-off？这套方案引入了什么复杂度或限制？",
        layer3StressAndFailure: stress,
        antiBsChallenge:
          "如果面试官要求现场画出这段链路的异常处理和状态流转图，你能否直接落到具体字段与边界条件？",
        weakPointAtLayer3: weakPoint,
        conservativeMetricReply: METRIC_FALLBACK,
      });
    }
  }

  const doNotSayList = [
    ...new Set([
      ...riskAudit.findings.map(
        (f) => `慎用「${f.matchedTerm}」：${f.suggestedReplacement}`,
      ),
      ...(jdGapAnalysis?.riskIsolations ?? []),
      "严禁虚构未经实测的 QPS、延迟下降百分比、用户规模或模型准确率。",
    ]),
  ].slice(0, 8);

  return {
    target: {
      company: job?.company ?? "",
      role: job?.role ?? "通用目标岗位",
      ...(jdGapAnalysis
        ? {
            fitLevel: jdGapAnalysis.fitLevel,
            primaryTrackLabel: jdGapAnalysis.primaryTrackLabel,
          }
        : {}),
    },
    topics,
    pitch1MinOutline: {
      maxChars: 250,
      steps: [
        "1. 业务痛点与系统定位（1 句话说清系统解决什么真实问题、偏一致性还是吞吐）",
        "2. 核心主链路（从入口到存储/外部执行的关键闭环）",
        "3. 本人真实贡献边界（明确模块设计与落地范围，不夸大主导度）",
        "4. 架构价值与核心取舍（用真实机制与可验证事实收尾，不堆空洞名词）",
      ],
      rules: [
        "总字数控制在 250 字以内，适合 45–60 秒自然口述。",
        "无实测监控/压测数据时不报虚构百分比与千万级规模。",
      ],
    },
    pitch5MinOutline: [
      "1. 项目背景与真实业务痛点",
      "2. 系统定位与一致性/可用性架构取舍",
      "3. 端到端核心调用链路与数据流",
      "4. 本人实际参与/负责的模块边界",
      "5. 最核心的 2–3 个技术难点与实现细节",
      "6. 关键设计 Trade-off（说明牺牲了什么代价）",
      "7. AI 应用 / 规则护栏 / 核心架构能力体现",
      "8. 系统优化、安全边界与工程治理（CI/测试/监控）",
      "9. 已知薄弱环节、风险边界与后续演进方向",
      `10. 与目标岗位${job?.role ? `「${job.role}」` : ""}的真实匹配点与保守表达`,
    ],
    doNotSayList,
  };
}
