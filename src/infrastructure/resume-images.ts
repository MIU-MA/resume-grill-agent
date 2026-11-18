import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

/** Rasterize the selected PDF itself, including its original layout and photos. */
export async function resumeImages(path: string) {
  const bytes = await readFile(path);
  if (
    bytes.length > 10 * 1024 * 1024 ||
    !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))
  )
    throw new Error("需要 10 MiB 以内的有效 PDF 简历。");
  const canvas = await import("@napi-rs/canvas");
  Object.assign(globalThis, {
    DOMMatrix: canvas.DOMMatrix,
    ImageData: canvas.ImageData,
    Path2D: canvas.Path2D,
  });
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: Uint8Array.from(bytes),
    useSystemFonts: true,
  });
  try {
    const pdf = await task.promise;
    if (pdf.numPages < 1 || pdf.numPages > 3)
      throw new Error("BOSS 简历图片最多 3 页，请先缩减 PDF；不会截断简历。");
    const images = [];
    let total = 0;
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n),
        initial = page.getViewport({ scale: 1 });
      const scale = Math.min(1.6, 1600 / initial.width, 2400 / initial.height),
        viewport = page.getViewport({ scale });
      if (
        !Number.isFinite(viewport.width) ||
        viewport.width < 1 ||
        viewport.height < 1
      )
        throw new Error("PDF 页面尺寸无效。");
      const target = canvas.createCanvas(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      );
      await page.render({
        canvas: target as any,
        canvasContext: target.getContext("2d") as any,
        viewport,
        background: "rgb(255,255,255)",
      }).promise;
      const png = target.toBuffer("image/png");
      total += png.length;
      if (png.length > 5 * 1024 * 1024 || total > 10 * 1024 * 1024)
        throw new Error("简历图片超过上传限制，请缩减 PDF 后重试。");
      images.push({
        bytes: png,
        sha256: createHash("sha256").update(png).digest("hex"),
        width: target.width,
        height: target.height,
      });
    }
    return {
      pdfHash: createHash("sha256").update(bytes).digest("hex"),
      images,
    };
  } finally {
    await task.destroy();
  }
}
