const required = ["new_page", "take_snapshot", "fill_form", "upload_file"];
/** Do not mix capabilities from different browser connections. */
export function requireBrowserTools(names: string[]) {
  for (const name of names) {
    if (!name.endsWith("__take_snapshot")) continue;
    const prefix = name.slice(0, -"take_snapshot".length);
    const tools = required.map((suffix) => prefix + suffix);
    if (tools.every((tool) => names.includes(tool))) return tools;
  }
  throw new Error(
    "官网代填不可用：当前会话没有启用招聘浏览器 MCP。可打开招聘官网手动申请，或启用 MCP 后重新打开会话再试。BOSS 投递不受影响。",
  );
}
