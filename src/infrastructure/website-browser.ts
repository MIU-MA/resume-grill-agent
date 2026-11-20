import { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import type { WebsiteField, WebsitePage } from "../core/website-fill.js";
import { requireCompanyWebsite } from "../domain/boss.js";
import { formFieldSchema } from "../domain/form-fields.js";
import { sourceUrlSchema } from "./careers/contracts.js";
import { resolvePublicHost } from "./careers/public-page.js";

const controls = "input:not([type=hidden]), textarea, select, [contenteditable=true][role=textbox], [role=combobox]";
const experienceSections = "fieldset, [role=group], section[aria-label], section[aria-labelledby]";
const verification = 'input[type=password]:visible, input[autocomplete="one-time-code"]:visible, iframe[src*="captcha" i]:visible';

/** Scoped to one application container in the main document. */
export function applicationPage(page: Page, validateHost: (hostname: string) => Promise<unknown> = resolvePublicHost): WebsitePage {
  return {
    url: () => page.url(),
    async validateDestination(url) {
      requireCompanyWebsite(url);
      await validateHost(new URL(sourceUrlSchema.parse(url)).hostname);
    },
    async followApplicationLink() {
      const current = page.url();
      const links = await page.getByRole("link", {
        name: /^(申请(?:该)?职位|立即申请|投递简历|立即投递|apply(?: now| for (?:this|the) (?:job|position))?)$/i,
      }).evaluateAll((nodes) => nodes.flatMap((node) =>
        node instanceof HTMLAnchorElement && node.hasAttribute("href") && !node.hasAttribute("download")
          ? [node.href]
          : [],
      ));
      const unique = [...new Set(links)];
      const target = unique.length === 1 ? URL.parse(unique[0]) : null;
      if (!target || target.origin !== new URL(current).origin ||
        !sourceUrlSchema.safeParse(target.href).success ||
        target.href === current || page.url() !== current)
        return false;
      await page.goto(target.href, { waitUntil: "domcontentloaded", timeout: 15000 });
      return true;
    },
    async inspect() {
      const url = page.url();
      const { origin, pathname, hash } = new URL(url);
      const applicationPath = /(?:^|[\/#?=&])(?:apply|application|jobapply)(?:$|[\/#?=&._-])/i.test(pathname + hash);
      if (await page.locator(verification).count()) return [];
      let forms = await page.locator("form:visible, [role=form]:visible:not(form)").elementHandles();
      if (!forms.length) forms = await page.locator("main:visible, [role=main]:visible:not(main)").elementHandles();
      if (forms.length > 12) return [];
      const matches: WebsiteField[][] = [];
      for (const form of forms) {
        const items = await form.$$(controls);
        if (items.length > 200) continue;
        const fields: WebsiteField[] = [];
        for (const [index, item] of items.entries()) {
          const snapshot = () => item.evaluate((node, expected) => {
            const { container } = expected;
            if (!(container instanceof HTMLElement) || !(node instanceof HTMLElement) || !node.isConnected || location.href !== expected.url ||
              !container.contains(node) || node.matches(":disabled, [aria-disabled=true]")) return;
            const native = node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement;
            const combo = node.getAttribute("role") === "combobox" && !(node instanceof HTMLSelectElement);
            const editable = node.matches("[contenteditable=true][role=textbox]");
            if (!native && !combo && !editable) return;
            if (container instanceof HTMLFormElement && native && node.form !== container) return;
            const owner = node.closest("form") ?? (native ? node.form : null);
            if (owner instanceof HTMLFormElement && (owner !== container ||
                new URL(owner.action).origin !== expected.origin ||
                [...owner.querySelectorAll("[formaction]")].some((button) =>
                new URL((button as HTMLButtonElement).formAction, location.href).origin !== expected.origin))) return;
            const type = combo ? "select" : node instanceof HTMLInputElement ? node.type :
              node instanceof HTMLSelectElement ? "select" : "textarea";
            if (type === "password" || node.getAttribute("autocomplete") === "one-time-code") return;
            const visible = (element: Element) => element.getClientRects().length > 0 &&
              getComputedStyle(element).visibility === "visible";
            const labels = Array.from(native ? node.labels ?? [] : []).filter(visible).map((label) => {
              const text = label.cloneNode(true) as HTMLElement;
              text.querySelectorAll("input, textarea, select, button").forEach((control) => control.remove());
              return text.textContent?.trim();
            }).filter(Boolean).join(" ");
            if (!visible(node) && (type !== "file" || !labels)) return;
            const accessibleName = (element: Element) => element.getAttribute("aria-labelledby")?.trim().split(/\s+/)
              .map((id) => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(" ") || element.getAttribute("aria-label");
            const label = (accessibleName(node) || labels ||
              node.getAttribute("placeholder") || "").trim();
            const sectionKind = (section: Element) => {
              const legend = accessibleName(section) || section.querySelector(":scope > legend")?.textContent?.trim() || "";
              if (/教育经历|education/i.test(legend)) return "education";
              if (/工作经历|实习经历|employment|work experience/i.test(legend)) return "work";
              if (/项目经历|project experience/i.test(legend)) return "project";
            };
            const sections = Array.from(container.querySelectorAll(expected.sections))
              .filter((item) => visible(item) && !!sectionKind(item));
            const section = sections.filter((item) => item.contains(node)).at(-1);
            const group = section && sectionKind(section) || undefined;
            const siblings = group ? sections.filter((item) => sectionKind(item) === group &&
              !sections.some((child) => child !== item && item.contains(child) && sectionKind(child) === group)) : [];
            const index = siblings.length > 1 && section ? siblings.indexOf(section) : -1;
            const value = type === "file" && node instanceof HTMLInputElement
              ? (node.files?.length === 1 ? node.files[0].name : node.files?.length ? "多个已有附件" : "")
              : node instanceof HTMLSelectElement
                ? (node.value ? node.selectedOptions[0]?.label ?? "" : "")
                : native ? node.value : editable ? node.innerText : "";
            const required = (native && node.required) || node.getAttribute("aria-required") === "true";
            return {
              uid: expected.uid,
              label: label || (required ? "未标注的必填项" : ""),
              type: ["email", "tel", "url", "search", "date", "month", "number"].includes(type) ? "text" : type,
              value,
              required,
              options: node instanceof HTMLSelectElement && !node.multiple
                ? Array.from(node.options).filter((option) => !option.matches(":disabled")).map((option) => option.label)
                : [],
              ...(combo ? { manual: true } : {}),
              group,
              ...(index >= 0 ? { index } : {}),
              writable: !combo && !node.matches("[readonly],[aria-readonly=true],[multiple]"),
              accept: node instanceof HTMLInputElement && type === "file" ? node.accept : "",
            };
          }, { url, origin, uid: `field-${index}`, container: form, sections: experienceSections }).catch(() => undefined);
          const observed = await snapshot();
          if (!observed) continue;
          const { writable, accept, ...data } = observed;
          const parsed = formFieldSchema.safeParse(data);
          if (!parsed.success) continue;
          const field = parsed.data;
          const current = async () => {
            const result = await snapshot();
            return result?.label === field.label && result.type === field.type && result.group === field.group && result.index === field.index && result.accept === accept
              ? result : undefined;
          };
          const unchanged = async () => {
            const result = await current();
            return writable && result?.writable && result.value === field.value &&
              JSON.stringify(result.options) === JSON.stringify(field.options);
          };
          fields.push({
            field,
            read: async () => (await current())?.value,
            fill: async (value) => {
              if (!await unchanged()) return;
              if (field.type === "select") await item.selectOption({ label: value }, { timeout: 2000 });
              if (field.type === "text" || field.type === "textarea") await item.fill(value, { timeout: 2000 });
            },
            attach: async (file) => {
              if (field.type !== "file" || !await unchanged()) return;
              const allowed = accept.toLowerCase().split(",").map((value) => value.trim()).filter(Boolean);
              if (allowed.length && !allowed.some((value) =>
                value.startsWith(".") ? file.name.toLowerCase().endsWith(value) :
                  value.endsWith("/*") ? file.mimeType.startsWith(value.slice(0, -1)) :
                    value === file.mimeType)) return;
              await item.setInputFiles(file, { timeout: 2000 });
            },
          });
        }
        const hasResume = fields.some(({ field }) => field.type === "file" && /简历|résumé|resume|\bcv\b/i.test(field.label));
        const hasName = fields.some(({ field }) => /^(?:姓名|名字|中文姓名|真实姓名|full name|name)[：:*\s]*$/i.test(field.label));
        const hasContact = fields.some(({ field }) => /邮箱|手机|电话|email|phone|mobile/i.test(field.label));
        const experience = fields.some(({ field }) => field.group || /学校|院校|教育经历|工作经历|university|employment/i.test(field.label));
        const native = await form.evaluate((element) => element instanceof HTMLFormElement).catch(() => false);
        if ((native && hasResume) || (hasName && hasContact && (hasResume || applicationPath || experience))) matches.push(fields);
      }
      return matches.length === 1 ? matches[0] : [];
    },
  };
}

/** One plugin-owned profile, separate from the BOSS executor and everyday browser. */
export class WebsiteBrowser {
  private context?: BrowserContext;
  private pages = new Map<string, { url: string; page: Page }>();

  constructor(private home: string) {}

  private async launch() {
    for (const channel of ["msedge", "chrome", undefined]) {
      try {
        const context = await chromium.launchPersistentContext(join(this.home, channel ?? "chromium"), {
          channel, headless: false, timeout: 8000, chromiumSandbox: true,
          acceptDownloads: false,
        });
        context.on("close", () => {
          this.context = undefined;
          this.pages.clear();
        });
        return context;
      } catch {
        // Try the next installed browser without attaching to a user's process.
      }
    }
    throw new Error("官网代填无法启动浏览器。请确认本机已安装 Edge 或 Chrome。");
  }

  async open(jobId: string, url: string) {
    requireCompanyWebsite(url);
    const source = new URL(sourceUrlSchema.parse(url));
    await resolvePublicHost(source.hostname);
    const context = this.context ??= await this.launch();
    const current = this.pages.get(jobId);
    if (current && current.url === url && !current.page.isClosed()) {
      const pages = context.pages();
      const popup = await pages.at(-1)?.opener();
      if (popup === current.page) current.page = pages.at(-1)!;
      await current.page.bringToFront();
      return applicationPage(current.page);
    }
    const page = context.pages().find((item) => item.url() === "about:blank") ?? await context.newPage();
    try {
      await page.goto(source.href, { waitUntil: "domcontentloaded", timeout: 15000 });
    } catch {
      await page.close().catch(() => {});
      throw new Error("未能打开招聘官网，请检查网络或岗位链接后再试。");
    }
    await page.bringToFront();
    this.pages.set(jobId, { url, page });
    return applicationPage(page);
  }

  async close() {
    await this.context?.close();
  }
}
