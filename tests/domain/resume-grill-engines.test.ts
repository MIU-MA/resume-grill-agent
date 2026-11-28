import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { auditResumeRisks } from "../../src/domain/resume-risk-audit.js";
import { analyzeJdGap } from "../../src/domain/jd-gap-analysis.js";
import {
  groundedTailoringSchema,
  tailoringSections,
} from "../../src/domain/resume-tailoring.js";
import { Store } from "../../src/infrastructure/sqlite-store.js";
import { Workspace } from "../../src/core/workspace.js";
import { ResumeGrillService } from "../../src/core/resume-grill.js";
import { humanAction } from "../../src/adapters/dsh/actions.js";
import { startPanel } from "../../src/adapters/panel/server.js";

test("反吹牛体检检出夸大主导度、绝对指标与无上下文术语，且对带实证基线描述不误杀", () => {
  const riskyResume = [
    "林示例",
    "工作经历",
    "2022.01 - 2025.06 示例科技",
    "- 主导整体架构设计，从 0 到 1 搭建全平台，实现千万级 QPS 零故障运行。",
    "- 使用 CUDA 算子融合和 TCC 提升性能，并落地异地多活与两地三中心。",
    "- 通过本地缓存优化，基于 Benchmark 基准实测 P95 延迟降低 48%。",
  ].join("\n");

  const report = auditResumeRisks(riskyResume);
  assert.ok(report.summary.highCount >= 4);
  const terms = report.findings.map((f) => f.matchedTerm);
  assert.ok(terms.some((t) => t.includes("主导整体架构")));
  assert.ok(terms.some((t) => /0 到 1/.test(t)));
  assert.ok(terms.some((t) => t.includes("千万级 QPS")));
  assert.ok(terms.some((t) => t.includes("零故障")));
  assert.ok(terms.some((t) => t === "CUDA"));
  assert.ok(terms.some((t) => t === "TCC"));
  assert.ok(terms.some((t) => t === "两地三中心" || t === "异地多活"));
  // 带 Benchmark P95 实证语境的百分比不应误报
  assert.ok(!report.findings.some((f) => f.line.includes("Benchmark 基准实测")));

  // 强化护栏：空格/NFKC 归一化——不误杀原文已有的“从0到1搭建”，同时拦截插空格绕过的“零 故障”
  const baseResume =
    "林示例\n项目经历\n- 从0到1搭建订单接口并维护查询优化。\n- 参与缓存查询调优。";
  const sections = tailoringSections(baseResume);
  const proj = sections.find((s) => s.kind === "project")!;
  const parsed = groundedTailoringSchema(baseResume, "负责高可用接口开发", {
    partial: true,
  }).parse({
    company: "示例",
    role: "后端",
    sectionOrder: sections.map((s) => s.id),
    changes: [
      {
        sectionId: proj.id,
        lineIndex: 0,
        after: "- 从 0 到 1 搭建核心订单接口并维护查询优化。",
        requirement: "负责高可用接口开发",
        reason: "盘古之白格式润色",
      },
      {
        sectionId: proj.id,
        lineIndex: 1,
        after: "- 参与缓存查询调优，实现零 故障稳定运行。",
        requirement: "负责高可用接口开发",
        reason: "突出稳定性",
      },
    ],
    highlights: [],
    gaps: [],
  });
  assert.equal(parsed.changes.length, 1);
  assert.equal(parsed.changes[0].lineIndex, 0);
  assert.ok((parsed.notices ?? []).some((n) => n.includes("贡献或能力表述比原文更强")));
});

