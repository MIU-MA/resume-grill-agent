import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readPdfHeaderPhoto, readResume, renderPdf } from "../../src/infrastructure/documents.js";
test("实际渲染的每一个中文、英文字母、数字都存在可见字形", async () => {
  const canvasModule = await import("@napi-rs/canvas");
  Object.assign(globalThis, {
    DOMMatrix: canvasModule.DOMMatrix,
    ImageData: canvasModule.ImageData,
    Path2D: canvasModule.Path2D,
  });
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const text = "林沐ABCdef0123订单优化";
  const bytes = await renderPdf(text);
  const task = getDocument({
    data: bytes,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: true,
  });
  try {
    const pdf = await task.promise,
      page = await pdf.getPage(1),
      viewport = page.getViewport({ scale: 2 });
    const canvas = canvasModule.createCanvas(
      Math.ceil(viewport.width),
      Math.ceil(viewport.height),
    );
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      viewport,
    }).promise;
    const font = fontkit.create(
      await readFile(
        new URL("../../assets/NotoSansSC-Regular.ttf", import.meta.url),
      ),
    );
    let x = 46;
    for (const character of text) {
      const width =
        (font.layout(character).glyphs[0].advanceWidth / font.unitsPerEm) *
        10.5;
      const pixels = canvas
        .getContext("2d")
        .getImageData(
          Math.floor(x * 2),
          Math.floor((841.89 - 795 - 10.5) * 2),
          Math.ceil(width * 2),
          Math.ceil(17 * 2),
        ).data;
      let ink = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (
          pixels[i + 3] > 0 &&
          pixels[i] < 180 &&
          pixels[i + 1] < 180 &&
          pixels[i + 2] < 180
        )
          ink++;
      assert.ok(ink > 3, `${character} 缺少可见字形`);
      x += width;
    }
  } finally {
    await task.destroy();
  }
});

test("岗位 PDF 保留可选文字，联系图标和特殊符号可降级", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "resume-pdf-symbols-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const path = join(home, "岗位版.pdf");
  await writeFile(path, await renderPdf("林沐\n📱 13800000000\n📧 lin@example.com\n📍 上海\n项目经历\n▪ 负责 Go API 开发 🧪"));
  const { text } = await readResume(path);
  for (const phrase of ["林沐", "13800000000", "lin@example.com", "上海", "项目经历", "Go API"])
    assert.ok(text.includes(phrase), phrase);
});

test("OCR 只接收栅格化扫描页，原 PDF 字节仍可复用", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "resume-pdf-ocr-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const { createCanvas } = await import("@napi-rs/canvas");
  const canvas = createCanvas(100, 50);
  const context = canvas.getContext("2d");
  context.fillText("Resume", 8, 18);
  const pdf = await PDFDocument.create();
  const image = await pdf.embedPng(canvas.toBuffer("image/png"));
  pdf.addPage([300, 400]).drawImage(image, { x: 20, y: 300, width: 200, height: 100 });
  pdf.addPage([300, 400]);
  const bytes = Buffer.from(await pdf.save());
  const path = join(home, "扫描版.pdf");
  await writeFile(path, bytes);
  assert.equal(await readPdfHeaderPhoto(path), undefined, "扫描页不能当成证件照");
  let calls = 0;
  const result = await readResume(path, { ocr: async (png) => {
    calls++;
    assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
    return "扫描简历正文";
  } });
  assert.equal(calls, 1);
  assert.equal(result.text.trim(), "扫描简历正文");
  assert.deepEqual(result.bytes, bytes);
});

test("有两个符合页首照片尺寸的图片时不任意挑一张", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "resume-pdf-photos-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const { createCanvas } = await import("@napi-rs/canvas");
  const picture = createCanvas(144, 192);
  const context = picture.getContext("2d");
  context.fillStyle = "#a93434";
  context.fillRect(0, 0, picture.width, picture.height);
  const pdf = await PDFDocument.create();
  const image = await pdf.embedPng(picture.toBuffer("image/png"));
  const page = pdf.addPage([595, 842]);
  page.drawImage(image, { x: 50, y: 700, width: 72, height: 96 });
  page.drawImage(image, { x: 470, y: 700, width: 72, height: 96 });
  const path = join(home, "两张图片.pdf");
  await writeFile(path, await pdf.save());
  assert.equal(await readPdfHeaderPhoto(path), undefined);
});
