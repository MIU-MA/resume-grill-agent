import { test } from "node:test";
import assert from "node:assert/strict";
import { importStagedResume } from "../../src/adapters/dsh/resume-upload.js";
test("简历上传只使用当前会话的凭据，校验附件后导入本机路径", async () => {
  let imports = 0;
  const ref = { name: "简历.txt", bytes: 3, attachmentId: "sha256:test" };
  const agent = { id: "current" };
  const ctx = {
    fileUploads: {
      resolve: (owner: any, id: string) =>
        owner === agent && id === "valid"
          ? { type: "file", attachment: ref }
          : undefined,
    },
    attachments: {
      async *readFileStream() {
        yield new Uint8Array(3);
      },
      fileHostPath: () => "C:/test/简历.txt",
    },
  };
  const workspace: any = {
    importResume: (path: string) => {
      imports++;
      return { path };
    },
  };
  assert.deepEqual(await importStagedResume(ctx, workspace, agent, "valid"), {
    path: "C:/test/简历.txt",
  });
  await assert.rejects(
    importStagedResume(ctx, workspace, { id: "other" }, "valid"),
    /当前会话/,
  );
  await assert.rejects(
    importStagedResume(ctx, workspace, agent, "missing"),
    /当前会话/,
  );
  ref.bytes = 4;
  await assert.rejects(
    importStagedResume(ctx, workspace, agent, "valid"),
    /不完整/,
  );
  ref.bytes = 11 * 1024 * 1024;
  await assert.rejects(
    importStagedResume(ctx, workspace, agent, "valid"),
    /10 MiB/,
  );
  assert.equal(imports, 1);
});
