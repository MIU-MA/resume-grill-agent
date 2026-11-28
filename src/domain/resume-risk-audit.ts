import { parseResumeStructure } from "./resume-structure.js";

export type RiskSeverity = "high" | "medium";
export type RiskCategory =
  | "overclaim_ownership"
  | "unverified_metric"
  | "ungrounded_buzzword";

export type ResumeRiskFinding = {
  id: string;
  sectionId: string;
  sectionTitle: string;
  lineIndex: number;
  line: string;
  severity: RiskSeverity;
  category: RiskCategory;
  matchedTerm: string;
  reason: string;
  suggestedReplacement: string;
  interviewerChallenge: string;
  weakPointAtLayer3: string;
};

export type ResumeRiskReport = {
  summary: {
    highCount: number;
    mediumCount: number;
    totalFindings: number;
  };
  findings: ResumeRiskFinding[];
  expressionBoundaries: {
    safeToWrite: string[];
    writeWithCaution: string[];
    avoidWithoutEvidence: string[];
  };
};

type RiskRule = {
  category: RiskCategory;
  severity: RiskSeverity;
  pattern: RegExp;
  reason: string;
  suggestedReplacement: string;
  interviewerChallenge: string;
  weakPointAtLayer3: string;
  evidenceContext?: RegExp;
};

const OWNERSHIP_RULES: readonly RiskRule[] = [
  {
    category: "overclaim_ownership",
    severity: "high",
    pattern:
      /主导(?:整体|全链路|大规模线上|公司级|全局)(?:架构|系统|平台|治理)?|负责(?:整体|全链路)架构|架构负责人|平台负责人|牵头全局治理/,
    reason: "全局主导度措辞极高，缺乏团队规模、RFC 评审与跨团队落地证据时面试一问即露馅。",
    suggestedReplacement: "改用「参与核心设计与实现」「负责核心模块设计与落地」或「参与链路治理与演进」。",
    interviewerChallenge: "你在该系统中实际独立决策并落地了哪几个模块？团队分工和方案评审是谁拍板的？",
    weakPointAtLayer3: "追问到跨模块边界、非本人负责模块细节或历史架构演进背景时极易答不上来。",
  },
  {
    category: "overclaim_ownership",
    severity: "high",
    pattern: /从\s*[0零]\s*到\s*[1一]\s*搭建(?:完整|全)?平台|平台化闭环/,
    reason: "「从 0 到 1 搭建全平台」易被质疑夸大个人贡献边界，尤其当代码仅覆盖局部模块时。",
    suggestedReplacement: "改用「负责核心子系统设计与落地」或「完成关键能力抽象与封装」。",
    interviewerChallenge: "平台从立项到上线的核心里程碑、多租户隔离与运维体系分别是怎么落地的？",
    weakPointAtLayer3: "说不清平台级多团队接入规范、权限模型、监控告警与灰度回滚机制。",
  },
  {
    category: "overclaim_ownership",
    severity: "high",
    pattern: /主导(?:分布式推理框架|模型性能优化|模型量化优化|RDMA\s*通信优化|CUDA\s*算子优化|大规模分布式存储系统)/i,
    reason: "属于强底层硬核方向声明，若无真实算子/通信/存储引擎源码与压测证据，属于一票否决级红线。",
    suggestedReplacement: "若仅为应用层接入，请降调为「参与 AI 应用链路工程化」或「参与数据访问/检索链路优化」。",
    interviewerChallenge: "请具体讲一下你写的算子/通信拓扑/存储分片代码在哪里，以及实测 Profiler/Benchmark 数据。",
    weakPointAtLayer3: "无法区分应用层 API 调用与底层模型推理/存储内核实现，一问底层细节立即穿帮。",
  },
  {
    category: "overclaim_ownership",
    severity: "medium",
    pattern: /精通|业界领先|行业领先|彻底解决/,
    reason: "绝对化程度词拉高面试官追问预期，容易引发深水区压力测试。",
    suggestedReplacement: "改用「熟悉」「深入实践」「围绕核心瓶颈完成局部优化」或具体描述解决的边界条件。",
    interviewerChallenge: "既然写「彻底解决/精通」，请讲一下在极端故障或边界场景下该方案的失效模式和代价。",
    weakPointAtLayer3: "讲不清方案的 Trade-off 与已知局限，显得缺乏资深工程师的克制判断。",
  },
];

