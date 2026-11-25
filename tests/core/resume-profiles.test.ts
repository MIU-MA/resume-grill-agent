import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/infrastructure/sqlite-store.js";
import { Workspace } from "../../src/core/workspace.js";
import { ResumeProfiles } from "../../src/core/resume-profiles.js";
import { parseResumeProfile } from "../../src/domain/resume-profile.js";
import { PDFDocument } from "pdf-lib";
import { renderPdf } from "../../src/infrastructure/documents.js";
import { formFieldSchema, matchFormField } from "../../src/domain/form-fields.js";
import { humanAction } from "../../src/adapters/dsh/actions.js";

test("本地解析保留原文，教育、工作、项目分开，缺失资料不猜测", () => {
  const p = parseResumeProfile(
    "张三\n(+86) 138-0000-0000 | demo@example.com\n本科生\n教育背景\n示例大学 | 软件工程 2024.09 - 至今\n预计2028年6月毕业。\n项目经历\n求职工作台 | 个人开发 2026.06 - 至今\n负责页面与接口。\n第二个项目 | 前端 2025.01 - 2025.10\n开发管理后台。",
  );
  assert.equal(p.contact.name, "张三");
  assert.equal(p.contact.phone, "13800000000");
  assert.equal(p.contact.city, "");
  assert.deepEqual(
    p.experiences.map((e) => e.kind),
    ["education", "project", "project"],
  );
  assert.equal(p.experiences[0].degree, "本科");
  assert.equal(p.experiences[0].expectedEnd, "2028-06");
  assert.equal(p.experiences[1].organization, "求职工作台");
  assert.match(p.experiences[1].evidence, /负责页面/);
  assert.equal(
    parseResumeProfile("张三\na@example.com b@example.com").contact.email,
    "",
  );
});

test("已核对资料可跨岗位复用，修改保存为新快照，新简历版本必须重核", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "resume-profile-test-")),
    store = new Store(home),
    ws = new Workspace(store);
  t.after(async () => {
    store.close();
    await rm(home, { recursive: true, force: true });
  });
  const resume = await ws.createResume(
    "原简历",
    "姓名：演示用户\n邮箱：demo@example.com\n项目经历\n工具 | 开发 2026.01 - 至今\n开发接口。",
  );
  const profiles = new ResumeProfiles(ws),
    draft = profiles.draft(resume.id);
  assert.equal(profiles.draft(resume.id).id, draft.id);
  assert.throws(() => profiles.confirmed(resume.id), /确认/);
  const confirmed = profiles.confirm(draft.id, {
    ...draft.data,
    contact: { ...draft.data.contact, city: "杭州" },
  });
  assert.notEqual(confirmed.id, draft.id);
  assert.equal(profiles.confirmed(resume.id).data.contact.city, "杭州");
  assert.equal(profiles.draft(resume.id).id, confirmed.id);
  assert.throws(() => profiles.confirm(draft.id, draft.data), /变化/);
  const copy = await ws.saveEditedResume(resume.id, resume.text + "\n补充说明");
  assert.equal(profiles.current(copy.id), undefined);
  assert.throws(() => profiles.confirmed(copy.id), /先解析/);
  const reopened = new Store(home);
  try {
    assert.equal(
      new ResumeProfiles(new Workspace(reopened)).confirmed(resume.id).id,
      confirmed.id,
    );
  } finally {
    reopened.close();
  }
});

test("三页 PDF 导入和重新解析都收录续页、竞赛与校园经历", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "resume-profile-pages-"));
  const store = new Store(home);
  const workspace = new Workspace(store);
  t.after(async () => {
    store.close();
    await rm(home, { recursive: true, force: true });
  });
  const pdf = await PDFDocument.create();
  const pages = [
    "林沐\n项目经历\n项目名称：求职工具\n负责整理岗位。",
    "补充岗位来源，保存原始链接。\n竞赛经历\n2025年 全国大学生数学建模竞赛 省级一等奖\n参赛角色：队长\n负责数据建模。",
    "校园经历\n学生会 | 宣传部干事\n2023.09 - 2024.06\n协助策划校园活动。\n- 青创志愿队 | 志愿者\n参与服务活动。",
  ];
  for (const text of pages) {
    const source = await PDFDocument.load(await renderPdf(text));
    const [page] = await pdf.copyPages(source, [0]);
    pdf.addPage(page);
  }
  const file = join(home, "三页简历.pdf");
  await writeFile(file, await pdf.save());
  const resume = await workspace.importResume(file);
  assert.equal(resume.sourcePages, 3);
  const profile = new ResumeProfiles(workspace);
  const draft = profile.draft(resume.id);
  assert.equal(draft.sourcePages, 3);
  const [project, competition, campus, volunteer] = draft.data.experiences;
  assert.deepEqual(draft.data.experiences.map(({ kind }) => kind), ["project", "competition", "campus", "campus"]);
  assert.match(project.description, /保存原始链接/);
  assert.equal(competition.organization, "全国大学生数学建模竞赛");
  assert.equal(competition.award, "省级一等奖");
  assert.equal(competition.title, "队长");
  assert.equal(campus.title, "宣传部干事");
  assert.equal(campus.start, "2023-09");
  assert.equal(volunteer.organization, "青创志愿队");
  assert.equal(matchFormField(formFieldSchema.parse({
    uid: "award", label: "获奖名次", group: "competition", type: "text",
  }), draft.data).value, "省级一等奖");
  assert.equal(matchFormField(formFieldSchema.parse({
    uid: "company", label: "公司", group: "work", type: "text",
  }), draft.data).value, undefined);

  const legacy = { ...resume, text: pages[0], sourcePages: undefined };
  store.put("resume", legacy);
  const old = profile.draft(legacy.id);
  const saved = profile.confirm(old.id, {
    ...old.data, contact: { ...old.data.contact, city: "杭州" },
  });
  const view = await humanAction(workspace, { action: "profile", resumeId: legacy.id, reparse: true });
  assert.equal(view.kind, "profile");
  assert.equal(view.profile.sourcePages, 3);
  assert.equal(profile.confirmed(legacy.id).id, saved.id);
  assert.equal(view.profile.data.contact.city, "杭州");
  assert.match(view.profile.data.experiences[0].description, /保存原始链接/);
  assert.ok(view.profile.data.experiences.some(({ award }) => award === "省级一等奖"));
  const confirmed = profile.confirm(view.profile.id, view.profile.data);
  assert.equal(profile.confirmed(legacy.id).id, confirmed.id);
});