test("JD 赛道差距分析严格隔离 AI 推理性能优化与大规模分布式存储，并精准提示 RAG 缺口", () => {
  const aiAppResume = [
    "林示例",
    "项目经历",
    "- 参与设计基于 MCP 的 Agent 工具编排与 Workflow 状态机，采用 SQLite 事务与幂等防重保证一致性。",
    "- 落地 Prompt 分片治理与防幻觉事实护栏（Guardrail）及离线 Eval 评测集。",
  ].join("\n");

  // 1. 对口 AI 应用架构师 JD（含 RAG 要求）
  const aiAppGap = analyzeJdGap(
    aiAppResume,
    "负责大模型应用架构落地，包含 Agent、Tool Use、Workflow 编排、Prompt 护栏、Eval 评测及 RAG 向量检索。",
    "AI 应用架构师",
  );
  assert.equal(aiAppGap.primaryTrack, "ai-app");
  assert.equal(aiAppGap.fitLevel, "strong_fit");
  assert.ok(aiAppGap.matchedCapabilities.some((c) => c.key === "agent-tool-use"));
  assert.ok(aiAppGap.missingCapabilities.some((c) => c.key === "rag-retrieval"));
  assert.ok(aiAppGap.riskIsolations.some((r) => r.includes("RAG 证据缺口提醒")));

  // 2. 跨赛道 AI 推理性能优化 JD -> 必须触发 mismatch_warning 与风险隔离
  const aiPerfGap = analyzeJdGap(
    aiAppResume,
    "负责 LLM 推理性能优化：INT4/FP8 模型量化、KV Cache 与 Continuous Batching、CUDA/Triton 算子融合及 RDMA/NCCL 通信优化。",
    "AI 性能优化架构师",
  );
  assert.equal(aiPerfGap.primaryTrack, "ai-perf");
  assert.equal(aiPerfGap.fitLevel, "mismatch_warning");
  assert.ok(aiPerfGap.riskIsolations.some((r) => r.includes("AI 性能优化风险隔离")));

  // 3. 跨赛道大规模分布式存储 JD -> 即使简历写了“使用 S3 上传头像”也必须触发风险隔离
  const shallowS3Resume = `${aiAppResume}\n- 使用 S3 上传用户头像，调用 vLLM 部署问答接口。`;
  const distGap = analyzeJdGap(
    shallowS3Resume,
    "负责大规模分布式存储与对象存储架构设计，熟悉分库分表、多副本、Raft 共识协议与跨机房多活容灾。",
    "分布式存储架构师",
  );
  assert.equal(distGap.primaryTrack, "distributed-storage");
  assert.equal(distGap.fitLevel, "mismatch_warning");
  assert.ok(distGap.riskIsolations.some((r) => r.includes("分布式存储风险隔离")));

  const shallowVllmGap = analyzeJdGap(
    shallowS3Resume,
    "负责大模型推理优化：vLLM KV Cache、Continuous Batching、INT4 量化与 CUDA 算子优化。",
    "AI 性能优化架构师",
  );
  assert.equal(shallowVllmGap.primaryTrack, "ai-perf");
  assert.equal(shallowVllmGap.fitLevel, "mismatch_warning");

  // 4. 纯后端“订单状态机” JD 不应被误判为 ai-app
  const backendStateMachineGap = analyzeJdGap(
    aiAppResume,
    "负责核心订单状态机设计与事务幂等治理，保障接口一致性。",
    "资深后端开发",
  );
  assert.equal(backendStateMachineGap.primaryTrack, "platform-backend");
});

