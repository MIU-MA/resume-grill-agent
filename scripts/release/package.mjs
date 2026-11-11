import { mkdir, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("../../", import.meta.url)),
  output = resolve(root, "artifacts");
assert.equal(dirname(output), resolve(root));
await mkdir(output, { recursive: true });
const npm = process.env.npm_execpath;
assert.ok(npm, "请通过 npm run package:plugin 生成插件包。");
const stdout = await new Promise((done, reject) => {
  const child = spawn(
    process.execPath,
    [npm, "pack", "--json", "--pack-destination", output],
    { cwd: root, stdio: ["ignore", "pipe", "inherit"] },
  );
  let text = "";
  child.stdout.on("data", (chunk) => (text += chunk));
  child.on("error", reject);
  child.on("exit", (code) =>
    code === 0 ? done(text) : reject(new Error(`打包失败：${code}`)),
  );
});
const [archive] = JSON.parse(stdout),
  manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const files = new Set(archive.files.map((file) => file.path));
const target = resolve(output, archive.filename);
assert.equal(dirname(target), output);
try {
  for (const entry of [
    manifest.main,
    manifest.exports["./client"],
    manifest.dsh.bundle.patch,
    "plugin/icon.svg",
    "plugin/locale/zh.json",
    "assets/NotoSansSC-Regular.ttf",
    "assets/OFL.txt",
    "dist/adapters/cli/main.js",
    "dist/web/panel/index.html",
  ])
    assert.ok(files.has(entry.replace(/^\.\//, "")), `插件包缺少 ${entry}`);
  assert.ok(
    ![...files].some(
      (file) =>
        /(^|\/)(\.resume-agent|node_modules|\.git|tests|src)\//.test(file) ||
        /\.db(?:-wal|-shm)?$|\.env$|\.log$/.test(file),
    ),
    "插件包混入了源码测试或本机数据。",
  );
} catch (error) {
  await rm(target, { force: true });
  throw error;
}
console.log(
  `插件包：${target}\n已检查运行入口、界面、字体和数据排除规则。可在 DSH「插件 → 添加插件」中填写此绝对路径安装。`,
);
