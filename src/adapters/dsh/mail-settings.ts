import Schema from "@deepseek-ai/schemastery";
import { z } from "zod";
import {
  mailCredentialRef,
  type MailSettings,
} from "../../shared/mail-settings.js";
import {
  smtpSender,
  smtpConfigured,
  verifySmtp,
} from "../../infrastructure/smtp.js";

export const mailSettingsInput = z.object({
  address: z.union([z.literal(""), z.email()]),
  provider: z.enum(["qq", "163", "126"]),
  enabled: z.boolean(),
});
/** Native credentials are resolved on use and never copied to plugin data or tool results. */
export const NativeConfig = Schema.object({
  address: Schema.string().default("").volatile(),
  provider: Schema.union(["qq", "163", "126"]).default("qq").volatile(),
  enabled: Schema.boolean().default(false).volatile(),
});
export async function nativeMail(ctx: any, entryConfig?: any) {
  const scope =
    typeof ctx.settings.register === "function"
      ? ctx.settings.register(
          "resume-grill",
          Schema.object({
            address: Schema.string().default(""),
            provider: Schema.string().default("qq"),
            enabled: Schema.boolean().default(false),
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
                ["address", "provider", "enabled"].map((key) => [
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
    const ref = mailCredentialRef(settings.address, settings.provider);
    const info = await ctx.credentials.describe(ref);
    if (turn === generation) {
      readyRef = ref;
      configured = info.configured;
    }
  };
  await refresh();
  ctx.effect(() => scope.watch(refresh));
  ctx.effect(() => ctx.on("credentials/reference-updated", refresh));
  const config = async () => {
    const settings: MailSettings = scope.get();
    if (!settings.address)
      return {
        address: process.env.RESUME_SMTP_ADDRESS ?? "",
        pass: process.env.RESUME_SMTP_CODE ?? "",
        provider: process.env.RESUME_SMTP_PROVIDER ?? "qq",
      };
    const hit = await ctx.credentials.resolve(
      mailCredentialRef(settings.address, settings.provider),
    );
    return {
      address: settings.address,
      provider: settings.provider,
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
        readyRef === mailCredentialRef(settings.address, settings.provider)
      );
    },
    verify: async () => {
      await verifySmtp(await config());
      return { connected: true, message: "邮箱连接成功，没有发送邮件。" };
    },
  };
}
