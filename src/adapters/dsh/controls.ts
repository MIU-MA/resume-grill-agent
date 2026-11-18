/** DSH 0.2.2 keeps main-view ownership on catalog entries, older hosts expose current. */
export function selectedSessionId(state: any): string | undefined {
  return (
    state.current ??
    (Object.values(state.byId ?? {}) as any[]).find(
      (item) => (item.retainedBy?.mainView ?? 0) > 0,
    )?.id
  );
}
export type ReadResumeImage = (
  image: { path: string; size: number; sha256: string },
  signal: AbortSignal,
) => Promise<string>;

export function nativeControls(ctx: any, sessionId: string, surface?: string) {
  const readResumeImage: ReadResumeImage = async ({ path, size, sha256 }, signal) => {
    if (!Number.isInteger(size) || size <= 0 || size > 5 * 1024 * 1024)
      throw new Error("简历图片大小无效。");
    const files = ctx.remote.workspaceFiles;
    if (!files?.readBytes) throw new Error("当前 DSH 不支持文件预览。");
    const bytes = new Uint8Array(size);
    let version: string | undefined;
    for (let offset = 0; offset < size;) {
      signal.throwIfAborted();
      const length = Math.min(1024 * 1024, size - offset);
      const result = await files.readBytes(sessionId, path, {
        range: { offset, length },
      }, signal);
      if (!result.ok) throw new Error("本机简历图片无法读取，请重新准备投递。");
      const { data, eof } = result.value;
      if (data.length !== length || (offset + length === size) !== eof ||
          (version !== undefined && result.value.version !== version))
        throw new Error("投递简历图片已变化，请重新准备投递。");
      version = result.value.version;
      bytes.set(data, offset);
      offset += length;
    }
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    if (Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("") !== sha256)
      throw new Error("投递简历图片内容已变化。");
    signal.throwIfAborted();
    return URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
  };
  return {
    readResumeImage,
    act: async (input: unknown) => {
      const response = await ctx.remote.commands.execute(
        sessionId,
        `/resume-grill ${JSON.stringify({ ...(input as object), ...(surface ? { surface } : {}) })}`,
        [],
      );
      if (!response.ok) throw new Error(response.error.message);
      const result = response.value?.result;
      if (!result || result.kind !== "success") {
        const action = (input as { action?: string })?.action;
        const error = result?.text ?? "未收到操作结果。";
        if (typeof action === "string" && (action === "boss" || action.startsWith("boss-")) &&
            /invalid_union|Invalid discriminator/i.test(error))
          throw new Error("BOSS 界面与后端版本可能不同。请完全退出 DSH 后重新打开，再核对投递记录。");
        throw new Error(error);
      }
      return JSON.parse(result.text);
    },
    ask: async (text: string, browser = false) => {
      if (browser) ctx.layout.selectPanel(null);
      // A main panel unmounts the chat view. Retain and open its session while
      // submitting, rather than borrowing a scope that may be retiring.
      return ctx.sessions.using(sessionId, { source: "gateway" }, async () => {
        const conversation = ctx.sessions.scope(sessionId)?.get("conversation");
        if (!conversation)
          throw new Error("当前会话无法提交，请先打开一个会话。");
        return conversation.send(text);
      });
    },
  };
}
