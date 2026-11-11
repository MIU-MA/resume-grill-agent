# MCP 与可选面板

DSH 原生插件之外，也可按宿主的 MCP 格式指向同一套服务，替换以下绝对路径：

```json
{
  "mcpServers": {
    "resume-grill": {
      "command": "node",
      "args": ["C:/path/resume-grill-agent/dist/adapters/cli/main.js", "serve"],
      "env": { "RESUME_AGENT_HOME": "C:/path/private-resume-data" }
    }
  }
}
```

可按宿主方式加载 [求职 Skill](../skills/job-workbench/SKILL.md)，DSH 的旧 MCP 覆盖配置见 [示例](../examples/dsh-mcp.patch.yml)。同一 DSH profile 不要同时挂载原生版和 MCP 的重复工具。WorkBuddy 尚未实装。

流程：`import_resume → save_search_goal → discover_jobs / add_job → goal_candidates → review_context → propose_resume_changes → prepare_application_batch`。单份投递可用 `save_resume_version → prepare_application`；用户选择修改并核对实际附件后才能发送。

`npm run panel` 启动可选本机 React 面板，默认端口 4319，仅监听回环地址并校验会话和请求来源。MCP／面板默认目录是当前目录下的 `.resume-agent`；与 DSH 原生版共用资料时，显式指定相同 `RESUME_AGENT_HOME`。这不是公网或多用户部署方案。

通用 MCP 真实发信除邮箱环境配置外，还要人工确认当前内容摘要。用户可在交互终端运行：

```bash
node dist/adapters/cli/main.js approve <applicationId> <digest>
```

完整展示内容后输入 `SEND`，获得 10 分钟内有效的一次性确认，再调用 `execute_application` 并传入 `dryRun:false`；`true` 只检查。确认也可在本机面板完成。DSH 原生工具只允许附件检查，真实发送由用户卡片处理。不要让助手替用户完成批准；这不是对拥有电脑完整控制权的助手的隔离机制。

`sent` 只表示 SMTP 接受；`sending`／`uncertain` 要先核对邮箱，不能自动重试。此前用户已确认收到过一封真实测试邮件和 PDF；自动测试从不发送外部邮件。
