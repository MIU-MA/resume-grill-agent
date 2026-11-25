# DSH 安装与使用

## 通过官方安装器安装

DSH 的“插件 → 添加插件 → 安装第三方插件”可以安装 npm 包、Git 仓库、本地目录和插件压缩包；不要求每个用户克隆项目后构建。[官方安装器说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-plugin-manager/README.zh.md)

1. 从 [GitHub Releases](https://github.com/MIU-MA/resume-grill-agent/releases/latest) 的 Assets 下载 `resume-grill-agent-*.tgz`。
2. 在 DSH 安装入口填写下载文件的绝对路径，安装并启用「Resume Grill」。
3. 从 DSH 左侧打开 **Resume Grill**。

也可以用 CLI 安装，将示例路径换成实际下载位置。

```powershell
dsh plugin --profile desktop add 'C:/Downloads/resume-grill-agent-0.4.5.tgz'
```

Web 版将 `desktop` 换成 `web`。升级时用同一入口安装新版 `.tgz`，完全退出 DSH（包括托盘菜单里的「退出」）后重新打开。安装包包含构建后的 Host、React 卡片、字体和插件声明，安装时仍需下载运行依赖。

## 开发者本地链接

只有开发者需要链接源码目录。先 `npm ci`、`npm run build`，然后通过官方安装器填写项目绝对目录，或运行：

```powershell
dsh plugin --profile desktop add 'link:C:/path/resume-grill-agent'
```

本机 Desktop 自带 CLI 在 `D:/ai/dsh/resources/runtime/cli/bin/dsh.cmd`；未加入 PATH 时用 `& '实际路径/dsh.cmd'` 替换 `dsh`。改代码后重新构建并重启 DSH。卸载使用 `dsh plugin --profile desktop remove resume-grill-agent`，不删除求职资料。

`plugin/` 只放插件清单、图标和语言资源；`package.json` 的 `dsh.bundle.patch` 指向该清单，Host 与 Client 构建入口在 `dist/adapters/dsh/`。

## 使用与发件

在工作台打开「邮箱投递」，点「设置发件邮箱」填写邮箱和 SMTP 授权码，并启用真实发送。选简历并填写收件邮箱，点击「预览投递邮件」。可以修改主题和正文，核对附件后确认发送。官网岗位也能走按 JD 修改简历的投递流程。

「招聘官网」可以新建或打开求职目标。打开目标后可选择岗位进行分析，也可用简历原文准备所选邮件。已生成的批次可在「邮箱投递 → 邮件批次」打开。岗位详情支持直接填写收件邮箱并准备邮件。

在对话中提供简历路径和方向。助手调用 `resume_grill_*` 工具后，回答下方显示岗位和修改核对卡；勾选修改并准备邮件，核对收件人、正文和实际附件。城市与排除条件会保留，缺信息时显示原因。点击“请助手给出修改建议／分析所选岗位”会请求模型，其他按钮直接执行本地操作。

未发送邮件可点“修改邮件”，直接编辑收件人、主题和正文。保存后生成新预览，沿用已冻结的 PDF；旧预览及其发送确认失效，批次打开修改后的邮件。编辑期间不提供发送操作，保存失败保留输入。已发送、发送中或结果待核对的邮件不能编辑。

从左侧「Resume Grill」打开工作台，底部「求职快开」打开快捷侧栏。同一个 DSH 会话内切回分页时，会恢复上次打开的详情、搜索条件和筛选。在这两个入口都能查看简历、岗位、待确认邮件和投递记录。简历文件通过 DSH 附件服务导入同一资料库，支持拖拽上传、查看原文件和编辑正文。导入时不会自动提交给模型。

简历库还支持粘贴文字新建、重命名、复制、搜索名称／岗位／内容摘要，以及原始简历和派生版本分类。正文编辑另存副本，保留来源关系。删除移到回收站，可以撤销或恢复；不会级联删除派生版本、原文件及投递附件，也不会在模型的可用简历列表中继续出现。总览可直接继续编辑最近的简历或核对待确认邮件。

“岗位”按公司官网实时拉取，复用原网页端的静态、动态页面读取与腾讯公开接口，记录读取时间和失败原因。点击具体职位读取当前 JD，再选择简历进行匹配；JD 更新产生独立上下文，旧建议不会套到新 JD。用户可接受 AI 建议或手动修改，并独立保存岗位版 PDF，不必提供招聘邮箱。AI 建议使用当前 DSH 会话模型，完成后同步刷新核对卡。

在 DSH 设置中打开「Resume Grill 邮箱」，填写发件邮箱和 SMTP 授权码并保存。QQ、163、126 有内置配置，企业邮箱可在「自定义 SMTP」填写服务商给出的主机、端口及 TLS 或 STARTTLS。自定义 SMTP 需要服务商允许授权码或应用密码登录。设置立即生效，授权码按账号及自定义服务器保存到 DSH 凭据服务。开启真实发送后仍需核对预览并输入「发送」确认。“测试连接”只验证 SMTP 登录。命令行仍可用 `RESUME_SMTP_ADDRESS`、`RESUME_SMTP_CODE`、`RESUME_SMTP_PROVIDER` 和 `RESUME_ALLOW_SEND=1`。自定义模式设 `RESUME_SMTP_PROVIDER=custom`，再设 `RESUME_SMTP_HOST`、`RESUME_SMTP_PORT` 和 `RESUME_SMTP_SECURITY`（`tls` 或 `starttls`）。

「投递记录」汇总 BOSS、官网和邮件记录。点「记录跟进」可保存等回复、已约面、已结束及备注，用「到期跟进」筛出今天和逾期的事项。官网在提交后从岗位卡片点「记录官网已提交」。跟进进展由你填写，邮件回执继续显示 SMTP 发送状态。

保留原文时直接复用整份 PDF。改写后生成可选中文字的单栏版。如果最初上传的 PDF 首页上方能识别出唯一一张合适尺寸的独立照片，会带入新版本。整页扫描或有多个符合条件的图片时，新版本仍可保存，状态会提示照片未识别。扫描件可安装 [Tesseract](https://tesseract-ocr.github.io/tessdoc/Installation) 后在本机提取文字，默认语言为简体中文与英文。程序在 PATH 之外时可设置 `RESUME_OCR_EXECUTABLE`，也可用 `RESUME_OCR_LANG` 明确指定已安装语言，例如 `chi_sim+eng`。

「解析为可复用资料」会显示已读取的 PDF 页数，并分类展示教育、工作、项目、竞赛和校园经历。原文件已上传时，可以在资料页点「重新解析原文」，核对新增字段后再确认。确认前，官网仍使用上次确认的资料。

资料默认在 `DSH_HOME/storages/resume-grill`，通常为 `%USERPROFILE%/.dsh/storages/resume-grill`。可用 `RESUME_AGENT_HOME` 指定绝对目录。恢复卡片时重新读取状态，`sent` 表示 SMTP 接受。

## 模块配置

默认启用全部能力。打开 DSH「设置 → Resume Grill 模块」，选择需要的模块，保存后重新启动该 Profile。也可以在该 Profile 的 `cordis.patch.yml` 修改 `resume-grill` 插件的配置。以下配置保留简历库、官网岗位读取、按 JD 改简历与 BOSS。

```yaml
- id: resume-grill
  config:
    disabledCapabilities: [mail, website]
```

可选项为 `boss`（BOSS 投递）、`mail`（邮箱投递）、`website`（官网表单填写）。配置 `[boss, mail, website]` 可只用简历和岗位能力。停用会移除对应工具、操作入口与统计，并保留已存资料。重新启用后可以继续查阅记录。邮箱授权码和真实发送开关仍由原有设置管理。

## 招聘官网表单

从「招聘官网」打开岗位，确认所选简历的资料后点击「官网代填」。插件会打开专用 Edge 或 Chrome，填写能识别的申请表。请在官网补齐必填项、核对附件并提交。BOSS 岗位在「BOSS 投递」处理。[官网代填说明](browser-forms.md)

接入后仍需按实际网站验证经历分组、下拉框和附件字段，不能保证全部大厂通用。登录及验证码交给用户处理，最后提交留给用户确认。尚未连接和验证的功能不能显示为“已填写”。

## 验证

本机 DSH Desktop `0.2.2-rc.1` 所带运行时用于验证安装、原生工具、卡片、PDF、用户命令及会话恢复。验证使用隔离 profile、演示数据及本地固定模型响应，不调用付费模型或发真实邮件。Windows + Edge 环境运行：

```powershell
$env:DSH_COMMAND = 'D:/ai/dsh/resources/runtime/cli/bin/dsh.cmd'
npm run verify:dsh
```

默认检查开发链接；设置 `RESUME_PLUGIN_SPEC` 为生成的 `.tgz` 绝对路径可检查预构建包。再设置 `RESUME_PREVIOUS_PLUGIN_SPEC` 可先装旧包并验证升级。结束后关闭临时服务并清理资料库。其他宿主见 [MCP 说明](mcp.md)。

设置 `RESUME_VERIFY_LIVE=1` 会额外实际读取腾讯官网，检查实时岗位 → 完整 JD → 手动修改 → 保存 PDF；仍不调用付费模型或发送邮件。公开网站返回结果可能随时间改变，此项不属于默认离线测试。
