import { spawn } from "node:child_process";

export function recognizeResumePage(png: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const language = process.env.RESUME_OCR_LANG?.trim() || "chi_sim+eng";
    const child = spawn(process.env.RESUME_OCR_EXECUTABLE?.trim() || "tesseract",
      ["stdin", "stdout", "-l", language, "--psm", "3"],
      { windowsHide: true, stdio: ["pipe", "pipe", "ignore"], timeout: 30_000 });
    let length = 0;
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => {
      length += chunk.length;
      if (length <= 128 * 1024) chunks.push(chunk);
      else child.kill();
    });
    child.once("error", (error: NodeJS.ErrnoException) =>
      reject(new Error(error.code === "ENOENT"
        ? "这份 PDF 没有文字层。请安装本机 Tesseract 和简体中文、英文语言包，或上传已有 OCR 文字层的 PDF。"
        : "本机 OCR 无法启动，请检查 Tesseract 路径。")));
    child.once("close", (code) => {
      if (code !== 0) reject(new Error("本机 OCR 未完成，请检查 Tesseract 语言包，或上传已有文字层的 PDF。"));
      else resolve(Buffer.concat(chunks).toString("utf8").trim());
    });
    child.stdin.on("error", () => {});
    child.stdin.end(png);
  });
}
