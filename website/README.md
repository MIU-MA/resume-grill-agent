# Resume Grill 官网

本目录存放 **Resume Grill** 的像素风展示与宣传官网，采用零构建依赖的纯静态结构（HTML + CSS + Vanilla JS），视觉语言与插件工作台保持一致，明暗主题默认跟随用户浏览器设置（`prefers-color-scheme`）。

## 目录结构

- `index.html`：官网主页面（工作台总览看板、六大模块、真实界面预览、四步求职闭环、本机隐私与人工确认、安装与 MCP 说明）
- `styles.css`：像素风样式表（零圆角、硬边偏移阴影、像素网格舞台、默认跟随系统深浅色并支持手动切换）
- `app.js`：主题切换、工作台截图切换与放大预览、安装标签页与代码一键复制
- `assets/`：像素风 DS 娘立绘、插件图标与工作台实机截图

## 本地预览

直接用浏览器打开 `website/index.html`，或在项目根目录运行静态服务：

```bash
npx serve website -l 4320
```

## 静态托管

将 GitHub Pages、Cloudflare Pages 或 Vercel 的发布目录指向 `website` 即可直接上线；该目录不在 `package.json` 的 `files` 列表中，不会混入 `.tgz` 插件包。
