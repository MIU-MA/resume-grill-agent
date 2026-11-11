import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import fontkit from "@pdf-lib/fontkit";
import { renderPdf } from "../../src/infrastructure/documents.js";
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
