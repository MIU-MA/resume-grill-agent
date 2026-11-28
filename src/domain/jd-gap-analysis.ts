export type TrackId =
  | "ai-app"
  | "ai-perf"
  | "distributed-storage"
  | "platform-backend"
  | "frontend-client"
  | "general";

export type FitLevel = "strong_fit" | "partial_fit" | "mismatch_warning";

export type CapabilityEvidence = {
  key: string;
  label: string;
  track: TrackId;
  jdQuote: string;
  resumeQuote?: string;
};

export type JdGapAnalysis = {
  primaryTrack: TrackId;
  primaryTrackLabel: string;
  secondaryTracks: Array<{ id: TrackId; label: string }>;
  fitLevel: FitLevel;
  fitSummary: string;
  matchedCapabilities: CapabilityEvidence[];
  missingCapabilities: CapabilityEvidence[];
  riskIsolations: string[];
  recommendedPositioning: string[];
};

type CapabilityRule = {
  key: string;
  label: string;
  track: Exclude<TrackId, "general">;
  pattern: RegExp;
  /** Optional stricter check on resume text to prevent weak API mentions from passing as deep engine work. */
  resumeGuard?: RegExp;
};

const TRACK_LABELS: Record<TrackId, string> = {
  "ai-app": "AI 应用架构 / Agent / Workflow",
  "ai-perf": "AI 推理 / 算子 / 通信性能优化",
  "distributed-storage": "大规模分布式系统 / 存储架构",
  "platform-backend": "后端架构 / 平台工程 / 核心链路治理",
  "frontend-client": "前端工程 / 桌面工作台交互",
  general: "通用工程 / 综合岗位",
};

