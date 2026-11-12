# DSH 安装与使用

## 通过官方安装器安装

DSH 的“插件 → 添加插件 → 安装第三方插件”可以安装 npm 包、Git 仓库、本地目录和插件压缩包；不要求每个用户克隆项目后构建。[官方安装器说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-plugin-manager/README.zh.md)

本项目当前提供本地预构建包：

1. 由维护者在仓库运行 `npm ci`、`npm run package:plugin`。
2. 将 `artifacts/` 中生成的 `.tgz` 交给使用者。
3. 使用者在 DSH 官方安装入口填写下载文件的绝对路径，安装并启用“求职助手”。CLI 等价方式如下，路径须替换为实际下载位置：

```powershell
dsh plugin --profile desktop add 'C:/Downloads/resume-grill-agent-0.1.0.tgz'
```

Web 版将 `desktop` 换成 `web`。如安装器报告需要重启，重启 DSH。此包包含构建后的 Host、React 卡片、字体和插件声明，不需要在使用者电脑上编译源码；仍需下载运行依赖。包尚未发布到 npm，也没有上传下载版本，仓库当前不会自动发布。

以后发布 npm 或公开的预构建包后，可直接在同一安装器填包名或下载地址；不要在发布前将这些示例写成已可用入口。私有 Git 仓库还需要安装器能使用的仓库凭据。

## 开发者本地链接

只有开发者需要链接源码目录。先 `npm ci`、`npm run build`，然后通过官方安装器填写项目绝对目录，或运行：

```powershell
dsh plugin --profile desktop add 'link:C:/path/resume-grill-agent'
```

本机 Desktop 自带 CLI 在 `D:/ai/dsh/resources/runtime/cli/bin/dsh.cmd`；未加入 PATH 时用 `& '实际路径/dsh.cmd'` 替换 `dsh`。改代码后重新构建并重启 DSH。卸载使用 `dsh plugin --profile desktop remove resume-grill-agent`，不删除求职资料。

`plugin/` 只放插件清单、图标和语言资源；`package.json` 的 `dsh.bundle.patch` 指向该清单，Host 与 Client 构建入口在 `dist/adapters/dsh/`。

## 使用与发件

在对话中提供简历路径和方向。助手调用 `resume_grill_*` 工具后，回答下方显示岗位和修改核对卡；勾选修改并准备邮件，核对收件人、正文和实际附件。城市与排除条件会保留，缺信息时显示原因。点击“请助手给出修改建议／分析所选岗位”会请求模型，其他按钮直接执行本地操作。

未发送邮件可点“修改邮件”，直接编辑收件人、主题和正文。保存后生成新预览，沿用已冻结的 PDF；旧预览及其发送确认失效，批次打开修改后的邮件。编辑期间不提供发送操作，保存失败保留输入。已发送、发送中或结果待核对的邮件不能编辑。

在启动 DSH 的环境中配置 `RESUME_SMTP_ADDRESS`、`RESUME_SMTP_CODE`、`RESUME_SMTP_PROVIDER`（qq／163／126）和 `RESUME_ALLOW_SEND=1`，再重启进程。当前没有原生邮箱设置页；未配置时卡片禁用发送。用户勾选核对、输入“发送”后才能提交；助手不能批准自己发信。

资料默认在 `DSH_HOME/storages/resume-grill`，通常为 `%USERPROFILE%/.dsh/storages/resume-grill`；`RESUME_AGENT_HOME` 可指定其他绝对目录。恢复卡片重新读取当前状态，不保存批准。新 PDF 不保留原布局和照片；`sent` 只表示 SMTP 接受，回复同步和已读追踪尚未实现。

## 验证

本机 DSH Desktop `0.2.2-rc.1` 所带运行时用于验证安装、原生工具、卡片、PDF、用户命令及会话恢复。验证使用隔离 profile、演示数据及本地固定模型响应，不调用付费模型或发真实邮件。Windows + Edge 环境运行：

```powershell
$env:DSH_COMMAND = 'D:/ai/dsh/resources/runtime/cli/bin/dsh.cmd'
npm run verify:dsh
```

默认检查开发链接；设置 `RESUME_PLUGIN_SPEC` 为生成的 `.tgz` 绝对路径可检查预构建包。结束后关闭临时服务并清理资料库。其他宿主见 [MCP 说明](mcp.md)。
