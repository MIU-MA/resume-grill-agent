import Schema from "@deepseek-ai/schemastery";
import { z } from "zod";
import {
  mailCredentialRef,
  smtpEndpoint,
  type MailSettings,
} from "../../shared/mail-settings.js";
import {
  smtpSender,
  smtpConfigured,
  smtpEnvironmentConfig,
  verifySmtp,
} from "../../infrastructure/smtp.js";

export const mailSettingsInput = z.object({
  address: z.union([z.literal(""), z.email()]),
  provider: z.enum(["qq", "163", "126", "custom"]),
  enabled: z.boolean(),
  host: z.string().max(253).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  security: z.enum(["tls", "starttls"]).optional(),
}).refine((value) => !!smtpEndpoint(value), "自定义 SMTP 需要服务器、端口和加密方式。");
/** Native credentials are resolved on use and never copied to plugin data or tool results. */
export async function nativeMail(ctx: any, entryConfig?: any) {
  const scope =
    typeof ctx.settings.register === "function"
      ? ctx.settings.register(
          "resume-grill",
          Schema.object({
            address: Schema.string().default(""),
            provider: Schema.string().default("qq"),
            enabled: Schema.boolean().default(false),
            host: Schema.string().default(""),
            port: Schema.number().default(465),
            security: Schema.string().default("tls"),
          }),
          {
            applies: "live",
            validate: (value: unknown) => {
              mailSettingsInput.parse(value);
            },
          },
        )
      : {
          get: () =>
            mailSettingsInput.parse(
              Object.fromEntries(
                ["address", "provider", "enabled", "host", "port", "security"].map((key) => [
                  key,
                  entryConfig[key]?.get
                    ? entryConfig[key].get()
                    : entryConfig[key],
                ]),
              ),
            ),
          watch: (fn: any) => ctx.on("app-boot/config-reload", fn),
        };
  let readyRef = "",
    configured = false,
    generation = 0;
  const refresh = async () => {
    const turn = ++generation,
      settings: MailSettings = scope.get();
    const ref = mailCredentialRef(settings.address, settings.provider, settings);
    try {
      const info = await ctx.credentials.describe(ref);
      if (turn === generation) {
        readyRef = ref;
        configured = info.configured;
      }
    } catch (error) {
      if (turn === generation) configured = false;
      throw error;
    }
  };
  await refresh();
  ctx.effect(() => scope.watch(refresh));
  ctx.effect(() => ctx.on("credentials/reference-updated", refresh));
  const config = async () => {
    const settings: MailSettings = scope.get();
    if (!settings.address) return smtpEnvironmentConfig();
    const hit = await ctx.credentials.resolve(
      mailCredentialRef(settings.address, settings.provider, settings),
    );
    return {
      ...settings,
      pass: hit?.value ?? "",
    };
  };
  return {
    send: smtpSender(config),
    refresh,
    enabled: () => {
      const settings: MailSettings = scope.get();
      if (!settings.address)
        return process.env.RESUME_ALLOW_SEND === "1" && smtpConfigured();
      return (
        settings.enabled &&
        configured &&
        readyRef === mailCredentialRef(settings.address, settings.provider, settings)
      );
    },
    verify: async () => {
      await verifySmtp(await config());
      return { connected: true, message: "邮箱连接成功，没有发送邮件。" };
    },
  };
}
