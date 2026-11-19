import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { Job, Workspace } from "./workspace.js";
import { ResumeProfiles } from "./resume-profiles.js";
import { sourceUrlSchema } from "../infrastructure/careers/contracts.js";
import { requireCompanyWebsite } from "../domain/boss.js";

/** Supplies source facts to the host's browser tools; never submits a form. */
export async function applicationFormContext(
  workspace: Workspace,
  resumeId: string,
  jobId: string,
) {
  const resume = workspace.resume(resumeId),
    job = workspace.store.get<Job>("job", jobId);
  requireCompanyWebsite(job.sourceUrl);
  const url = sourceUrlSchema.parse(job.sourceUrl);
  const path = resume.pdf ?? resume.original,
    bytes = await readFile(path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (resume.pdf && (!resume.pdfHash || sha256 !== resume.pdfHash))
    throw new Error("简历附件已改变，请重新生成或上传后再填写。");
  const profile = new ResumeProfiles(workspace).confirmed(resumeId);
  const facts = Object.entries(profile.data.contact)
    .filter(([, value]) => value)
    .map(([field, value]) => ({
      field,
      value,
      evidence: profile.data.contactEvidence[field] ?? "",
      origin: "user-confirmed",
    }));
  return {
    resumeId,
    jobId,
    job: { company: job.company, role: job.role, jd: job.jd },
    url,
    profileId: profile.id,
    profile: profile.data,
    confirmedAt: profile.confirmedAt,
    facts,
    attachment: {
      path,
      name: resume.name,
      extension: extname(path),
      sha256,
      bytes: bytes.length,
    },
    policy: {
      submit: false,
      sendMail: false,
      instructions:
        "只在用户选定的招聘申请页填写。以 profile 中用户已确认的结构化资料为回填依据，不要每个官网重新解析整份简历。先读取真实页面与字段，把字段对应到 contact 或 experiences 的具体条目；网站自行解析附件仅作辅助，解析结束后按已确认资料检查和纠正，不能覆盖用户补充。缺资料先留空并说明，不推断性别、证件、地点意向、毕业日期、薪资等。下拉框按现有选项选择，教育/工作/项目逐组对应，不能把项目或社团冒充正式工作。页面提示社招/校招或资格不匹配时明确报告，不篡改毕业时间来绕过。登录、验证码或来源跳转不明确时停下交给用户。上传后必须核对页面显示的附件；填写后重新读取字段值，列出已核对、缺失、失败项。禁止最终提交、发送、勾选同意或签署声明。",
    },
  };
}
