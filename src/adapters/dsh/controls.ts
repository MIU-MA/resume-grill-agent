/** DSH 0.2.2 keeps main-view ownership on catalog entries, older hosts expose current. */
export function selectedSessionId(state: any): string | undefined {
  return (
    state.current ??
    (Object.values(state.byId ?? {}) as any[]).find(
      (item) => (item.retainedBy?.mainView ?? 0) > 0,
    )?.id
  );
}
export function nativeControls(ctx: any, sessionId: string, surface?: string) {
  return {
    act: async (input: unknown) => {
      const response = await ctx.remote.commands.execute(
        sessionId,
        `/resume-grill ${JSON.stringify({ ...(input as object), ...(surface ? { surface } : {}) })}`,
        [],
      );
      if (!response.ok) throw new Error(response.error.message);
      const result = response.value?.result;
      if (!result || result.kind !== "success")
        throw new Error(result?.text ?? "未收到操作结果。");
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
