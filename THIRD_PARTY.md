# 来源与许可

- `src/domain/` 及 `src/infrastructure/careers/` 的招聘页面提取、链接规范化、来源目录与相关类型提取自 [Resume Grill](https://github.com/MIU-MA/resume-grill) 主分支提交 `04f723285a5fe87395d03b9636cb47ce1e3c3396`，调整 Node ESM 导入路径与格式，并裁剪无关协议字段。保留原 MIT 许可及版权声明，见 LICENSE。
- `assets/NotoSansSC-Regular.ttf` 来自原项目使用的 Noto Sans SC 字体，许可见 `assets/OFL.txt`。仅用于生成中文 PDF。
- `src/infrastructure/documents.ts` 的独立 TrueType 子集处理参考原项目 `src/features/resume/lib/resume-pdf-font.ts`，避免中文子集缺字；仍保留原 MIT 版权声明。
- 依赖许可由各 npm 包附带。此仓库未复制原项目的数据库、用户文件、账号配置或未提交的 Go 实验代码。