const METRIC_RULES: readonly RiskRule[] = [
  {
    category: "unverified_metric",
    severity: "high",
    pattern: /(?:零|0)\s*故障|100%\s*(?:可用|无故障|拦截|准确)/,
    reason: "绝对化可靠性或准确率承诺在真实生产中几乎不可成立，容易被判定为不诚实或缺乏线上敬畏。",
    suggestedReplacement: "改为说明具体的防重/降级/兜底机制，或给出有统计周期的真实 SLA 与回归测试边界。",
    interviewerChallenge: "统计周期和监控口径是什么？遇到外部依赖超时或节点掉电时如何保证不出错？",
    weakPointAtLayer3: "一旦追问未知态（uncertain）处置、网络分区或误杀率统计方法，绝对化指标立刻崩塌。",
  },
  {
    category: "unverified_metric",
    severity: "high",
    pattern: /(?:千万级|亿级)\s*(?:QPS|TPS|并发|日活|DAU|请求)/i,
    reason: "超大流量规模指标极易触发压力深挖，若项目为单机/中小流量系统请务必删除。",
    suggestedReplacement: "无真实压测或线上监控数据时，直接删除规模数字，聚焦机制设计与复杂度分析。",
    interviewerChallenge: "当时集群规模、机器配比、单机水位和瓶颈点在哪里？压测是怎么造数的？",
    weakPointAtLayer3: "说不清单机 QPS 换算、带宽/连接数上限、缓存命中率与 DB 写入瓶颈。",
  },
  {
    category: "unverified_metric",
    severity: "medium",
    pattern: /(?:延迟|耗时|成本|内存|幻觉率)\s*(?:降低|下降|节省|减少)\s*\d+(?:\.\d+)?%|(?:吞吐|性能|QPS|TPS|效率|准确率|召回率)\s*(?:提升|提高|增加)\s*\d+(?:\.\d+)?%/i,
    reason: "量化百分比必须能讲清前后基线、测试环境、样本量与归因，否则容易被怀疑拍脑袋编造。",
    suggestedReplacement: "确保能口述测量口径（如 P50/P95、样本集或本地基准）；若无实证，改写为机制收益描述。",
    interviewerChallenge: "这个百分比是怎么测出来的？优化前后的 P50/P95 基线、样本规模和排除干扰变量的方式是什么？",
    weakPointAtLayer3: "只记得百分比数字，说不出基线环境、瓶颈定位过程或压测工具配置。",
    evidenceContext: /P50|P95|P99|压测|基准|benchmark|监控|线上|A\/B|评测|eval|数据集|样本|实测/i,
  },
];

const BUZZWORD_RULES: readonly RiskRule[] = [
  {
    category: "ungrounded_buzzword",
    severity: "medium",
    pattern: /\b(?:TCC|Saga|Raft|Paxos|CQRS|Event\s*Sourcing)\b/i,
    reason: "高阶分布式事务与共识概念若缺乏真实补偿表、状态机或选主代码支撑，属于高危硬套项。",
    suggestedReplacement: "若仅为单机事务或本地幂等防重，请直接写清「事务边界 + 写前日志 + 状态机」，不要硬套分布式名词。",
    interviewerChallenge: "请画一下空回滚/悬挂/脑裂时的具体处理逻辑，代码里哪个模块实现的？",
    weakPointAtLayer3: "背得出八股概念但拿不出真实状态流转细节、对账补偿机制或失败恢复边界。",
    evidenceContext: /空回滚|悬挂|补偿|对账|选主|日志复制|分区|租约|状态机|回查|幂等/i,
  },
  {
    category: "ungrounded_buzzword",
    severity: "medium",
    pattern: /异地多活|两地三中心|单元化|多活/,
    reason: "跨机房多活与单元化架构涉及流量路由、数据双向同步与容灾切换，无真实容灾落地时一问即露馅。",
    suggestedReplacement: "若仅为单机房主备或普通多实例部署，请如实写「高可用部署 / 故障隔离」，不要硬套跨机房多活术语。",
    interviewerChallenge: "跨机房数据同步延迟时的冲突解决策略是什么？RPO/RTO 实测指标和最近一次容灾演练是怎么做的？",
    weakPointAtLayer3: "说不清单元路由规则、跨地域写冲突处理、脑裂防护以及真实切流耗时。",
    evidenceContext: /跨机房|RPO|RTO|双活|流量切换|数据同步|单元路由|容灾演练|脑裂|分区/i,
  },
  {
    category: "ungrounded_buzzword",
    severity: "medium",
    pattern: /\b(?:INT4|INT8|FP8|Sparse\s*Attention|Speculative\s*Decoding|MoE|CUDA|Triton|MLIR|TVM|RDMA|NCCL|HCCL|Continuous\s*Batching|KV\s*Cache)\b/i,
    reason: "底层模型推理/算子/通信优化术语要求极强硬件与 profiling 证据，不可用调 API 经验硬套。",
    suggestedReplacement: "若仅为调用模型 API，请改写为「LLM 应用链路治理 / 上下文管理 / Tool 编排」。",
    interviewerChallenge: "具体优化了哪一层（模型/计算/通信）？Nsight/Profiler 瓶颈在哪里，精度损失怎么评估？",
    weakPointAtLayer3: "无法说明硬件利用率、显存带宽瓶颈或量化前后精度基准评测方法。",
    evidenceContext: /profiler|nsight|benchmark|显存|带宽|精度损失|tok\/s|vllm|tensorrt|sglang|核函数|实测/i,
  },
];

