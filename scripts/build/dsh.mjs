import { build } from "esbuild";
import { readFile } from "node:fs/promises";
const whalePreview = process.env.RESUME_WHALE_PREVIEW === "1"
  ? `data:image/webp;base64,${(await readFile(".resume-agent/preview/whale-avatar.webp")).toString("base64")}`
  : "";
await build({
  entryPoints: ["src/adapters/dsh/client.tsx"],
  outfile: "dist/adapters/dsh/client.js",
  bundle: true,
  platform: "browser",
  format: "cjs",
  jsx: "automatic",
  external: ["react", "react/jsx-runtime"],
  define: {
    __WHALE_PREVIEW__: JSON.stringify(whalePreview),
    __NATIVE_CSS__: JSON.stringify(
      await readFile("src/adapters/dsh/native.css", "utf8"),
    ),
    "process.env.NODE_ENV": '"production"',
  },
  banner: {
    js: 'window.__ModuleLoader__.load({id:"resume-grill-agent",factory:(require)=>{var module={exports:{}};var exports=module.exports;',
  },
  footer: { js: "return module.exports;}});" },
});
