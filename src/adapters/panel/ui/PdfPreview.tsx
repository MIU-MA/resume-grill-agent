import { useEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";
export function PdfPreview({ id }: { id: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0),
    [error, setError] = useState("");
  useEffect(() => {
    const element = host.current!;
    const observer = new ResizeObserver(() =>
      setWidth(Math.floor(element.clientWidth)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!width) return;
    const element = host.current!;
    let cancelled = false;
    let task: ReturnType<typeof getDocument> | undefined;
    element.replaceChildren();
    delete element.dataset.ready;
    setError("");
    void (async () => {
      const response = await fetch(`/api/pdf/${id}`);
      if (!response.ok) throw new Error("PDF 无法读取，请刷新或重新生成。");
      task = getDocument({
        data: new Uint8Array(await response.arrayBuffer()),
      });
      const pdf = await task.promise;
      for (
        let pageNumber = 1;
        pageNumber <= pdf.numPages && !cancelled;
        pageNumber++
      ) {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const scale = Math.max(
          0.2,
          (width - 2) / page.getViewport({ scale: 1 }).width,
        );
        const viewport = page.getViewport({
          scale: scale * Math.min(devicePixelRatio || 1, 2),
        });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = "100%";
        canvas.style.height = "auto";
        canvas.setAttribute("aria-label", `简历第 ${pageNumber} 页`);
        element.append(canvas);
        await page.render({ canvas, viewport }).promise;
      }
      if (!cancelled) element.dataset.ready = "true";
    })().catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : "预览失败。");
    });
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [id, width]);
  return (
    <>
      <div className="pdf-pages" ref={host} />
      {error && <p role="alert">{error}</p>}
    </>
  );
}
