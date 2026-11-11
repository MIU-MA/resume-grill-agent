# Resume Grill Agent

DSH 原生求职插件，也提供通用 MCP 接口。在对话中读取岗位、按 JD 核对简历、准备邮件并确认投递。模型负责理解和建议，本地服务保存资料、校验修改及记录执行结果。

## 当前能做

- **对话内操作**：岗位清单、逐条修改与投递核对直接显示在回答下方；按钮调用本地服务，操作结果留在同一会话。刷新后恢复实际记录。
- **记住求职目标**：主简历、岗位方向、城市、排除词及招聘来源，重启后可继续使用。
- **读取官网岗位**：从内置公开官网或指定 HTTPS 页面提取真实 JD、招聘邮箱及来源；支持岗位别名筛选，保留失败原因。宿主浏览器读取的 JD 也可导入同一清单。
- **逐条改简历**：导入 PDF／DOCX／TXT／Markdown，按 JD 生成并保存建议，用户选择接受项；原文件保留，岗位副本另存。
- **批量准备投递**：核对建议后，集中生成岗位 PDF 与邮件；缺邮箱、地点证据或修改选择的条目单独提示。重复请求复用已有批次及附件，不会重复生成邮件。
- **真实邮箱发送**：支持 QQ／163／126 SMTP，须用户确认。记录实际收件人、冻结附件、Message-ID、SMTP 回执及状态，结果不明确时阻止自动重发。

当前新 PDF 是文本排版，**不保留原布局和照片**。官网读取针对静态公开页面，每次最多 6 个来源、10 个页面，约 40 秒预算；不是全网搜索，不能覆盖登录页和所有动态列表。方向筛选使用标题及别名，城市只检查 JD 中的文字证据，不能替代人工确认。

官网自动填表、定时查找、收信同步、已读追踪与面试还未接入；批量准备后仍需逐封核对发送。原工作台的浏览器数据不会自动迁移。资料存本机 SQLite，但宿主模型仍会接触简历与 JD。

## 安装到 DSH

需要 Node.js 24+ 和本机 DSH。先在本仓库安装依赖、构建，再将实际绝对路径加入使用的 profile：

```bash
npm ci
npm run build
dsh plugin --profile desktop add "link:C:/path/resume-grill-agent"
```

重启 DSH，在插件列表确认“求职助手”已启用。直接告诉助手简历路径、求职方向或具体 JD；建议生成后在对话卡片中勾选，点击“用所选修改准备邮件”，继续核对实际附件与正文。无需启动额外网页。Web 版把 `desktop` 换成 `web`，详细步骤见 [DSH 说明](integrations/dsh/README.md)。

DSH 原生版默认将资料放在 `DSH_HOME/storages/resume-grill`（通常是用户目录下的 `.dsh/storages/resume-grill`）。可用 `RESUME_AGENT_HOME` 指定其他绝对目录。通用 MCP／独立面板默认使用启动目录下的 `.resume-agent`，需要共用资料时显式设置同一目录。

## 接入助手

按宿主的 MCP 格式配置，替换为实际绝对路径：

```json
{
  "mcpServers": {
    "resume-grill": {
      "command": "node",
      "args": ["C:/path/resume-grill-agent/dist/cli.js", "serve"],
      "env": { "RESUME_AGENT_HOME": "C:/path/private-resume-data" }
    }
  }
}
```

其他宿主可加载 [求职 Skill](skills/job-workbench/SKILL.md)。MCP 与 DSH 原生版复用同一组业务操作；WorkBuddy 尚未实装。`npm run panel` 仍提供可选的本机 React 面板，用于调试和没有原生界面的宿主，默认端口 4319。

任务流程：`import_resume → save_search_goal → discover_jobs / add_job → goal_candidates → review_context → propose_resume_changes → prepare_application_batch`。单份投递仍可使用 `save_resume_version → prepare_application`；`list_workspace` 用于找回目标和批次。用户选择修改、核对附件后才进入发送。

## 发送与记录

在服务环境中配置 `RESUME_SMTP_ADDRESS`、`RESUME_SMTP_CODE`、`RESUME_SMTP_PROVIDER`（qq／163／126）以及 `RESUME_ALLOW_SEND=1`。凭证不通过工具参数传递，不写入数据库。

DSH 投递卡片或独立面板中核对完整邮件及实际 PDF，勾选核对项、输入“发送”，再确认；也可在自己的交互终端运行：

```bash
node dist/cli.js approve <applicationId> <digest>
```

终端展示内容后输入 `SEND`，获得 10 分钟内有效的一次性确认，再通过通用 MCP 调用 `execute_application`，明确传入 `dryRun:false`。DSH 原生工具不接受模型直接发信，须用户通过卡片确认。`dryRun:true` 仅检查附件，不发信。确认能力不作为 MCP 工具提供；不要让助手替用户完成批准。这是流程约束，不能隔离拥有完整电脑控制权的助手。

`sent` 只表示 SMTP 接受，不代表送达或阅读；`sending`／`uncertain` 需要核对邮箱记录，不能自动重试。此前真实发信测试已由用户确认收到 PDF，本轮任务验证没有发信。

## 开发与验证

```bash
npm run check
npm test
node scripts/check-panel.mjs
```

自动测试使用临时资料库和替代 SMTP；浏览器验证使用演示数据，检查逐条修改、PDF、任务、批量准备与阻塞提示，不发信，结束后关闭服务。原生插件另用 `scripts/check-dsh-native.mjs` 在实际 DSH 中检查安装、卡片、按钮、附件和会话恢复，采用本地固定测试响应，不请求付费模型。截图仅保存在已忽略的 `.resume-agent/verification/`。

`src/dsh/` 是原生插件及卡片，`operations.ts` 供 DSH／MCP 共用；`src/domain/` 放规则，`src/careers/` 读取招聘页，`tasks.ts` 编排目标与批次，`service.ts` 管理简历和邮件，`store.ts` 保存数据。来源与许可见 [THIRD_PARTY.md](THIRD_PARTY.md)。
