import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Workspace } from "../../core/workspace.js";
import { operations } from "../../core/operations.js";
import { packageVersion } from "../../shared/package-paths.js";
import { withTrace } from "../../shared/telemetry.js";

const openWorldOperations = new Set([
  "execute_application",
  "discover_jobs",
  "read_recruiting_site",
  "read_job_detail",
  "boss_status",
  "boss_search",
  "boss_read_jobs",
  "boss_read_detail",
  "boss_delivery_status",
  "boss_pause_delivery",
  "boss_shortlist",
  "boss_pause_group",
]);

export function createServer(workspace: Workspace) {
  const server = new McpServer({
    name: "resume-grill-agent",
    version: packageVersion,
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
          openWorldHint: openWorldOperations.has(op.name),
        },
      },
      async (args) => {
        try {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  await withTrace("mcp", () => op.run(args)),
                ),
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
