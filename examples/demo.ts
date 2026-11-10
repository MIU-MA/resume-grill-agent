import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/store.js";
import { Workspace } from "../src/service.js";

const home = await mkdtemp(join(tmpdir(), "resume-agent-demo-"));
const store = new Store(home),
  workspace = new Workspace(store);
try {
  const path = join(home, "演示简历.txt");
  await writeFile(path, "张三\n项目经历\n- 负责 Go API 开发与测试。");
  const resume = await workspace.importResume(path);
  const job = workspace.addJob({
    company: "示例公司",
    role: "Go",
    jd: "示例公司招聘 Go，负责 Go API 开发与测试。",
    sourceUrl: "https://example.com/jobs/demo",
  });
  const context = workspace.reviewContext(resume.id, job.id);
  const section = context.sections.find((section) =>
    section.lines.some((line) => line.includes("Go")),
  )!;
  const lineIndex = section.lines.findIndex((line) => line.includes("Go"));
  const plan = {
    company: job.company,
    role: job.role,
    sectionOrder: context.sections.map((section) => section.id),
    changes: [
      {
        sectionId: section.id,
        lineIndex,
        after: "- 负责 Go API 开发，参与测试。",
        requirement: "Go API 开发与测试",
        reason: "明确开发与测试的表述。",
      },
    ],
    highlights: [],
    gaps: [],
  };
  const version = await workspace.saveVersion(resume.id, job.id, plan, [
    `${section.id}:${lineIndex}`,
  ]);
  const draft = await workspace.prepare(
    job.id,
    version.id,
    "hr@example.com",
    "应聘 Go",
    "您好，附件是简历。",
  );
  await workspace.execute(draft.id);
  console.log(
    JSON.stringify(
      {
        home,
        pdf: version.pdf,
        history: workspace.history(),
        note: "演示数据，未调用模型，未发送邮件。演示目录保留供查看 PDF。",
      },
      null,
      2,
    ),
  );
} finally {
  store.close();
}
