import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { applicationFormContext } from "./application-forms.js";
import { FormRuns } from "./form-runs.js";
import type { Workspace } from "./workspace.js";
import type { FormField } from "../domain/form-fields.js";
import { requireCompanyWebsite } from "../domain/boss.js";
import { sourceUrlSchema } from "../infrastructure/careers/contracts.js";

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
  validateDestination(url: string): Promise<void>;
};

export type WebsiteFillResult = { notice: string; approvalId?: string };
const resumeMimeTypes: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
  ".md": "text/markdown",
};

/** Runs only on explicit request from the native card. The page API has no submit operation. */
export class WebsiteFill {
  private busy = false;
  private pending?: { id: string; target: string; resumeId: string; jobId: string; profileId: string; attachmentHash: string };

  constructor(
    private workspace: Workspace,
    private open: (jobId: string, url: string) => Promise<WebsitePage>,
  ) {}

  async fill(resumeId: string, jobId: string, signal: AbortSignal, approvalId?: string): Promise<WebsiteFillResult> {
    if (this.busy) throw new Error("正在填写另一份申请，请稍后再试。");
    this.busy = true;
    try {
      signal.throwIfAborted();
      const context = await applicationFormContext(this.workspace, resumeId, jobId);
      const runs = new FormRuns(this.workspace);
      const page = await this.open(jobId, context.url);
      const sourceOrigin = new URL(context.url).origin;
      const sameOrigin = (url: string) => URL.parse(url)?.origin === sourceOrigin;
      const redirect = async (url: string): Promise<WebsiteFillResult> => {
        requireCompanyWebsite(url);
        const target = sourceUrlSchema.parse(url);
        await page.validateDestination(target);
        if (page.url() !== target)
          return { notice: "申请页刚切换，请在目标页面停稳后再点「官网代填」。" };
        const id = randomUUID();
        this.pending = { id, target, resumeId, jobId, profileId: context.profileId, attachmentHash: context.attachment.sha256 };
        return { notice: `当前申请页位于 ${new URL(target).hostname}。确认它属于这个岗位后，再向该页面填写资料和附上简历。`, approvalId: id };
      };
      let target = page.url();
      let approvedTarget: string | undefined;
      if (approvalId) {
        const pending = this.pending;
        this.pending = undefined;
        if (pending?.id !== approvalId || target !== pending.target || pending.jobId !== jobId ||
            pending.resumeId !== resumeId || pending.profileId !== context.profileId || pending.attachmentHash !== context.attachment.sha256)
          return { notice: "申请页或简历资料已变化，请回到实际申请页重新点「官网代填」。" };
        await page.validateDestination(target);
        if (page.url() !== target) return { notice: "申请页已切换，请重新点「官网代填」。" };
        approvedTarget = target;
      } else if (!sameOrigin(target)) {
        return redirect(target);
      }
      let fields = await page.inspect();
      signal.throwIfAborted();
      if (page.url() !== target)
        return { notice: "申请页已切换，请在实际申请页重新点「官网代填」。" };
      if (!approvedTarget && !fields.length && await page.followApplicationLink()) {
        target = page.url();
        if (!sameOrigin(target)) return redirect(target);
        fields = await page.inspect();
      }
      if (!fields.length)
        return { notice: "招聘页面已打开。请在专用窗口进入具体申请表，遇到登录或验证先处理，再回这里点「官网代填」。" };

      const checkPage = () => {
        signal.throwIfAborted();
        if (page.url() !== target) throw new Error("申请页面已切换，请回到申请表后再试。");
      };
      checkPage();
      const run = await runs.start(resumeId, jobId, approvedTarget);
      const plan = await runs.plan(run.id, target, fields.map((item) => item.field), approvedTarget);
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
      await runs.verify(run.id, target, values, name, approvedTarget);
      return { notice: "请在官网核对填入的资料和附件，补完必填项后提交。" };
    } finally {
      this.busy = false;
    }
  }
}