const CAPABILITY_RULES: readonly CapabilityRule[] = [
  // Track 1: AI 应用架构 / Agent / RAG / Workflow
  {
    key: "agent-tool-use",
    label: "Agent 与 Tool Use / Function Calling 编排",
    track: "ai-app",
    pattern: /\b(?:agent|mcp|tool\s*use|function\s*calling)\b|智能体|多智能体|工具调用/i,
  },
  {
    key: "llm-workflow",
    label: "大模型业务流程与 Workflow 编排",
    track: "ai-app",
    pattern: /\b(?:workflow|dsl|langchain|langgraph|dify|coze)\b|工作流编排|自动化流程|低代码|无代码/i,
  },
  {
    key: "rag-retrieval",
    label: "RAG 检索增强（向量库 / Embedding / Rerank）",
    track: "ai-app",
    pattern: /\b(?:rag|embedding|rerank|milvus|qdrant|faiss|pinecone|chroma|pgvector)\b|向量检索|向量数据库|检索增强|混合检索|知识库召回/i,
  },
  {
    key: "prompt-guardrail-eval",
    label: "Prompt 治理 / 防幻觉护栏 / Eval 评测",
    track: "ai-app",
    pattern: /\b(?:prompt|guardrail|eval|evaluation|grounding)\b|提示词|防幻觉|事实校验|离线评测|效果评估/i,
  },
  {
    key: "llm-app-integration",
    label: "LLM 应用架构与产品化落地",
    track: "ai-app",
    pattern: /\b(?:llm|openai|claude|gemini|deepseek)\b|大模型应用|大语言模型|业务系统智能化/i,
  },

  // Track 2: AI 推理 / 模型 / 通信 / 计算性能优化
  {
    key: "model-quant-sparsity",
    label: "模型量化（INT4/INT8/FP8）与稀疏化",
    track: "ai-perf",
    pattern: /\b(?:int4|int8|fp8|gptq|awq|smoothquant|sparse\s*attention)\b|模型量化|混合精度量化|稀疏化/i,
  },
  {
    key: "inference-engine-opt",
    label: "推理引擎优化（KV Cache / Continuous Batching / Speculative Decoding / MoE）",
    track: "ai-perf",
    pattern: /\b(?:vllm|sglang|tensorrt(?:-llm)?|kv\s*cache|prefix\s*cache|continuous\s*batching|speculative\s*decoding|moe)\b|推理优化|投机解码|专家路由/i,
    resumeGuard: /\b(?:kv\s*cache|prefix\s*cache|continuous\s*batching|speculative\s*decoding|moe|ttft|tpot|profiler|nsight)\b|推理优化|推理加速|投机解码|专家路由|显存优化|算子融合|量化/i,
  },
  {
    key: "gpu-kernel-compute",
    label: "GPU / AI 芯片算子与编译优化（CUDA / Triton / MLIR / TVM）",
    track: "ai-perf",
    pattern: /\b(?:cuda|rocm|triton|mlir|tvm|gemm|cutlass|nsight)\b|算子融合|核心算子|昇腾|寒武纪|核函数|gpu\s*profiling/i,
    resumeGuard: /\b(?:cuda|rocm|triton|mlir|tvm|gemm|cutlass|nsight)\b|算子融合|核心算子|核函数|gpu\s*profiling/i,
  },
  {
    key: "distributed-comm-opt",
    label: "分布式训练与推理通信优化（RDMA / NCCL / HCCL / AllReduce）",
    track: "ai-perf",
    pattern: /\b(?:rdma|nccl|hccl|gloo|allreduce|allgather|reducescatter|roce|infiniband)\b|通信拓扑|国产高速网卡|通信优化/i,
    resumeGuard: /\b(?:rdma|nccl|hccl|gloo|allreduce|allgather|reducescatter|roce|infiniband)\b|通信拓扑|集合通信|通信优化/i,
  },

  // Track 3: 分布式系统 / 存储架构
  {
    key: "distributed-storage-engine",
    label: "分布式存储 / 对象存储 / 分片与多副本",
    track: "distributed-storage",
    pattern: /\b(?:ceph|hdfs|s3|minio|rocksdb|lsm(?:-tree)?|tikv|etcd)\b|分布式存储|对象存储|数据分片|分库分表|多副本/i,
    resumeGuard: /\b(?:ceph|hdfs|rocksdb|lsm(?:-tree)?|tikv|etcd)\b|分布式存储|对象存储(?:架构|引擎|网关|集群)|数据分片|分库分表|多副本|纠删码|存储引擎|冷热分层/i,
  },
  {
    key: "consensus-ha",
    label: "分布式一致性协议与高可用容灾（Raft / Paxos / 多活）",
    track: "distributed-storage",
    pattern: /\b(?:raft|paxos|zab|tcc|saga)\b|一致性协议|异地多活|两地三中心|单元化|分布式事务/i,
  },
  {
    key: "search-engine-scale",
    label: "大规模搜索引擎与海量元数据治理",
    track: "distributed-storage",
    pattern: /\b(?:elasticsearch|opensearch|clickhouse|doris|starrocks)\b|搜索引擎|倒排索引|冷热分层|数据迁移|元数据管理/i,
    resumeGuard: /\b(?:clickhouse|doris|starrocks)\b|搜索引擎(?:架构|内核)|倒排索引|索引分片|集群调优|冷热分层|海量元数据|数据迁移/i,
  },

  // Track 4: 平台架构 / 后端核心链路治理
  {
    key: "backend-consistency",
    label: "事务一致性 / 幂等防重 / 状态机与故障恢复",
    track: "platform-backend",
    pattern: /事务|幂等|防重|状态机|乐观锁|写前日志|崩溃恢复|一致性|at-most-once|singleflight|请求折叠/i,
  },
  {
    key: "security-governance",
    label: "安全边界 / 权限隔离 / 审计与稳定性治理",
    track: "platform-backend",
    pattern: /\b(?:ssrf|csrf|rbac|acl|oauth|jwt|tls|audit)\b|权限隔离|审计|风控|安全边界|限流|熔断|降级|可观测/i,
  },
  {
    key: "platform-modularity",
    label: "模块化平台抽象 / 多协议适配 / 工程治理",
    track: "platform-backend",
    pattern: /模块化|插件化|平台化|适配器|六边形|领域驱动|ddd|ci\/cd|自动化测试|微内核|可扩展架构/i,
  },
  {
    key: "data-access-perf",
    label: "数据库索引 / 缓存 / 并发与 I/O 性能治理",
    track: "platform-backend",
    pattern: /\b(?:sqlite|mysql|postgres(?:ql)?|redis|kafka|mq|n\+1|lru|cache)\b|索引优化|缓存|并发控制|连接池|批量查询|异步/i,
  },

  // Track 5: 前端 / 桌面客户端
  {
    key: "frontend-ui-arch",
    label: "现代前端与复杂交互工作台（React / TypeScript / Electron）",
    track: "frontend-client",
    pattern: /\b(?:react|vue|typescript|next\.js|electron|webpack|vite|css)\b|前端架构|组件化|工作台|桌面端/i,
  },
];

