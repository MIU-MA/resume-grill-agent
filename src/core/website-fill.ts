import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { applicationFormContext } from "./application-forms.js";
import { FormRuns } from "./form-runs.js";
import type { Workspace } from "./workspace.js";
import type { FormField } from "../domain/form-fields.js";

export type WebsiteField = {
  field: FormField;
  read(): Promise<string | undefined>;
  fill(value: string): Promise<void>;
  attach(file: { name: string; mimeType: string; buffer: Buffer }): Promise<void>;
};

export type WebsitePage = {
  url(): string;
  inspect(): Promise<WebsiteField[]>;
  followApplicationLink(): Promise<boolean>;
};

const resumeMimeTypes: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
  ".md": "text/markdown",
};

/** Runs only on explicit request from the native card. The page API has no submit operation. */
export class WebsiteFill {
  private busy = false;

  constructor(
    private workspace: Workspace,
    private open: (jobId: string, url: string) => Promise<WebsitePage>,
  ) {}

  async fill(resumeId: string, jobId: string, signal: AbortSignal) {
    if (this.busy) throw new Error("正在填写另一份申请，请稍后再试。");
    this.busy = true;
    try {
      signal.throwIfAborted();
      const context = await applicationFormContext(this.workspace, resumeId, jobId);
      const runs = new FormRuns(this.workspace);
      const run = await runs.start(resumeId, jobId);
      const page = await this.open(jobId, context.url);
      const sameOrigin = () => URL.parse(page.url())?.origin === run.origin;
      const redirectNotice = () => {
        const hostname = URL.parse(page.url())?.hostname;
        return `申请页已跳转${hostname ? `到 ${hostname}` : ""}。如确认是该公司的申请系统，请把实际申请页链接保存为岗位来源后再试。`;
      };
      if (!sameOrigin()) return redirectNotice();
      let fields = await page.inspect();
      signal.throwIfAborted();
      if (!sameOrigin()) return redirectNotice();
      if (!fields.length && await page.followApplicationLink()) {
        if (!sameOrigin()) return redirectNotice();
        fields = await page.inspect();
      }
      if (!sameOrigin()) return redirectNotice();
      if (!fields.length)
        return "招聘页面已打开。请在专用窗口进入具体申请表，遇到登录或验证先处理，再回这里点「官网代填」。";

      const target = page.url();
      const checkPage = () => {
        signal.throwIfAborted();
        if (page.url() !== target) throw new Error("申请页面已切换，请回到申请表后再试。");
      };
      const plan = await runs.plan(run.id, target, fields.map((item) => item.field));
      const byId = new Map(fields.map((item) => [item.field.uid, item]));
      for (const action of plan.actions.filter((item) => item.write)) {
        checkPage();
        await byId.get(action.uid)!.fill(action.value).catch(() => {});
      }
      const upload = plan.uploads[0];
      if (upload?.write) {
        const buffer = await readFile(upload.path);
        if (createHash("sha256").update(buffer).digest("hex") !== run.attachmentHash)
          throw new Error("附件已变更，请重新打开任务。");
        checkPage();
        await byId.get(upload.uid)!.attach({
          name: upload.name,
          mimeType: resumeMimeTypes[context.attachment.extension.toLowerCase()] ?? "application/octet-stream",
          buffer,
        }).catch(() => {});
      }
      checkPage();
      const values: Array<{ uid: string; value: string }> = [];
      for (const action of plan.actions) {
        const value = await byId.get(action.uid)!.read();
        if (value !== undefined) values.push({ uid: action.uid, value });
      }
      const name = upload ? await byId.get(upload.uid)!.read() : undefined;
      checkPage();
      await runs.verify(run.id, target, values, name);
      return "请在官网核对填入的资料和附件，补完必填项后提交。";
    } finally {
      this.busy = false;
    }
  }
}
