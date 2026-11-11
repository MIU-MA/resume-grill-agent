import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Workspace } from "./service.js";
import { operations } from "./operations.js";
export function createServer(workspace: Workspace) {
  const server = new McpServer({
    name: "resume-grill-agent",
    version: "0.1.0",
  });
  for (const op of operations(workspace))
    server.registerTool(
      op.name,
      {
        description: op.description,
        inputSchema: op.schema.shape,
        annotations: {
          readOnlyHint: op.readOnly,
          destructiveHint: op.name === "execute_application",
          openWorldHint: ["execute_application", "discover_jobs"].includes(
            op.name,
          ),
        },
      },
      async (args) => {
        try {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(await op.run(args)),
              },
            ],
          };
        } catch (error) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text:
                  error instanceof z.ZodError
                    ? JSON.stringify(error.issues.map((issue) => issue.message))
                    : error instanceof Error
                      ? error.message
                      : "操作失败。",
              },
            ],
          };
        }
      },
    );
  return server;
}
