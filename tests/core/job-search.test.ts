import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesJob } from "../../src/domain/job-search.js";
test("AI 应用开发能匹配岗位常用标题，不扩大到算法及其他职业", () => {
  for (const title of [
    "AI应用工程师",
    "大模型应用开发工程师",
    "LLM Engineer",
    "Applied AI Engineer",
  ])
    assert.equal(matchesJob(title, "", ["AI 应用开发"]), true, title);
  for (const title of ["算法工程师", "数据分析师", "前端开发工程师"])
    assert.equal(
      matchesJob(title, "使用AI应用开发工具", ["AI 应用开发"]),
      false,
      title,
    );
});
