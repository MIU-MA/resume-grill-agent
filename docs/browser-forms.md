# 官网填写试验

上传简历后自动打开资料核对页；已有简历可从“解析为可复用资料”进入。先由本地规则生成联系方式、教育、工作／实习和项目经历草稿，保留原文依据，用户可修改、补充、增删经历，确认后存入本机 SQLite。第一版不是完整 AI 语义解析：复杂版式、无明显标题或日期的经历可能漏识别，需要人工核对。

资料绑定简历 ID 和正文摘要，跨岗位复用；正文另存新版本后必须重新解析核对，不把旧确认套到新版本。修改已确认资料会生成新快照，旧快照保留。这里的资料补充不会改写原简历。

在「招聘官网」打开岗位，可直接点「打开官网手动申请」。需要代填时，确认资料后再点「开始官网代填」。插件检查当前会话是否启用了招聘浏览器 MCP；没有工具会直接提示，不调用模型。BOSS 岗位请走「BOSS 投递」，无需此配置。

`application_form_context` 只提供该简历已确认的结构化资料和证据、资料快照 ID、所选岗位 JD，以及实际附件路径、大小和 SHA-256，不要求每个官网重新解析整份简历。模型把实际页面字段对应到联系方式及具体经历条目，回读结果再与已确认资料比较；网站解析附件只作辅助，不能覆盖用户补充。已删除简历、未确认资料和校验失败的 PDF 不能使用；不依赖招聘邮箱，不生成邮件。

流程止于填写和回读核对。登录、验证码、无法对应的字段交给用户处理；不自动最终提交，不代勾同意声明。浏览器工具本身有点击和输入能力，这一边界是任务约束，并不是浏览器端的提交拦截器。

## 本机 DSH 0.2.2 的接入

### 自动填写任务

`start_form_run` 创建或恢复绑定简历、资料快照、岗位和附件的任务。DSH 从最新页面快照提取真实字段（UID、标签、类型、选项、已有值及经历分组），交给 `plan_form_fill`；程序从已确认资料生成批量填写参数，跳过已一致的字段和附件，已有内容冲突则交给用户核对。多段同类经历必须确定分组序号，不能把招聘公司当作用户的工作单位。

执行后重新读取页面，由 `verify_form_fill` 比较实际值和计划值；缺失或不一致不能标成完成。同一轮重复回读不重复计错，字段失败两轮后停止自动重试。进度存在本机 SQLite，资料或附件改变后旧任务失效；申请域名改变时不生成填写动作，需要人工核对。

岗位页会显示已核对项目、缺项及失败原因。`ready` 仅表示已回读且没有已知必填阻塞，仍未提交。页面观察和输入仍依赖 DSH 模型及浏览器工具，当前并不是独立的后台填写器，也不保证所有网站都能自动识别字段。

这里使用宿主已有的 `@deepseek-ai/dsh-mcp-client` 连接官方 `chrome-devtools-mcp@1.13.0`。不依赖浏览器扩展，也不把网页嵌进工作台。新版本 DSH 的专用浏览器提供器可另行评估，不能直接假设旧版自带。

仓库开发环境 `npm ci` 会安装验证所需的固定版本。只安装插件包的用户需另行安装该 MCP 服务；它不是插件的生产依赖。以下是从源码运行的 Windows 示例，请按真实位置调整路径：

```powershell
$env:RESUME_BROWSER_MCP_ENTRY = (Resolve-Path node_modules/chrome-devtools-mcp/out/Default/gen/src/bin/chrome-devtools-mcp.js).Path
$env:RESUME_BROWSER_EXECUTABLE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
$env:RESUME_BROWSER_PROFILE = Join-Path $env:LOCALAPPDATA 'ResumeGrill/recruiting-browser'
$env:RESUME_AGENT_HOME = Join-Path $env:USERPROFILE '.dsh/storages/resume-grill'
dsh --profile web --patch (Resolve-Path examples/dsh-browser.patch.yml).Path
```

所选 profile 需先安装并启用本插件。示例新开一个可见的专用浏览器，复用这个专用目录内的登录状态；不会接管日常 Edge 的登录资料。浏览器在工具首次使用时启动，关闭 DSH 时由 MCP 清理。一次用一个求职会话操作，不要让多个会话同时改同一个表单。

MCP 的文件范围只授权 `RESUME_AGENT_HOME`，否则这版 DSH 没有协商 MCP roots 时，服务默认只能读取临时目录，真实简历附件会被拒绝。不要把范围扩大到整个磁盘。示例还关闭使用统计、CrUX、JavaScript 求值及文件 URL 导航；不会安装到你当前的 Desktop profile。

## 已验证的范围

- 实际 DSH 运行时 → 原生填写入口 → 资料工具 → 官方 Chrome DevTools MCP → HTTPS 表单。
- 姓名、手机、邮箱、学校、学历下拉框、项目文本填写后重新读取；缺失的毕业日期保持空白。
- 上传接口实际接收所选 PDF 的字节；同意声明未勾选，最终提交接口调用次数为零，邮件记录未增加。
- 腾讯真实社招页：用户登录并明确选择简历后，上传原 PDF，等待官网自动解析，回读联系方式、学校、专业、学历及时间；额外填写并回读个人主页。未勾同意声明、未最终提交。页面提示毕业时间属于校招，缺少工作经历和意向地点的项目保持空白。
- 这不等于完整社招流程已适配，也未验证腾讯校招和其他公司的登录后表单。真实腾讯验证使用同一套官方 MCP 浏览器工具，由当前测试过程逐步核对；DSH 自动调用链使用固定本地模型，尚未评估用户真实模型的完整自动填写表现。

验证使用演示数据和固定本地模型响应，检查工具链和状态，不代表真实模型对所有字段的理解准确率。真实使用仍需逐项核对。

```powershell
$env:DSH_COMMAND = 'D:/ai/dsh/resources/runtime/cli/bin/dsh.cmd'
npm run build
npm run verify:browser
```

该脚本使用隔离 DSH profile、临时资料库、本地 HTTPS 表单和 Edge，不读取真实账号或调用付费模型。Windows 需 OpenSSL（默认 Git for Windows 路径，可设 `RESUME_TEST_OPENSSL`），本机 `127.0.0.1:443` 需空闲。测试专用的证书忽略选项不会写入用户配置。
