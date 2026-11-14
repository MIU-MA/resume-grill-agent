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
    "当前会话没有可用的浏览器填写工具。请先加载招聘浏览器 MCP 配置并重新打开会话；侧栏网页预览不能代替浏览器操作。",
  );
}
