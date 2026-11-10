import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

export async function readResume(path: string) {
  const bytes = await readFile(path);
  if (bytes.length > 10 * 1024 * 1024 || !bytes.length)
    throw new Error("简历须在 10 MiB 以内且不能为空。");
  let text: string;
  if (/\.(txt|md)$/i.test(path)) text = bytes.toString("utf8");
  else if (/\.docx$/i.test(path)) {
    const mammoth = await import("mammoth");
    text = (await mammoth.extractRawText({ buffer: bytes })).value;
  } else if (/\.pdf$/i.test(path)) {
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
    const pdf = await task.promise;
    try {
      const pages = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        const content = await (await pdf.getPage(n)).getTextContent();
        pages.push(
          content.items
            .map((item) =>
              "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
            )
            .join(""),
        );
      }
      text = pages.join("\n");
    } finally {
      await task.destroy();
    }
  } else throw new Error("支持 PDF、DOCX、TXT、Markdown。");
  if (!text.trim() || text.length > 30000)
    throw new Error("未能提取正文或超过 30000 字；扫描 PDF 请先 OCR。");
  return { text, bytes };
}

export async function renderPdf(text: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(
    await readFile(
      fileURLToPath(
        new URL("../assets/NotoSansSC-Regular.ttf", import.meta.url),
      ),
    ),
    { subset: true },
  );
  let page = pdf.addPage([595.28, 841.89]),
    y = 795;
  const line = (value: string) => {
    if (y < 46) {
      page = pdf.addPage([595.28, 841.89]);
      y = 795;
    }
    page.drawText(value, { x: 46, y, size: 10.5, font });
    y -= 17;
  };
  for (const paragraph of text.replace(/\r/g, "").split("\n")) {
    let current = "";
    for (const character of paragraph) {
      if (font.widthOfTextAtSize(current + character, 10.5) > 503 && current) {
        line(current);
        current = "";
      }
      current += character;
    }
    line(current);
  }
  return pdf.save();
}
