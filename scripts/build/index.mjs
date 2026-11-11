import { rm, lstat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname, basename } from "node:path";
import { spawn } from "node:child_process";

const root = fileURLToPath(new URL("../../", import.meta.url));
process.chdir(root);
const output = resolve(root, "dist");
if (dirname(output) !== resolve(root) || basename(output) !== "dist")
  throw new Error("构建输出不在项目目录内。");
const info = await lstat(output).catch((error) => {
  if (error.code === "ENOENT") return null;
  throw error;
});
if (info?.isSymbolicLink()) throw new Error("dist 不能是指向其他位置的链接。");
await rm(output, { recursive: true, force: true });
await new Promise((done, reject) => {
  const child = spawn(
    process.execPath,
    [resolve(root, "node_modules/typescript/bin/tsc")],
    { cwd: root, stdio: "inherit" },
  );
  child.on("error", reject);
  child.on("exit", (code) =>
    code === 0 ? done() : reject(new Error(`TypeScript 构建失败：${code}`)),
  );
});
await import("./panel.mjs");
await import("./dsh.mjs");
