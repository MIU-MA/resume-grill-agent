import { build } from "esbuild";
import { mkdir, writeFile, copyFile } from "node:fs/promises";
await mkdir("dist/panel-web", { recursive: true });
await copyFile(
  "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  "dist/panel-web/pdf.worker.mjs",
);
await build({
  entryPoints: ["src/panel/ui/main.tsx"],
  bundle: true,
  outfile: "dist/panel-web/app.js",
  platform: "browser",
  jsx: "automatic",
  format: "esm",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
});
await writeFile(
  "dist/panel-web/index.html",
  '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Resume Grill · 求职操作台</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>',
);
