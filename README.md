# Resume Grill Agent

Resume Grill 的独立插件可行性试验：把简历、JD、岗位版本、邮件准备与投递记录接成一条本地 MCP 流程。数据存入本机 SQLite；修改建议由宿主模型给出，工具负责引用校验、生成文件和执行结果记录。

## 当前能做

- 导入 PDF、DOCX、TXT、Markdown，复制保存原文件。
- 保存 JD 和招聘来源，提取结构化段落供宿主改写；复用主项目的事实与岗位引用校验。
- 按用户接受项保存岗位版本，生成中文 PDF；原文件保留，新 PDF 暂为文本排版，**不保留原布局和照片**。
- 冻结收件人、正文和实际附件，按内容摘要去重；模拟执行、查询投递和事件记录。
- 提供 SMTP 发送适配器，支持 QQ／163／126。真实发送默认关闭，须交互终端确认当前内容摘要；不确定结果阻止自动重发。

**这是试验版，不是完整工作台迁移。** 岗位搜索、官网填写、回复同步、打开追踪、面试与复盘尚未接入。当前填写 JD 或使用宿主已有的搜索／浏览器能力获取岗位。原项目浏览器数据不会自动导入。本地 MCP 不代表正文不经过宿主的模型服务。

## 运行

需要 Node.js 24 或更新版本。SQLite 使用 Node 内置模块，Node 24 可能打印实验性提示到 stderr。

```bash
npm ci
npm run build
npm test
npm run demo
```

演示不调用模型、不发信，会输出生成 PDF 和临时数据目录的位置。

## 接入宿主

MCP 使用 stdio，程序启动时不监听端口。按宿主支持的 MCP 配置格式，指向构建好的 CLI；下面是通用配置示例，需要将路径替换成实际绝对路径：

```json
{
  "mcpServers": {
    "resume-grill": {
      "command": "node",
      "args": ["C:/path/resume-grill-agent/dist/cli.js", "serve"],
      "env": {"RESUME_AGENT_HOME": "C:/path/private-resume-agent-data"}
    }
  }
}
```

WorkBuddy 连接器采用 MCP + Skill；DSH 使用其 MCP 客户端的 stdio 配置。两者的安装元数据不同，上面的配置不是可直接提交商店的插件包。将 `skills/job-workbench/SKILL.md` 按宿主的技能安装方式加载。

工具顺序：`import_resume → add_job → review_context → save_resume_version → prepare_application → preview_application → execute_application → application_history`。`list_workspace` 用于复用已有资料。宿主需要先显示逐段建议并得到选择，不可自行接受所有修改。

## 真实发信

测试只使用假 SMTP；仓库没有验证真实邮箱投递。启用前须自行核对生成的 PDF、收件人和邮件内容。

在 MCP 进程环境中配置 `RESUME_SMTP_ADDRESS`、`RESUME_SMTP_CODE`、`RESUME_SMTP_PROVIDER`，以及 `RESUME_ALLOW_SEND=1`。凭证不通过工具参数传递，不写入数据库。

用户在自己的交互终端，设置相同 `RESUME_AGENT_HOME` 后运行：

```bash
node dist/cli.js approve <applicationId> <digest>
```

程序完整展示内容，输入 `SEND` 后生成有效期 10 分钟的一次性确认，再让 MCP 调用 `execute_application` 且 `dryRun:false`。批准能力不作为 MCP 工具提供；不要授予宿主自动代替用户在终端确认的权限。这是本地流程约束，不是对拥有完整电脑控制权的 Agent 的强安全隔离。

`sent` 只表示发件服务接受。SMTP 抛错会保守记为 `uncertain`；进程在发送期间退出可能留下 `sending`，两者均不能自动重试，必须先人工核对邮箱记录。

## 开发

`src/domain/` 是可复用规则，`service.ts` 编排工作流，`store.ts` 保存数据，`documents.ts` 处理文件，`mcp.ts`／`cli.ts` 是入口适配。`npm run check` 检查类型，`npm test` 包含真实 stdio MCP 握手和演示工作流，网络 SMTP 全部替换为测试函数。

当前尚未在真实 DSH／WorkBuddy 客户端安装验证；协议测试不能替代客户端兼容性验证。来源与许可见 [THIRD_PARTY.md](THIRD_PARTY.md)。
