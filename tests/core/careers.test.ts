import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../../src/infrastructure/sqlite-store.js";
import { Workspace } from "../../src/core/workspace.js";
import { Careers } from "../../src/core/careers.js";
test("官网列表每次实时读取，JD 更新独立保存，不用邮箱或简历才能查看", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "career-live-test-")),
    store = new Store(home),
    workspace = new Workspace(store);
  t.after(async () => {
    store.close();
    await rm(home, { recursive: true, force: true });
  });
  let calls = 0;
  const page = () => ({
    url: "https://example.com/jobs/1",
    title: "AI应用工程师",
    role: "AI应用工程师",
    company: "示例公司",
    emails: [],
    recommendedEmail: "",
    notes: [],
    jobDescription: calls === 1 ? "负责应用开发。" : "负责应用开发与测试。",
  });
  const careers = new Careers(
    workspace,
    async () => {
      calls++;
      return { links: [], pagesRead: 1, notes: [], pages: [page()] };
    },
    async () => page(),
  );
  await careers.scan("https://example.com/jobs");
  await careers.scan("https://example.com/jobs");
  assert.equal(calls, 2);
  assert.equal(store.list("career-scan").length, 2);
  assert.equal(store.list("job").length, 2);
  const current = await careers.read("https://example.com/jobs/1");
  assert.match(current.jd, /测试/);
  assert.equal(current.recipient, undefined);
  assert.equal(store.list("resume").length, 0);
  assert.equal(workspace.history().length, 0);
  const failed = await new Careers(workspace, async () => {
    throw new Error("公开接口不可用");
  }).scan("https://example.com/jobs");
  assert.equal(failed.error, "公开接口不可用");
  assert.equal(store.list("job").length, 2);
});