const ALL_RULES: readonly RiskRule[] = [
  ...OWNERSHIP_RULES,
  ...METRIC_RULES,
  ...BUZZWORD_RULES,
];

/**
 * Deterministic anti-BS & risk audit over a resume's raw text.
 * Surfaces overclaimed ownership, unverified metrics, and buzzword risks
 * with conservative alternatives and layer-3 interview challenges.
 */
export function auditResumeRisks(rawText: string): ResumeRiskReport {
  const sections = parseResumeStructure(rawText);
  const findings: ResumeRiskFinding[] = [];
  const seen = new Set<string>();

  for (const [sectionIdx, section] of sections.entries()) {
    if (["education", "awards"].includes(section.kind)) continue;
    const sectionId = `section-${sectionIdx}`;
    for (const [lineIndex, line] of section.lines.entries()) {
      const normalized = line.normalize("NFKC").trim();
      if (!normalized) continue;
      for (const rule of ALL_RULES) {
        const match = normalized.match(rule.pattern);
        if (!match) continue;
        if (rule.evidenceContext && rule.evidenceContext.test(normalized)) {
          continue;
        }
        const matchedTerm = match[0];
        const dedupeKey = `${sectionId}:${lineIndex}:${rule.category}:${matchedTerm.toLowerCase()}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        findings.push({
          id: `risk-${findings.length + 1}`,
          sectionId,
          sectionTitle: section.title,
          lineIndex,
          line: normalized.slice(0, 240),
          severity: rule.severity,
          category: rule.category,
          matchedTerm,
          reason: rule.reason,
          suggestedReplacement: rule.suggestedReplacement,
          interviewerChallenge: rule.interviewerChallenge,
          weakPointAtLayer3: rule.weakPointAtLayer3,
        });
        if (findings.length >= 24) break;
      }
      if (findings.length >= 24) break;
    }
    if (findings.length >= 24) break;
  }

  const highCount = findings.filter((item) => item.severity === "high").length;
  const mediumCount = findings.filter((item) => item.severity === "medium").length;

  return {
    summary: {
      highCount,
      mediumCount,
      totalFindings: findings.length,
    },
    findings,
    expressionBoundaries: {
      safeToWrite: [
        "参与核心设计与实现",
        "负责模块设计与落地",
        "围绕核心链路完成局部优化",
        "对关键模块进行抽象与封装",
        "参与 AI 应用链路工程化与安全边界治理",
      ],
      writeWithCaution: [
        "仅在具备实测基线或压测口径时写入具体百分比指标",
        "单机一致性与存储索引设计应明确规模边界，不混同分布式存储",
        "未落地的架构演进项仅作为面试扩展，不可写成已实现成果",
      ],
      avoidWithoutEvidence: [
        "主导整体架构 / 负责全链路架构 / 从 0 到 1 搭建全平台",
        "零故障 / 千万级 QPS / 业界领先 / 彻底解决",
        "无底层代码支撑时使用模型量化 / CUDA 算子 / RDMA / TCC / Raft 等术语",
      ],
    },
  };
}
