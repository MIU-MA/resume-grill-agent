import assert from "node:assert/strict";
import { test } from "node:test";
import { resumeSearchDirection } from "../../src/domain/resume-search-direction.js";

test("简历方向优先取求职意向，可从文件名和经历提取，不限于开发岗", () => {
  assert.equal(
    resumeSearchDirection("求职意向：审计助理 | 邮箱：abc@example.com", "前端开发实习生.pdf"),
    "审计助理",
  );
  assert.equal(resumeSearchDirection("教育经历", "示例-AI应用开发实习生简历(2).pdf"), "AI应用开发实习生");
  assert.equal(resumeSearchDirection("负责交互设计和可用性测试", "简历.pdf", ["用户研究员"]), "用户研究员");
  assert.equal(resumeSearchDirection("参与数据分析\n负责数据分析报表", "简历.pdf"), "数据分析");
});

test("无方向或证据打平时要求输入，不发送联系方式和个人概况", () => {
  assert.equal(resumeSearchDirection("求职意向\n张三\n电话：12345678901", "简历.pdf"), undefined);
  assert.equal(resumeSearchDirection("前端开发\n后端开发", "简历.pdf"), undefined);
  assert.equal(resumeSearchDirection("求职意向：abc@example.com", "简历.pdf"), undefined);
});
