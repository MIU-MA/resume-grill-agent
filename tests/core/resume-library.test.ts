import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { Workspace } from "../../src/core/workspace.js";
import { Store } from "../../src/infrastructure/sqlite-store.js";
import { humanAction } from "../../src/adapters/dsh/actions.js";
import { operations } from "../../src/core/operations.js";
import { Tasks } from "../../src/core/tasks.js";

async function setup(t: any) {
  const home = await mkdtemp(join(tmpdir(), "resume-library-test-"));
  const store = new Store(home),
    workspace = new Workspace(store);
  t.after(async () => {
    store.close();
    if (
      dirname(home) === tmpdir() &&
      basename(home).startsWith("resume-library-test-")
    )
      await rm(home, { recursive: true, force: true, maxRetries: 5 });
  });
  return { home, store, workspace };
}

test("简历可新建、改名、复制、编辑副本，原件和版本来源不被覆盖", async (t) => {
  const { workspace, store } = await setup(t);
  const created = await humanAction(workspace, {
    action: "create-resume",
    name: "我的简历",
    text: "演示用户\n项目经历\n- 参与 Go API 开发与测试。",
  });
  if (created.kind !== "resume") throw new Error("未显示新建简历");
  const original = created.resume,
    bytes = await readFile(original.original);
  const renamed = await humanAction(workspace, {
    action: "rename-resume",
    id: original.id,
    name: "  Go 开发简历  ",
  });
  if (renamed.kind !== "workspace") throw new Error("未更新简历库");
  assert.equal(renamed.resumes[0].name, "Go 开发简历");
  assert.equal(renamed.resumes[0].id, original.id);
  assert.deepEqual(await readFile(original.original), bytes);
  const copied = await humanAction(workspace, {
    action: "duplicate-resume",
    id: original.id,
  });
  if (copied.kind !== "resume") throw new Error("未打开副本");
  assert.notEqual(copied.resume.id, original.id);
  assert.equal(copied.resume.parentId, original.id);
  assert.equal(copied.resume.text, original.text);
  await workspace.saveEditedResume(
    copied.resume.id,
    original.text + "\n参与接口联调。",
  );
  assert.equal(store.get<any>("resume", original.id).text, original.text);
  assert.equal(workspace.listResumes().length, 3);
  await assert.rejects(
    humanAction(workspace, {
      action: "rename-resume",
      id: original.id,
      name: "  ",
    }),
  );
  await assert.rejects(
    humanAction(workspace, {
      action: "create-resume",
      name: "空简历",
      text: "  ",
    }),
  );
});

test("回收站隔离简历选择和 AI 上下文，恢复后可用，已有版本及投递附件始终保留", async (t) => {
  const { workspace, store } = await setup(t);
  const original = await workspace.createResume(
    "原件",
    "演示用户\n项目经历\n- 参与 Go API 开发与测试。",
  );
  const job = workspace.addJob({
    company: "示例",
    role: "Go",
    jd: "Go API 开发与测试",
    sourceUrl: "https://example.com/job",
    recipient: "hr@example.com",
  });
  const version = await workspace.saveEditedResume(
    original.id,
    original.text,
    job.id,
  );
  const mail = await workspace.prepare(
    job.id,
    version.id,
    "demo@example.com",
    "Go 开发",
    "您好，附件是我的简历。",
  );
  const snapshot = await readFile(mail.attachment);
  await humanAction(workspace, { action: "trash-resume", id: original.id });
  assert.equal(workspace.resume(version.id).parentId, original.id);
  await humanAction(workspace, { action: "trash-resume", id: version.id });
  const view = await humanAction(workspace, { action: "workspace" });
  if (view.kind !== "workspace") throw new Error("未读取简历库");
  assert.equal(view.resumes.length, 0);
  assert.equal(view.deletedResumes.length, 2);
  assert.throws(() => workspace.reviewContext(original.id, job.id), /回收站/);
  assert.throws(() => workspace.duplicateResume(original.id), /回收站/);
  await assert.rejects(
    workspace.saveEditedResume(original.id, "修改正文"),
    /回收站/,
  );
  const listed: any = operations(workspace)
    .find((op) => op.name === "list_workspace")!
    .run({});
  assert.equal(listed.resumes.length, 0);
  assert.deepEqual(await readFile(mail.attachment), snapshot);
  assert.equal((await workspace.execute(mail.id, true)).status, "simulated");
  assert.equal(workspace.history().length, 1);
  await humanAction(workspace, { action: "restore-resume", id: original.id });
  const reopened = new Store(store.home);
  try {
    assert.equal(
      new Workspace(reopened).resume(original.id).text,
      original.text,
    );
  } finally {
    reopened.close();
  }
  assert.deepEqual(
    await readFile(original.original),
    await readFile(original.pdf!),
  );
  assert.equal(
    workspace.reviewContext(original.id, job.id).resumeId,
    original.id,
  );
  const tasks = new Tasks(workspace),
    goal = tasks.saveGoal({ resumeId: original.id, directions: ["Go"] });
  const batch = await tasks.prepareBatch(goal.id, [
    { jobId: job.id, keepOriginal: true },
  ]);
  assert.equal(
    batch.items[0].status,
    "prepared",
    "批量准备不能复用回收站中的旧岗位版本",
  );
  const currentMail = workspace.preview(batch.items[0].applicationId!);
  assert.notEqual(currentMail.resumeId, version.id);
  assert.equal(workspace.resume(currentMail.resumeId).deletedAt, undefined);
});
