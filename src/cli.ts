import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { Store } from "./store.js";
import { Workspace } from "./service.js";
import { createServer } from "./mcp.js";
import { smtpSender } from "./smtp.js";

const store = new Store(
  resolve(process.env.RESUME_AGENT_HOME ?? ".resume-agent"),
);
const workspace = new Workspace(store, smtpSender());
const [command = "serve", id, digest] = process.argv.slice(2);
try {
  if (command === "serve") {
    const server = createServer(workspace);
    process.stdin.on("end", () => {
      void server.close().finally(() => store.close());
    });
    await server.connect(new StdioServerTransport());
  } else if (command === "approve") {
    if (!process.stdin.isTTY || !id || !digest)
      throw new Error(
        "请在交互终端运行 approve <投递编号> <digest>，核对预览后确认。",
      );
    console.log(JSON.stringify(workspace.preview(id), null, 2));
    const input = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      if ((await input.question("确认按上述内容发送？输入 SEND：")) !== "SEND")
        throw new Error("已取消。");
      workspace.approve(id, digest);
      console.log("已确认，有效期 10 分钟，仅可使用一次。");
    } finally {
      input.close();
      store.close();
    }
  } else if (command === "history") {
    console.log(JSON.stringify(workspace.history(), null, 2));
    store.close();
  } else throw new Error("命令：serve | history | approve <id> <digest>");
} catch (error) {
  console.error(error instanceof Error ? error.message : "执行失败。");
  store.close();
  process.exitCode = 1;
}
