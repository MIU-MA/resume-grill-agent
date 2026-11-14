# DSH 安装与使用

## 通过官方安装器安装

DSH 的“插件 → 添加插件 → 安装第三方插件”可以安装 npm 包、Git 仓库、本地目录和插件压缩包；不要求每个用户克隆项目后构建。[官方安装器说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-plugin-manager/README.zh.md)

本项目当前提供本地预构建包：

1. 由维护者在仓库运行 `npm ci`、`npm run package:plugin`。
2. 将 `artifacts/` 中生成的 `.tgz` 交给使用者。
3. 使用者在 DSH 官方安装入口填写下载文件的绝对路径，安装并启用“求职助手”。CLI 等价方式如下，路径须替换为实际下载位置：

```powershell
dsh plugin --profile desktop add 'C:/Downloads/resume-grill-agent-0.3.0.tgz'
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

打开会话后，侧栏底部的“求职”可随时查看简历、岗位、待确认邮件和投递记录；同一资料库也供对话工具使用。邮件与简历核对复用对话卡片的服务和组件。

侧栏主入口“求职工作台”打开宽页面；底部“求职”保留快捷侧栏。简历支持选择文件、拖拽上传、查看原文件和编辑正文。文件先通过 DSH 附件服务暂存，再导入插件资料库，不会自动提交给模型。

简历库还支持粘贴文字新建、重命名、复制、搜索名称／岗位／内容摘要，以及原始简历和派生版本分类。正文编辑另存副本，保留来源关系。删除移到回收站，可以撤销或恢复；不会级联删除派生版本、原文件及投递附件，也不会在模型的可用简历列表中继续出现。总览可直接继续编辑最近的简历或核对待确认邮件。

“岗位”按公司官网实时拉取，复用原网页端的静态、动态页面读取与腾讯公开接口，记录读取时间和失败原因。点击具体职位读取当前 JD，再选择简历进行匹配；JD 更新产生独立上下文，旧建议不会套到新 JD。用户可接受 AI 建议或手动修改，并独立保存岗位版 PDF，不必提供招聘邮箱。AI 建议使用当前 DSH 会话模型，完成后同步刷新核对卡。

在 DSH 设置中打开“求职邮箱”，填写发件邮箱和 SMTP 授权码并保存；需要真实投递时开启对应选项。设置立即生效，授权码按账号隔离并存入 DSH 凭据服务；留空保留已存授权码，也可单独移除。“测试连接”只验证 SMTP 登录，不发送邮件。用户勾选核对、输入“发送”后才能提交；助手不能批准自己发信。未在页面配置邮箱时仍兼容 `RESUME_SMTP_ADDRESS`、`RESUME_SMTP_CODE`、`RESUME_SMTP_PROVIDER` 和 `RESUME_ALLOW_SEND=1` 环境配置。

资料默认在 `DSH_HOME/storages/resume-grill`，通常为 `%USERPROFILE%/.dsh/storages/resume-grill`；`RESUME_AGENT_HOME` 可指定其他绝对目录。恢复卡片重新读取当前状态，不保存批准。新 PDF 不保留原布局和照片；`sent` 只表示 SMTP 接受，回复同步和已读追踪尚未实现。

## 招聘官网表单

当前插件负责简历、JD、邮件和记录，没有启用浏览器填写器。DSH 侧栏 Browser 用于显示网页，本身不会提供点击、输入或上传工具。需要另行启用与本机 DSH 版本兼容的浏览器提供器，例如官方 [Chrome DevTools MCP 提供器](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/experimental/browser-use-chrome-devtools-mcp/README.md)，将登录、页面字段读取、资料填写、附件上传及填写结果核对串起来。官方提供器可启动独立浏览器或连接已有调试端点；不是直接接管任意正在使用的浏览器。

接入后仍需按实际网站验证经历分组、下拉框和附件字段，不能保证全部大厂通用。登录及验证码交给用户处理，最后提交留给用户确认。尚未连接和验证的功能不能显示为“已填写”。

## 验证

本机 DSH Desktop `0.2.2-rc.1` 所带运行时用于验证安装、原生工具、卡片、PDF、用户命令及会话恢复。验证使用隔离 profile、演示数据及本地固定模型响应，不调用付费模型或发真实邮件。Windows + Edge 环境运行：

```powershell
$env:DSH_COMMAND = 'D:/ai/dsh/resources/runtime/cli/bin/dsh.cmd'
npm run verify:dsh
```

默认检查开发链接；设置 `RESUME_PLUGIN_SPEC` 为生成的 `.tgz` 绝对路径可检查预构建包。结束后关闭临时服务并清理资料库。其他宿主见 [MCP 说明](mcp.md)。

设置 `RESUME_VERIFY_LIVE=1` 会额外实际读取腾讯官网，检查实时岗位 → 完整 JD → 手动修改 → 保存 PDF；仍不调用付费模型或发送邮件。公开网站返回结果可能随时间改变，此项不属于默认离线测试。
