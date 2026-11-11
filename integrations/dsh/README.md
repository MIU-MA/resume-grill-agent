# DSH 接入

原生插件将岗位、简历修改和邮件核对显示在 DSH 回答下方。用户勾选修改、生成邮件、检查附件和确认发送都在同一会话完成；独立 React 网页保留为可选调试入口。

## 本地安装

在本仓库运行 `npm ci`、`npm run build`，然后使用实际绝对路径：

```powershell
dsh plugin --profile desktop add "link:C:/path/resume-grill-agent"
```

本机 Desktop 自带 CLI 在 `D:/ai/dsh/resources/runtime/cli/bin/dsh.cmd`；没有加入 PATH 时，用 `& '实际路径/dsh.cmd'` 替换 `dsh`。重启 DSH 后，在插件列表检查“求职助手”。Web 版安装到 `web` profile。卸载使用 `dsh plugin --profile desktop remove resume-grill-agent`，不删除求职资料。

这是从本地构建目录链接安装，尚未发布 npm 包；修改代码后重新构建并重启 DSH。`package.json` 的 `dsh.bundle.patch` 加载 Host，`dsh.client` 加载 React 卡片；`cordis.patch.yml` 不再仅是 MCP 配置。

## 使用

1. 在 DSH 中说明简历绝对路径和目标，例如“用这份简历找杭州全栈岗位，先展示合适的岗位”。
2. 助手使用 `resume_grill_*` 工具读取资料、查找岗位并保存建议；回答下方出现核对卡。多份建议按岗位分别显示。
3. 勾选接受的修改，点击“用所选修改准备邮件”；完整收件人、正文、附件入口和状态就地显示，不需要刷新网页。原目标的城市和排除条件会保留；没有明确邮箱或地点证据时显示原因。
4. “检查附件，不发信”只做校验。真实发送须先配置邮箱，再由用户勾选核对、输入“发送”并确认。助手不能通过原生工具批准或直接发信。

点击“请助手给出修改建议／分析所选岗位”会发起一次正常模型对话；勾选、生成 PDF、检查和确认发送直接走 Host 命令，不请求模型。按钮结果记录到会话，供下一次对话读取，插件不会因此主动唤醒模型。

资料默认在 `DSH_HOME/storages/resume-grill`，通常为 `%USERPROFILE%/.dsh/storages/resume-grill`，独立于会话工作目录。`RESUME_AGENT_HOME` 可以覆盖；与 MCP 共用资料时显式设置为同一绝对目录。卡片恢复只保存业务记录引用，重新读取当前投递状态，不保存批准状态。

## 发件配置

在启动 DSH 的环境里配置 `RESUME_SMTP_ADDRESS`、`RESUME_SMTP_CODE`、`RESUME_SMTP_PROVIDER`（qq／163／126）和 `RESUME_ALLOW_SEND=1`，再重启进程。授权码不进入工具参数或浏览器。当前没有原生邮箱设置页；未配置时卡片说明原因并禁用发送。

新生成 PDF 暂为文本排版，不保留原布局和照片。发送结果 `sent` 仅表示 SMTP 接受；回复同步和已读追踪尚未实现。

## 验证

本机 DSH Desktop `0.2.2-rc.1` 所带运行时已验证：可安装 bundle、原生工具、持久化 metadata、回答下方的 React 核对卡、用户命令、PDF／邮件生成及刷新恢复。测试使用隔离 profile、本地固定模型响应、演示简历和 example.com 邮箱，不调用付费模型或发送真实邮件。

```powershell
$env:DSH_COMMAND = 'D:/ai/dsh/resources/runtime/cli/bin/dsh.cmd'
node scripts/check-dsh-native.mjs
```

验证脚本只适用于 Windows + Edge，结束后关闭临时服务并清理隔离资料库。单元测试覆盖确认绑定、重复发送保护及会话卡片恢复；替代 SMTP 的测试不代表真实送达。

之前也通过 DSH headless 的实际模型调用完成过 MCP 简历改写与邮件准备；可继续使用 `resume-grill.patch.yml`，但同一 profile 不建议同时挂载两套重复工具。若桌面可用而 headless 提示 `MISSING_CREDENTIAL`，检查 headless 的 `credentials` 提供器是否被禁用，让 DSH 读取原有凭证；不要复制 Key 到本仓库。
