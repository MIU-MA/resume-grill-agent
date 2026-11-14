import { Workspace } from "../../core/workspace.js";

/** Consume only a receipt staged for this session; bytes never enter chat commands. */
export async function importStagedResume(
  ctx: any,
  workspace: Workspace,
  agent: any,
  receiptId: string,
) {
  const staged = await ctx.fileUploads.resolve(agent, receiptId);
  if (staged?.type !== "file" || !staged.attachment)
    throw new Error("文件不属于当前会话，请重新选择简历。");
  const ref = staged.attachment;
  if (
    !/\.(pdf|docx|txt|md)$/i.test(ref.name) ||
    ref.bytes <= 0 ||
    ref.bytes > 10 * 1024 * 1024
  )
    throw new Error("请选择 10 MiB 以内的 PDF、DOCX 或文本简历。");
  let size = 0;
  for await (const chunk of ctx.attachments.readFileStream(ref)) {
    size += chunk.byteLength;
    if (size > 10 * 1024 * 1024) throw new Error("简历超过 10 MiB。");
  }
  if (size !== ref.bytes) throw new Error("文件不完整，请重新上传。");
  const path = ctx.attachments.fileHostPath(ref);
  if (!path) throw new Error("当前附件存储不支持本机简历导入。");
  return workspace.importResume(path);
}
