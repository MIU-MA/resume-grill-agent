import assert from "node:assert/strict";
import { test } from "node:test";
import { bossSkillEvidence, checkBossRequirements, classifyBossRecruitment } from "../../src/domain/boss-recruitment.js";

test("只有明确的招聘类型信号才确认类型，实习的届别限制不改变岗位类型", () => {
  const classify = classifyBossRecruitment;
  assert.equal(classify("产品运营", "", "接受应届生，有实习经验优先").kind, "unknown");
  assert.equal(classify("产品运营", "", "校园招聘经验优先").kind, "unknown");
  assert.equal(classify("产品运营", "", "负责培训新员工并指导实习生\n每周工作 5 天").kind, "unknown");
  assert.equal(classify("产品运营", "", "职位类型：全职\n接受应届生").kind, "fulltime");
  assert.equal(classify("产品运营", "", "面向 2027 届毕业生").kind, "campus");
  assert.equal(classify("产品运营", "", "可接受 2027 届应届生，相关经验优先").kind, "unknown");
  assert.equal(classify("运营实习生", "", "面向 2027 届毕业生，可转正").kind, "internship");
  assert.equal(classify("运营实习生", "", "工作性质：全职实习").kind, "internship");
  const conflict = classify("运营实习生", "", "岗位类型：全职");
  assert.equal(conflict.kind, "unknown");
  assert.equal(conflict.conflict, true);
  assert.deepEqual(conflict.evidence.map(({ source }) => source), ["title", "jd"]);
  assert.equal(classify("产品运营", "岗位类型：全职").kind, "fulltime");
  assert.equal(classify("产品运营", "岗位类型：全职", "负责活动策划").kind, "unknown");
});

test("JD 硬条件区分匹配、明确不符和证据不足", () => {
  const compact = (items: ReturnType<typeof checkBossRequirements>) =>
    items.map(({ label, status }) => [label, status]);
  assert.deepEqual(compact(checkBossRequirements(
    "本科及以上，有数据项目经验优先\n限 2026、2027 届毕业生\n每周至少到岗 4 天，实习不少于 3 个月",
    "2028 届本科生\n可每周到岗 4 天",
    [],
    "internship",
  )), [["学历", "matched"], ["毕业届别", "mismatch"], ["每周到岗", "matched"], ["实习时长", "unknown"]]);
  assert.deepEqual(compact(checkBossRequirements(
    "要求 3–5 年相关工作经验\n工作地点：杭州，团队在上海",
    "工作年限：2 年\n曾在上海实习半年",
    ["上海"],
    "fulltime",
  )), [["工作年限", "mismatch"], ["工作地点", "mismatch"]]);
  assert.deepEqual(compact(checkBossRequirements(
    "3 年工作经验优先\n工作地点：杭州、上海",
    "曾在上海实习半年",
    ["上海"],
    "fulltime",
  )), [["工作地点", "matched"]]);
  assert.deepEqual(compact(checkBossRequirements(
    "面向 2027 届毕业生\n实习时长 3–6 个月",
    "预计 2027 年 6 月毕业\n可实习 3 个月",
    [],
    "internship",
  )), [["毕业届别", "matched"], ["实习时长", "matched"]]);
  assert.deepEqual(compact(checkBossRequirements(
    "3 年工作经验", "2 年以上工作经验", [], "fulltime",
  )), [["工作年限", "unknown"]]);
});

test("技能依据保留 JD 和简历原文，并合并 Go 别名", () => {
  assert.deepEqual(bossSkillEvidence(
    "使用 Golang 和 PostgreSQL 开发；使用 Go 维护服务。",
    "负责 Go 服务开发。\n暂无 PostgreSQL 经验。",
  ), [{ skill: "Go", quote: "使用 Golang 和 PostgreSQL 开发", resumeQuote: "负责 Go 服务开发。" }]);
});
