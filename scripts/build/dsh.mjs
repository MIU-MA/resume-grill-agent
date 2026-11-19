import { build } from "esbuild";
import { readFile } from "node:fs/promises";
const portrait = await readFile("plugin/branding/ds-chan.webp");
await build({
  entryPoints: ["src/adapters/dsh/client.tsx"],
  outfile: "dist/adapters/dsh/client.js",
  bundle: true,
  platform: "browser",
  format: "cjs",
  jsx: "automatic",
  external: ["react", "react/jsx-runtime"],
  define: {
    __DS_CHAN__: JSON.stringify(`data:image/webp;base64,${portrait.toString("base64")}`),
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
