import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/infrastructure/sqlite-store.js";
import { Workspace } from "../../src/core/workspace.js";
import { ResumeProfiles } from "../../src/core/resume-profiles.js";
import { parseResumeProfile } from "../../src/domain/resume-profile.js";

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