function findQuote(text: string, pattern: RegExp): string | undefined {
  const lines = text
    .split(/[\r\n。；;]/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  for (const line of lines) {
    if (pattern.test(line)) return line.slice(0, 140);
  }
  return undefined;
}

/**
 * Analyze JD primary/secondary tracks, match evidence against raw resume text,
 * and surface strict risk isolations (e.g., never misrepresent LLM API usage as GPU/kernel inference optimization).
 */
export function analyzeJdGap(
  resumeText: string,
  jdText: string,
  role = "",
): JdGapAnalysis {
  const jdFull = `${role}\n${jdText}`.normalize("NFKC");
  const resumeNorm = resumeText.normalize("NFKC");

  const trackScores = new Map<Exclude<TrackId, "general">, number>([
    ["ai-app", 0],
    ["ai-perf", 0],
    ["distributed-storage", 0],
    ["platform-backend", 0],
    ["frontend-client", 0],
  ]);

  const matchedCapabilities: CapabilityEvidence[] = [];
  const missingCapabilities: CapabilityEvidence[] = [];

  for (const rule of CAPABILITY_RULES) {
    const jdQuote = findQuote(jdFull, rule.pattern);
    if (!jdQuote) continue;
    trackScores.set(rule.track, (trackScores.get(rule.track) ?? 0) + 1);
    const resumeQuote = findQuote(resumeNorm, rule.resumeGuard ?? rule.pattern);
    if (resumeQuote) {
      matchedCapabilities.push({
        key: rule.key,
        label: rule.label,
        track: rule.track,
        jdQuote,
        resumeQuote,
      });
    } else {
      missingCapabilities.push({
        key: rule.key,
        label: rule.label,
        track: rule.track,
        jdQuote,
      });
    }
  }

  // Weight explicit role title signals for primary track selection.
  const roleNorm = role.normalize("NFKC");
  if (/推理优化|量化|算子|cuda|triton|高性能计算|ai\s*infra|推理框架/i.test(roleNorm)) {
    trackScores.set("ai-perf", (trackScores.get("ai-perf") ?? 0) + 2);
  } else if (/agent|rag|大模型应用|ai\s*应用|llm\s*应用/i.test(roleNorm)) {
    trackScores.set("ai-app", (trackScores.get("ai-app") ?? 0) + 2);
  } else if (/分布式存储|存储架构|存储系统|数据库内核/i.test(roleNorm)) {
    trackScores.set(
      "distributed-storage",
      (trackScores.get("distributed-storage") ?? 0) + 2,
    );
  } else if (/前端|客户端|react|vue/i.test(roleNorm)) {
    trackScores.set(
      "frontend-client",
      (trackScores.get("frontend-client") ?? 0) + 2,
    );
  } else if (/后端|架构师|平台|服务端|golang|java|node/i.test(roleNorm)) {
    trackScores.set(
      "platform-backend",
      (trackScores.get("platform-backend") ?? 0) + 1,
    );
  }

  const rankedTracks = [...trackScores.entries()]
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1]);

  const primaryTrack: TrackId =
    rankedTracks.length > 0 ? rankedTracks[0][0] : "general";
  const secondaryTracks = rankedTracks.slice(1, 3).map(([id]) => ({
    id,
    label: TRACK_LABELS[id],
  }));

  const primaryMatched = matchedCapabilities.filter(
    (item) => item.track === primaryTrack,
  );
  const primaryMissing = missingCapabilities.filter(
    (item) => item.track === primaryTrack,
  );

  const riskIsolations: string[] = [];
  const recommendedPositioning: string[] = [];

  // Strict Risk Isolation 1: AI Inference Performance Optimization
  const jdRequiresAiPerf =
    primaryTrack === "ai-perf" ||
    missingCapabilities.some((item) => item.track === "ai-perf");
  const resumeHasAiPerf = matchedCapabilities.some(
    (item) => item.track === "ai-perf",
  );
  if (jdRequiresAiPerf && !resumeHasAiPerf) {
    riskIsolations.push(
      "【AI 性能优化风险隔离】目标岗位涉及模型量化、算子、通信或推理框架底层优化，当前简历未见相关代码证据；严禁将调用大模型 API 或应用层缓存包装成「模型推理优化」，不建议主打 AI 性能优化岗位。",
    );
  }

  // Strict Risk Isolation 2: Distributed Storage / Consensus
  const jdRequiresDistStorage =
    primaryTrack === "distributed-storage" ||
    missingCapabilities.some((item) => item.track === "distributed-storage");
  const resumeHasDistStorage = matchedCapabilities.some(
    (item) => item.track === "distributed-storage",
  );
  if (jdRequiresDistStorage && !resumeHasDistStorage) {
    riskIsolations.push(
      "【分布式存储风险隔离】当前简历未见数据分片、多副本、共识协议或大规模分布式存储证据；不建议硬包装成大规模分布式存储架构，应保守表达为「数据访问、索引优化、单机一致性与平台工程能力」。",
    );
  }

  // Strict Risk Isolation 3: RAG Vector Search Gap inside AI App track
  if (
    missingCapabilities.some((item) => item.key === "rag-retrieval") &&
    matchedCapabilities.some((item) => item.track === "ai-app")
  ) {
    riskIsolations.push(
      "【RAG 证据缺口提醒】目标 JD 提及向量检索/Embedding/Rerank，但当前简历未见向量库检索证据；可突出 Agent Tool Use、Workflow 与护栏能力，切忌把普通网页/文档读取硬写为完整 RAG 检索链路。",
    );
  }

  let fitLevel: FitLevel;
  if (
    (primaryTrack === "ai-perf" && !resumeHasAiPerf) ||
    (primaryTrack === "distributed-storage" && !resumeHasDistStorage)
  ) {
    fitLevel = "mismatch_warning";
  } else if (primaryTrack === "general") {
    fitLevel =
      matchedCapabilities.length >= 2 || missingCapabilities.length === 0
        ? "partial_fit"
        : "mismatch_warning";
  } else {
    const primaryTotal = primaryMatched.length + primaryMissing.length;
    const ratio = primaryTotal > 0 ? primaryMatched.length / primaryTotal : 0;
    if (primaryMatched.length >= 2 && ratio >= 0.6) {
      fitLevel = "strong_fit";
    } else if (matchedCapabilities.length >= 1) {
      fitLevel = "partial_fit";
    } else {
      fitLevel = "mismatch_warning";
    }
  }

  if (fitLevel === "strong_fit") {
    recommendedPositioning.push(
      `核心赛道高度契合（${TRACK_LABELS[primaryTrack]}），建议将其作为主打方向，围绕已有原文证据展开技术决策与 Trade-off。`,
    );
  } else if (fitLevel === "partial_fit") {
    recommendedPositioning.push(
      `存在可迁移匹配项，但仍有 ${missingCapabilities.length} 项 JD 核心要求缺少简历证据；建议克制定位、只突出已证实能力，将缺口列入面试预案而非硬写入简历。`,
    );
  } else {
    recommendedPositioning.push(
      `目标 JD 主赛道（${TRACK_LABELS[primaryTrack]}）与简历当前核心证据偏差较大，不建议硬包装主打；如需投递，务必主动降调边界并聚焦可迁移的工程基础。`,
    );
  }

  if (matchedCapabilities.length > 0) {
    recommendedPositioning.push(
      `优先强化已证实能力：${matchedCapabilities
        .slice(0, 4)
        .map((c) => c.label)
        .join("、")}。`,
    );
  }
  if (missingCapabilities.length > 0) {
    recommendedPositioning.push(
      `需确认补充或明确留白的能力：${missingCapabilities
        .slice(0, 4)
        .map((c) => c.label)
        .join("、")}。`,
    );
  }

  const fitSummary =
    fitLevel === "strong_fit"
      ? `强匹配：主赛道「${TRACK_LABELS[primaryTrack]}」命中 ${primaryMatched.length} 项核心能力证据。`
      : fitLevel === "partial_fit"
        ? `部分匹配：命中 ${matchedCapabilities.length} 项能力，缺失 ${missingCapabilities.length} 项 JD 证据，建议克制表达并核对缺口。`
        : `赛道预警：目标偏向「${TRACK_LABELS[primaryTrack]}」，关键底层证据缺失，不建议硬包装主打。`;

  return {
    primaryTrack,
    primaryTrackLabel: TRACK_LABELS[primaryTrack],
    secondaryTracks,
    fitLevel,
    fitSummary,
    matchedCapabilities,
    missingCapabilities,
    riskIsolations,
    recommendedPositioning,
  };
}
