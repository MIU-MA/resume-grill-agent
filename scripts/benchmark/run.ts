import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { cpus, tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { Store } from "../../src/infrastructure/sqlite-store.js";
import { Workspace } from "../../src/core/workspace.js";
import { Tasks } from "../../src/core/tasks.js";
import { renderPdf } from "../../src/infrastructure/documents.js";
import {
  groundedTailoringSchema,
  tailoringSections,
} from "../../src/domain/resume-tailoring.js";

function summarize(samplesMs: number[]) {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const percentile = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const mean = sum / sorted.length;
  return {
    iterations: sorted.length,
    minMs: Number(sorted[0].toFixed(3)),
    p50Ms: Number(percentile(0.5).toFixed(3)),
    p95Ms: Number(percentile(0.95).toFixed(3)),
    p99Ms: Number(percentile(0.99).toFixed(3)),
    meanMs: Number(mean.toFixed(3)),
    opsPerSec: Number((1000 / Math.max(mean, 0.0001)).toFixed(1)),
  };
}

function measureSync(iterations: number, fn: () => void) {
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  return summarize(samples);
}

async function measureAsync(iterations: number, fn: () => Promise<void>) {
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    await fn();
    samples.push(performance.now() - t0);
  }
  return summarize(samples);
}

const sampleResume = [
  "林示例",
  "电话：13800138000 | 邮箱：lin@example.com | 杭州",
  "专业技能",
  "- 熟悉 Go、TypeScript、Node.js、PostgreSQL、Redis、Docker、Linux。",
  "工作经历",
  "2022.07 - 2025.06 示例科技有限公司 高级后端工程师",
  "- 负责订单网关 API 与核心交易链路稳定性治理，使用 Go 与 Redis 处理高并发查询。",
  "- 参与数据库索引优化与异步对账流程改造，降低超时报错率。",
  "项目经历",
  "2023.03 - 2024.12 多渠道求职协作引擎",
  "- 基于 TypeScript 与 SQLite 实现状态机与防重投递链路。",
].join("\n");

const sampleJd =
  "杭州招聘高级后端工程师：熟悉 Go、Redis、API 开发与稳定性治理，具备数据库性能优化经验。";

const home = await mkdtemp(join(tmpdir(), "resume-grill-bench-"));
const store = new Store(home);
try {
  // 1. Guardrail validation throughput
  const sections = tailoringSections(sampleResume);
  const workSection = sections.find((s) => s.kind === "work")!;
  const lineIndex = workSection.lines.findIndex((l) => l.includes("订单网关"));
  const plan = {
    company: "示例公司",
    role: "高级后端工程师",
    sectionOrder: sections.map((s) => s.id),
    changes: [
      {
        sectionId: workSection.id,
        lineIndex,
        after:
          "- 负责订单网关 API 与核心链路稳定性治理，基于 Go 与 Redis 优化查询性能。",
        requirement: "熟悉 Go、Redis、API 开发与稳定性治理",
        reason: "贴合目标岗位核心职责",
      },
    ],
    highlights: [],
    gaps: [],
  };
  const guardrailBench = measureSync(500, () => {
    groundedTailoringSchema(sampleResume, sampleJd, {
      job: { company: "示例公司", role: "高级后端工程师" },
      partial: true,
    }).parse(plan);
  });

  // 2. Candidate filtering over 500 jobs + 50 active applications (post N+1 fix)
  const workspace = new Workspace(store);
  const resumePath = join(home, "bench-resume.txt");
  await writeFile(resumePath, sampleResume, "utf8");
  const resume = await workspace.importResume(resumePath);
  const tasks = new Tasks(workspace);
  const goal = tasks.saveGoal({
    resumeId: resume.id,
    directions: ["后端", "Go"],
    cities: ["杭州"],
    limit: 20,
  });
  store.transaction(() => {
    for (let i = 0; i < 500; i++) {
      const jobId = `bench-job-${i}`;
      store.put("job", {
        id: jobId,
        company: `公司-${i % 80}`,
        role: i % 3 === 0 ? "高级后端工程师" : "产品经理",
        jd:
          i % 3 === 0
            ? "杭州，负责 Go API 与稳定性治理。"
            : "上海，负责 B 端需求调研。",
        sourceUrl: `https://example.com/jobs/${i}`,
        recipient: `hr${i}@example.com`,
      });
      if (i < 50) {
        store.put("application", {
          id: `bench-app-${i}`,
          jobId,
          resumeId: resume.id,
          recipient: `hr${i}@example.com`,
          subject: "应聘",
          body: "您好",
          attachment: resumePath,
          attachmentHash: "bench",
          digest: `bench-digest-${i}`,
          messageId: `<bench-${i}@resume-grill.local>`,
          status: "sent",
          createdAt: Date.now(),
        });
      }
    }
  });
  const candidatesBench = measureSync(100, () => {
    tasks.candidates(goal.id);
  });

  // 3. PDF rendering (cold first call vs warm font-cached calls)
  const coldStart = performance.now();
  await renderPdf(sampleResume);
  const pdfColdMs = Number((performance.now() - coldStart).toFixed(2));
  const pdfWarmBench = await measureAsync(10, async () => {
    await renderPdf(sampleResume);
  });

  // 4. SQLite WAL tool_audit write throughput
  const auditWriteBench = measureSync(500, () => {
    store.recordToolAudit({
      traceId: "bench-trace",
      caller: "mcp",
      toolName: "list_workspace",
      readOnly: true,
      status: "ok",
      durationMs: 2,
      summary: { goalId: goal.id },
    });
  });

  console.log(
    JSON.stringify(
      {
        benchmarkedAt: new Date().toISOString(),
        environment: {
          node: process.version,
          platform: process.platform,
          arch: process.arch,
          cpuModel: cpus()[0]?.model ?? "unknown",
          cpuCores: cpus().length,
        },
        benchmarks: {
          tailoringGuardrail: guardrailBench,
          candidatesFilter500Jobs50Sent: candidatesBench,
          pdfRenderChinese: {
            coldFirstCallMs: pdfColdMs,
            warmFontCached: pdfWarmBench,
          },
          sqliteToolAuditWrite: auditWriteBench,
        },
      },
      null,
      2,
    ),
  );
} finally {
  store.close();
  await rm(home, { recursive: true, force: true, maxRetries: 5 });
}
