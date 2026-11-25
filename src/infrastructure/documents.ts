import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { packageRoot } from "../shared/package-paths.js";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { createFont } from "fonteditor-core";
import { resumeSectionHeading } from "../domain/resume-structure.js";
import { recognizeResumePage } from "./pdf-ocr.js";

async function openPdf(bytes: Uint8Array) {
  const canvas = await import("@napi-rs/canvas");
  Object.assign(globalThis, {
    DOMMatrix: canvas.DOMMatrix,
    ImageData: canvas.ImageData,
    Path2D: canvas.Path2D,
  });
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: Uint8Array.from(bytes), useSystemFonts: true });
  return { canvas, pdfjs, task };
}

type TextItem = { str: string; transform: number[]; width: number; height: number; hasEOL: boolean };

function pdfPageText(items: (TextItem | { type: string })[]) {
  const lines: string[] = [];
  let line = "";
  let previous: TextItem | undefined;
  for (const item of items) {
    if (!("str" in item)) continue;
    const newLine = previous && item.str.trim() &&
      Math.abs(item.transform[5] - previous.transform[5]) > Math.max(2, Math.min(item.height, previous.height) * 0.3);
    if (newLine && line.trim()) {
      lines.push(line.trim());
      line = "";
    }
    if (line && item.str && previous && !/\s$/.test(line) && !/^\s/.test(item.str)) {
      const gap = item.transform[4] - (previous.transform[4] + previous.width);
      if (gap > Math.max(1, item.height * 0.17)) line += " ";
    }
    line += item.str;
    if (item.hasEOL) {
      if (line.trim()) lines.push(line.trim());
      line = "";
      previous = undefined;
    } else if (item.str.trim()) {
      previous = item;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines.join("\n");
}

type PdfLibrary = Awaited<ReturnType<typeof openPdf>>["pdfjs"];
type PdfOperators = { fnArray: number[]; argsArray: any[] };
function pdfImageRegions({ OPS, Util }: PdfLibrary, { fnArray, argsArray }: PdfOperators, initial: number[], includeMasks = false) {
  let matrix = initial;
  const stack: number[][] = [], regions: number[][] = [];
  for (const [index, op] of fnArray.entries()) {
    const args = argsArray[index];
    if (op === OPS.save || op === OPS.paintFormXObjectBegin) {
      stack.push(matrix);
      if (op === OPS.paintFormXObjectBegin && args?.[0])
        matrix = Util.transform(matrix, args[0]);
    } else if (op === OPS.restore || op === OPS.paintFormXObjectEnd) {
      matrix = stack.pop() ?? initial;
    } else if (op === OPS.transform) {
      matrix = Util.transform(matrix, args);
    } else if (op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject ||
        (includeMasks && op === OPS.paintImageMaskXObject)) {
      const bounds = [Infinity, Infinity, -Infinity, -Infinity];
      Util.axialAlignedBoundingBox([0, 0, 1, 1], matrix, bounds);
      if (bounds.every(Number.isFinite)) regions.push(bounds);
    }
  }
  return regions;
}

export async function readResume(path: string, { ocr = recognizeResumePage } = {}) {
  const bytes = await readFile(path);
  if (bytes.length > 10 * 1024 * 1024 || !bytes.length)
    throw new Error("简历须在 10 MiB 以内且不能为空。");
  let text: string, pageCount: number | undefined;
  if (/\.(txt|md)$/i.test(path)) text = bytes.toString("utf8");
  else if (/\.docx$/i.test(path)) {
    const mammoth = await import("mammoth");
    text = (await mammoth.extractRawText({ buffer: bytes })).value;
  } else if (/\.pdf$/i.test(path)) {
    const { canvas, pdfjs, task } = await openPdf(bytes);
    try {
      const pdf = await task.promise;
      pageCount = pdf.numPages;
      const pages: string[] = [];
      let scans = 0;
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        const content = await page.getTextContent();
        const extracted = pdfPageText(content.items);
        if (extracted.replace(/\s/g, "").length >= 120 && extracted.split("\n").length >= 3) {
          pages.push(extracted);
          continue;
        }
        const original = page.getViewport({ scale: 1 });
        const regions = pdfImageRegions(pdfjs, await page.getOperatorList(), original.transform, true);
        const hasText = /\p{L}/u.test(extracted) || extracted.trim().length > 5;
        const fullPageImage = regions.some(([left, top, right, bottom]) =>
          right - left >= original.width * 0.55 && bottom - top >= original.height * 0.55);
        if ((!regions.length && pdf.numPages > 1) || (hasText && !fullPageImage)) {
          pages.push(extracted);
          continue;
        }
        if (++scans > 6)
          throw new Error("扫描页超过 6 页，请拆分或先生成带文字层的 PDF。");
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
  return { text, bytes, pageCount };
}

/** Copy a single portrait-sized image from the original PDF's first-page header. */
export async function readPdfHeaderPhoto(path: string): Promise<Buffer | undefined> {
  const bytes = await readFile(path);
  if (bytes.length > 10 * 1024 * 1024) return;
  const { canvas, pdfjs, task } = await openPdf(bytes);
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const regions = new Map<string, number[]>();
    for (const bounds of pdfImageRegions(pdfjs, await page.getOperatorList(), viewport.transform)) {
        const [left, top, right, bottom] = bounds;
        const width = right - left, height = bottom - top;
        if (left < 0 || top < 0 ||
            right > viewport.width || bottom > viewport.height ||
            top > viewport.height * 0.19 || bottom > viewport.height * 0.29 ||
            width < viewport.width * 0.07 || width > viewport.width * 0.23 ||
            height < viewport.height * 0.07 || width / height < 0.5 || width / height > 1.13 ||
            (left > viewport.width * 0.24 && right < viewport.width * 0.76))
          continue;
        regions.set(bounds.map(Math.round).join(","), bounds);
    }
    if (regions.size !== 1) return;
    const [left, top, right, bottom] = [...regions.values()][0];
    const scale = Math.min(3, 640 / Math.max(right - left, bottom - top));
    const picture = canvas.createCanvas(Math.ceil((right - left) * scale), Math.ceil((bottom - top) * scale));
    await page.render({
      canvas: picture as unknown as HTMLCanvasElement,
      viewport: page.getViewport({ scale }),
      transform: [1, 0, 0, 1, -left * scale, -top * scale],
      annotationMode: pdfjs.AnnotationMode.DISABLE,
      background: "#fff",
    }).promise;
    const { data } = picture.getContext("2d").getImageData(0, 0, picture.width, picture.height);
    if (!data.some((channel, index) => index % 4 !== 3 && channel < 245)) return;
    return picture.toBuffer("image/png");
  } finally {
    await task.destroy();
  }
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
  { updateMetadata = true, photo }: { updateMetadata?: boolean; photo?: Buffer } = {},
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
  const firstPage = pdf.addPage([...size]);
  let page = firstPage, y = 795;
  const portrait = photo ? await pdf.embedPng(photo) : undefined;
  const portraitSize = portrait?.scaleToFit(80, 106);
  const photoBottom = y - (portraitSize?.height ?? 0);
  if (portrait && portraitSize) firstPage.drawImage(portrait, {
    x: size[0] - margin - portraitSize.width,
    y: photoBottom,
    ...portraitSize,
  });
  const rightEdge = (top: number) => page === firstPage && portraitSize && top > photoBottom - 8
    ? size[0] - margin - portraitSize.width - 16 : size[0] - margin;
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
      page.drawLine({ start: { x: margin, y: y - 5 }, end: { x: rightEdge(y - 5), y: y - 5 }, thickness: 0.7, color: rule });
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
    const fits = (value: string) => font.widthOfTextAtSize(value, textSize) <= rightEdge(y + textSize) - x;
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
