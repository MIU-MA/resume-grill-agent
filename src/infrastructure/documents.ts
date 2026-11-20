import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { packageRoot } from "../shared/package-paths.js";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { createFont } from "fonteditor-core";
import { resumeSectionHeading } from "../domain/resume-structure.js";
import { recognizeResumePage } from "./pdf-ocr.js";

export async function readResume(path: string, { ocr = recognizeResumePage } = {}) {
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
      const pages: string[] = [];
      let scans = 0;
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        const content = await page.getTextContent();
        const extracted = content.items
            .map((item) =>
              "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
            )
            .join("");
        if (/\p{L}/u.test(extracted) || extracted.trim().length > 5) {
          pages.push(extracted);
          continue;
        }
        const operators = await page.getOperatorList();
        const hasImage = operators.fnArray.some((op) =>
          [pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.paintImageMaskXObject].includes(op));
        if (!hasImage && pdf.numPages > 1) {
          pages.push(extracted);
          continue;
        }
        if (++scans > 6)
          throw new Error("扫描页超过 6 页，请拆分或先生成带文字层的 PDF。");
        const original = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(3, 2300 / original.width, 3200 / original.height) });
        if (!(viewport.width >= 1 && viewport.height >= 1)) throw new Error("扫描页尺寸无效。");
        const target = canvas.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await page.render({ canvas: target as unknown as HTMLCanvasElement, viewport, background: "#fff" }).promise;
        pages.push(await ocr(target.toBuffer("image/png")));
      }
      text = pages.join("\n");
    } finally {
      await task.destroy();
    }
  } else throw new Error("支持 PDF、DOCX、TXT、Markdown。");
  if (!text.trim()) throw new Error("没有识别到可用的简历正文。");
  if (text.length > 30000) throw new Error("简历正文超过 30000 字。");
  return { text, bytes };
}

const symbolFallbacks: Record<string, string> = {
  "📱": "电话 ", "☎": "电话 ", "📞": "电话 ", "📧": "邮箱 ", "✉": "邮箱 ",
  "📍": "地点 ", "🔗": "链接 ", "✅": "•", "✔": "•", "▪": "•", "●": "•", "‣": "•",
  "→": "->", "–": "-", "—": "-", "−": "-", "…": "...",
};
function printableText(text: string, available: Set<number>) {
  const graphemes = new Intl.Segmenter();
  return Array.from(graphemes.segment(text.replace(/\r\n?/g, "\n")), ({ segment }) => {
    if (segment === "\n") return segment;
    if (/^\s+$/u.test(segment)) return " ";
    const plain = segment.replace(/[\uFE0E\uFE0F]/g, "");
    if (Array.from(plain).every((character) => available.has(character.codePointAt(0)!))) return plain;
    const fallback = symbolFallbacks[plain] ?? (/\p{Extended_Pictographic}/u.test(plain) ? "•" : "□");
    return Array.from(fallback).every((character) => available.has(character.codePointAt(0)!)) ? fallback : "?";
  }).join("");
}

export async function renderPdf(
  text: string,
  { updateMetadata = true } = {},
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create({ updateMetadata });
  pdf.registerFontkit(fontkit);
  const bytes = await readFile(
    join(packageRoot, "assets/NotoSansSC-Regular.ttf"),
  );
  const available = new Set(fontkit.create(bytes).characterSet);
  const printable = printableText(text, available);
  // Same standalone TTF approach as Resume Grill: pdf-lib CJK subsetting can omit glyphs.
  const subset = createFont(Uint8Array.from(bytes).buffer, {
    type: "ttf",
    subset: [
      ...new Set(
        Array.from(printable + " ")
          .filter((c) => !/[\n\r\t]/.test(c))
          .map((c) => c.codePointAt(0)!),
      ),
    ],
    compound2simple: true,
    hinting: false,
  });
  const font = await pdf.embedFont(
    subset.write({ type: "ttf", toBuffer: false }),
    { subset: false },
  );
  const size = [595.28, 841.89] as const, margin = 46;
  const ink = rgb(0.13, 0.16, 0.20), accent = rgb(0.14, 0.29, 0.49), rule = rgb(0.80, 0.85, 0.91);
  let page = pdf.addPage([...size]), y = 795;
  const room = (needed: number) => {
    if (y - needed >= margin) return;
    page = pdf.addPage([...size]);
    y = 795;
  };
  const paragraphs = printable.trim().split("\n");
  for (const [index, raw] of paragraphs.entries()) {
    const paragraph = raw.trim();
    if (!paragraph) {
      y -= 6;
      continue;
    }
    const heading = resumeSectionHeading(paragraph);
    const name = index === 0 && !heading && paragraphs.length > 1 &&
      /^(?:姓名[:：]\s*)?[\p{Script=Han}·]{2,5}$/u.test(paragraph);
    const textSize = name ? 23 : heading ? 12.5 : 10.5;
    const leading = name ? 30 : heading ? 22 : 16;
    const label = heading ? heading.title : paragraph;
    if (heading) {
      room(52);
      y -= 7;
      page.drawLine({ start: { x: margin, y: y - 5 }, end: { x: size[0] - margin, y: y - 5 }, thickness: 0.7, color: rule });
    }
    const bullet = /^(?:[-*•●▪]|\d+[.)、])\s*/.exec(label)?.[0];
    let x = margin, current = "";
    const draw = () => {
      room(leading);
      page.drawText(current.trimEnd(), { x, y, size: textSize, font, color: heading || name ? accent : ink });
      y -= leading;
      x = margin + (bullet ? 12 : 0);
      current = "";
    };
    const fits = (value: string) => font.widthOfTextAtSize(value, textSize) <= size[0] - x - margin;
    for (const token of label.match(/\p{Script=Han}|\s+|[^\p{Script=Han}\s]+/gu) ?? []) {
      if (current && !fits(current + token)) draw();
      if (fits(token)) {
        if (current || token.trim()) current += token;
        continue;
      }
      for (const char of token) {
        if (current && !fits(current + char)) draw();
        current += char;
      }
    }
    if (current) draw();
  }
  return pdf.save();
}
