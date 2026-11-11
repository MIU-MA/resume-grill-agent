# 开发约定

项目保持单包结构：业务服务独立于 DSH、MCP、CLI 和浏览器，不为每个入口复制流程。

```text
src/
  core/                 Workspace、求职任务与共用操作
  domain/               简历与岗位匹配的纯规则
  infrastructure/       SQLite、文档、SMTP、招聘页读取
  adapters/
    dsh/                原生插件、命令和对话卡片
    mcp/                MCP 协议入口
    cli/                命令行入口
    panel/              可选面板的 HTTP 与 React 界面
  shared/               跨入口复用的组件、展示和路径工具
plugin/                 DSH 清单、图标、语言资源
scripts/
  build/                编译与前端打包
  release/              生成并检查安装包
  verify/               需要浏览器或 DSH 的集成验证
tests/                 按 core、adapters、infrastructure 对应测试
docs/                  安装与开发文档
examples/              演示与 MCP 配置
skills/                供其他宿主加载的求职说明
assets/                字体及许可
```

- 新业务流程放 `core/`，纯规则放 `domain/`；不要在 `src/` 根目录或适配器里继续堆服务。
- 具体文件、网络和邮件实现放 `infrastructure/`。适配器只处理协议、界面和用户动作。
- 共享组件放 `shared/ui/`，DSH 不反向引用面板内部组件；浏览器代码不导入 Node 路径工具或数据库实现。
- `plugin/` 不放业务源码；新增构建资源时同步更新清单和打包检查。
- `scripts/verify/` 的临时服务、固定模型响应和演示资料不能进入正式插件。
- 资料只写入指定数据目录；`dist/`、`artifacts/`、`.resume-agent/` 不进 Git。

## 常用命令

```bash
npm ci
npm run check
npm test
npm run package:plugin
```

`npm test` 先构建再运行全部递归测试。构建会检查并清理项目内的 `dist/`，避免迁移目录后的旧入口混入插件包。打包检查入口、前端、字体及数据排除规则，只将预构建运行文件写入 `artifacts/*.tgz`，不发布、不上传。

浏览器检查：`npm run verify:panel`；原生检查：设置 `DSH_COMMAND` 后 `npm run verify:dsh`。原生脚本可用 `RESUME_PLUGIN_SPEC` 指向预构建包，确认包能脱离源码工作。验证关闭真实发信，使用固定本地模型响应；Windows／Edge 专用脚本不作为所有系统的默认测试。

修改服务后运行类型检查、测试和构建；涉及入口或资源路径时还要验证安装包。SMTP 测试使用替代函数，不能复用历史单次授权发送新邮件。