test("ResumeGrillService、reviewContext、DSH 命令与 Panel 接口贯通已投递冻结快照的三层面试拷打", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "resume-grill-e2e-"));
  const store = new Store(home);
  const workspace = new Workspace(store);
  const panel = await startPanel(workspace, 0);
  t.after(async () => {
    await panel.close();
    store.close();
    if (dirname(home) === tmpdir() && basename(home).startsWith("resume-grill-e2e-"))
      await rm(home, { recursive: true, force: true, maxRetries: 5 });
  });

  const resumeFile = join(home, "resume.md");
  await writeFile(
    resumeFile,
    [
      "林示例",
      "项目经历",
      "- 主导整体架构设计，实现零故障的 Agent Workflow 与 SQLite 事务状态机。",
      "- 负责 MCP 工具编排与安全权限隔离，通过自动化测试保障一致性。",
    ].join("\n"),
  );
  const resume = await workspace.importResume(resumeFile);
  const job = workspace.addJob({
    company: "示例大厂",
    role: "AI 应用架构师",
    jd: "负责 Agent、MCP Tool Use、Workflow 编排与安全边界治理。",
    sourceUrl: "https://example.com/jobs/ai-arch",
    recipient: "hr@example.com",
  });

  // 1. reviewContext 自动包含三大领域分析输出
  const ctx = workspace.reviewContext(resume.id, job.id);
  assert.ok(ctx.riskAudit.summary.highCount >= 2);
  assert.equal(ctx.jdGapAnalysis.primaryTrack, "ai-app");
  assert.ok(ctx.interviewGrill.topics.length >= 2);
  assert.equal(ctx.interviewGrill.topics[0].source, "risk");
  assert.equal(ctx.interviewGrill.pitch1MinOutline.maxChars, 250);
  assert.equal(ctx.interviewGrill.pitch5MinOutline.length, 10);

  // 2. 基于已投递冻结记录发起三层拷打
  const version = await workspace.saveVersion(
    resume.id,
    job.id,
    {
      company: job.company,
      role: job.role,
      sectionOrder: ctx.sections.map((s) => s.id),
      changes: [],
      highlights: [],
      gaps: [],
    },
    [],
  );
  const draft = await workspace.prepare(
    job.id,
    version.id,
    "hr@example.com",
    "应聘 AI 应用架构师",
    "您好，附件是简历。",
  );
  const grillService = new ResumeGrillService(workspace);
  const prep = grillService.prepareInterviewGrill({ applicationId: draft.id });
  assert.equal(prep.applicationId, draft.id);
  assert.equal(prep.resumeId, version.id);
  assert.equal(prep.jobId, job.id);
  assert.ok(prep.interviewGrill.doNotSayList.length > 0);

  // 2.5 未接受的建议不进入拷打话题；简历进回收站后仍可按冻结 applicationId 复盘拷打
  const unacceptedProposal = workspace.propose(resume.id, job.id, {
    company: job.company,
    role: job.role,
    sectionOrder: ctx.sections.map((s) => s.id),
    changes: [
      {
        sectionId: ctx.sections.find((s) => s.kind === "project")!.id,
        lineIndex: 1,
        after: "- 负责 MCP 工具编排与安全权限隔离，未采纳的测试句子。",
        requirement: "负责 Agent、MCP Tool Use",
        reason: "测试未采纳过滤",
      },
    ],
    highlights: [],
    gaps: [],
  });
  assert.ok(unacceptedProposal.id);
  const prepWithUnaccepted = grillService.prepareInterviewGrill({
    applicationId: draft.id,
  });
  assert.ok(
    !prepWithUnaccepted.interviewGrill.topics.some((topic) =>
      topic.quote.includes("未采纳的测试句子"),
    ),
  );
  workspace.trashResume(version.id);
  const prepAfterTrash = grillService.prepareInterviewGrill({
    applicationId: draft.id,
  });
  assert.equal(prepAfterTrash.resumeId, version.id);

  // 3. DSH 只读人类命令返回体检与烤打视图（含无岗位场景与回收站冻结投递复盘）
  const auditView = await humanAction(workspace, {
    action: "resume-audit",
    id: resume.id,
  });
  assert.equal(auditView.kind, "resume");
  assert.ok(auditView.riskAudit.summary.highCount >= 2);
  assert.ok(auditView.interviewGrill.topics.length >= 1);

  const resumeOnlyGrillView = await humanAction(workspace, {
    action: "interview-grill",
    resumeId: resume.id,
  });
  assert.equal(resumeOnlyGrillView.kind, "resume");
  assert.ok(resumeOnlyGrillView.interviewGrill.topics.length >= 1);

  const grillView = await humanAction(workspace, {
    action: "interview-grill",
    applicationId: draft.id,
  });
  assert.equal(grillView.kind, "review");
  assert.ok(grillView.interviewGrill.topics.length >= 1);

  // 4. Panel 鉴权接口 /api/audit 与 /api/grill
  const url = new URL(panel.url);
  const token = url.hash.slice(1);
  const origin = url.origin;
  const session = await fetch(`${origin}/api/session`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const cookie = session.headers.get("set-cookie")!.split(";")[0];

  const auditRes = await (
    await fetch(`${origin}/api/audit`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ resumeId: resume.id }),
    })
  ).json();
  assert.ok(auditRes.riskAudit.summary.highCount >= 2);

  const grillRes = await (
    await fetch(`${origin}/api/grill`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ applicationId: draft.id }),
    })
  ).json();
  assert.equal(grillRes.applicationId, draft.id);
  assert.ok(grillRes.interviewGrill.topics.length >= 2);
});
