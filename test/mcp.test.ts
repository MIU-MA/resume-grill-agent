import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test(
  "真实 stdio MCP：宿主能执行岗位改写到模拟投递并重启查询",
  { timeout: 60000 },
  async () => {
    const home = await mkdtemp(join(tmpdir(), "resume-agent-mcp-"));
    let client: Client | undefined;
    const connect = async () => {
      client = new Client({ name: "test-host", version: "1" });
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [resolve("dist/cli.js"), "serve"],
          env: {
            ...Object.fromEntries(
              Object.entries(process.env).filter(
                (entry): entry is [string, string] =>
                  typeof entry[1] === "string",
              ),
            ),
            RESUME_AGENT_HOME: home,
            RESUME_ALLOW_SEND: "0",
          },
          stderr: "pipe",
        }),
      );
      return client;
    };
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client!.callTool({ name, arguments: args });
      assert.ok(!result.isError, JSON.stringify(result.content));
      return JSON.parse((result.content as Array<{ text: string }>)[0].text);
    };
    try {
      await connect();
      const tools = await client!.listTools();
      assert.equal(tools.tools.length, 9);
      assert.ok(!tools.tools.some((tool) => tool.name.includes("approve")));
      const source = join(home, "demo.md");
      await writeFile(source, "张三\n项目经历\n- 负责 Go API 开发与测试。");
      const resume = await call("import_resume", { path: source });
      const job = await call("add_job", {
        company: "示例公司",
        role: "Go",
        jd: "示例公司招聘 Go，负责 Go API 开发与测试。",
        sourceUrl: "https://example.com/job",
      });
      const context = await call("review_context", {
        resumeId: resume.id,
        jobId: job.id,
      });
      const version = await call("save_resume_version", {
        resumeId: resume.id,
        jobId: job.id,
        accepted: [],
        plan: {
          company: job.company,
          role: job.role,
          sectionOrder: context.sections.map(
            (section: { id: string }) => section.id,
          ),
          changes: [],
          highlights: [],
          gaps: [],
        },
      });
      const draft = await call("prepare_application", {
        jobId: job.id,
        resumeId: version.id,
        recipient: "hr@example.com",
        subject: "应聘",
        body: "您好，附件是简历。",
      });
      assert.equal(
        (await call("preview_application", { id: draft.id })).digest,
        draft.digest,
      );
      assert.equal(
        (await call("execute_application", { id: draft.id })).status,
        "simulated",
      );
      await client!.close();
      await connect();
      assert.equal(
        (await call("application_history", {}))[0].status,
        "simulated",
      );
    } finally {
      await client?.close();
      if (
        dirname(home) === tmpdir() &&
        basename(home).startsWith("resume-agent-mcp-")
      )
        await rm(home, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 100,
        });
    }
  },
);
