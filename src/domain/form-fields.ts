import { z } from "zod";
import type { ResumeProfileData } from "./resume-profile.js";
export const formFieldSchema = z
  .object({
    uid: z.string().min(1).max(100),
    label: z.string().min(1).max(200),
    type: z.enum(["text", "textarea", "select", "file", "checkbox", "radio"]),
    required: z.boolean().default(false),
    value: z.string().max(10000).default(""),
    options: z.array(z.string().max(300)).max(300).default([]),
    manual: z.boolean().optional(),
    group: z.enum(["education", "work", "project"]).optional(),
    index: z.number().int().min(0).max(29).optional(),
  })
  .strict();
export type FormField = z.infer<typeof formFieldSchema>;
export function normalizeFormValue(value: string, path: string) {
  let result = value.normalize("NFKC").trim();
  if (path === "contact.phone")
    result = result.replace(/[ ()-]/g, "").replace(/^\+86(?=1\d{10}$)/, "");
  return result.replace(/\s+/g, "");
}
export function matchFormField(
  field: FormField,
  profile: ResumeProfileData,
): { value?: string; path?: string; reason?: string } {
  const label = field.label.replace(/[\s*：:]/g, "").toLowerCase();
  if (
    ["checkbox", "radio"].includes(field.type) ||
    /同意|声明|密码|验证码|证件|性别|薪|出生|婚姻|captcha|password|consent|salary/.test(
      label,
    )
  )
    return { reason: "由用户处理，不自动填写或勾选" };
  if (field.type === "file")
    return /简历|résumé|resume|cv/.test(label)
      ? { path: "attachment" }
      : { reason: "不是明确的简历上传入口" };
  if (/期望|希望|意向|desired|expected.*salary/.test(label))
    return { reason: "求职偏好需要用户提供" };
  const contact = /^(姓名|名字|中文姓名|真实姓名|full.?name|name)$/.test(label)
    ? "name"
    : /邮箱|e.?mail/.test(label)
      ? "email"
      : /手机|电话|mobile|phone/.test(label) &&
          !/区号|国家码|country.?code/.test(label)
        ? "phone"
        : /现居|当前.*城市|所在城市|current.?city/.test(label)
          ? "city"
          : /github/.test(label)
            ? "github"
            : /作品集|portfolio/.test(label)
              ? "portfolio"
              : undefined;
  if (contact) {
    const value = profile.contact[contact];
    return value
      ? { value, path: `contact.${contact}` }
      : { reason: "已确认资料中没有此信息" };
  }
  const kind =
    field.group ??
    (/学校|院校|学历|学位|专业|入学|毕业|education|school|university|major|degree/.test(
      label,
    )
      ? "education"
      : /公司|单位|职位|入职|离职|employment/.test(label)
        ? "work"
        : /项目|project/.test(label)
          ? "project"
          : undefined);
  if (!kind) return { reason: "未识别字段含义" };
  const entries = profile.experiences
    .map((entry, index) => ({ entry, index }))
    .filter((item) => item.entry.kind === kind);
  const selected =
    field.index !== undefined
      ? entries[field.index]
      : entries.length === 1
        ? entries[0]
        : undefined;
  if (!selected)
    return {
      reason:
        entries.length > 1
          ? "有多段经历，需要识别表单分组和段落序号"
          : "没有对应经历，不能用其他类型经历代替",
    };
  const key =
    /学校|院校|公司|单位|项目名|school|university|employer|organization/.test(
      label,
    )
      ? "organization"
      : /学历|学位|degree/.test(label)
        ? "degree"
        : /专业|职位|角色|major|title|role/.test(label)
          ? "title"
          : /预计.*毕业/.test(label)
            ? "expectedEnd"
            : /开始|入学|入职|start/.test(label)
              ? "start"
              : /结束|毕业|离职|end/.test(label)
                ? kind === "education" && selected.entry.expectedEnd
                  ? "expectedEnd"
                  : "end"
                : /描述|内容|职责|项目经历|项目经验|description/.test(label)
                  ? "description"
                  : undefined;
  if (!key) return { reason: "需要进一步识别字段含义" };
  const value = selected.entry[key];
  return value
    ? { value, path: `experiences[${selected.index}].${key}` }
    : { reason: "该段经历中缺少此信息" };
}
