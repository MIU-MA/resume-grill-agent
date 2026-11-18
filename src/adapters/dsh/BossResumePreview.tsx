import { useEffect, useState } from "react";
import type { ReadResumeImage } from "./controls.js";

type PreviewImage = { path: string; sha256: string; size: number };

function ResumePage({
  image,
  index,
  readImage,
}: {
  image: PreviewImage;
  index: number;
  readImage: ReadResumeImage;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    void readImage(image, controller.signal)
      .then((next) => {
        if (controller.signal.aborted) {
          URL.revokeObjectURL(next);
          return;
        }
        objectUrl = next;
        setUrl(next);
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : "读取失败。");
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [image.path, image.sha256, image.size, readImage]);
  if (error)
    return <p role="alert">第 {index + 1} 页无法预览：{error}</p>;
  if (!url) return <p role="status">正在读取第 {index + 1} 页…</p>;
  return <img src={url} alt={`投递简历第 ${index + 1} 页`} onError={() => setError("图片无法显示。")} />;
}

export function BossResumePreview({
  images,
  readImage,
}: {
  images: PreviewImage[];
  readImage?: ReadResumeImage;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rg-boss-preview">
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        {expanded ? "收起简历" : "查看简历"}
      </button>
      {expanded && (
        <div className="rg-boss-preview-pages">
          {!readImage || !images.length ? (
            <p role="alert">
              {readImage ? "这条任务没有可预览的简历图片。" : "当前会话无法读取简历图片。"}
            </p>
          ) : images.map((image, index) => (
            <ResumePage key={`${index}:${image.path}:${image.sha256}`} image={image} index={index} readImage={readImage} />
          ))}
        </div>
      )}
    </div>
  );
}
