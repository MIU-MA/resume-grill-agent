import nodemailer from "nodemailer";
import type { Send, Workspace } from "../core/workspace.js";
import { smtpEndpoint } from "../shared/mail-settings.js";

export type SmtpConfig = { address: string; pass: string; provider: string; host?: string; port?: number; security?: string };
export function mailSendingEnabled(workspace: Workspace) {
  return (
    !!workspace.send &&
    (workspace.sendEnabled
      ? workspace.sendEnabled()
      : process.env.RESUME_ALLOW_SEND === "1" && smtpConfigured())
  );
}
export function smtpEnvironmentConfig(): SmtpConfig {
  return {
    address: process.env.RESUME_SMTP_ADDRESS ?? "",
    pass: process.env.RESUME_SMTP_CODE ?? "",
    provider: process.env.RESUME_SMTP_PROVIDER ?? "qq",
    host: process.env.RESUME_SMTP_HOST,
    port: Number(process.env.RESUME_SMTP_PORT ?? 465),
    security: process.env.RESUME_SMTP_SECURITY ?? "tls",
  };
}
function transportFor(config: SmtpConfig) {
  const { address, pass } = config;
  const endpoint = smtpEndpoint(config);
  if (!address || !pass || !endpoint) throw new Error("请核对发件邮箱、授权码及 SMTP 服务器设置。");
  const secure = endpoint.security === "tls";
  return nodemailer.createTransport({
    host: endpoint.host,
    port: endpoint.port,
    secure,
    requireTLS: !secure,
    auth: { user: address, pass },
    tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 60000,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}
export async function verifySmtp(config: SmtpConfig) {
  const transport = transportFor(config);
  try {
    await transport.verify();
  } catch {
    throw new Error(
      "邮箱连接失败，请检查邮箱、SMTP 授权码和网络。没有发送邮件。",
    );
  } finally {
    transport.close();
  }
}

export function smtpConfigured() {
  const config = smtpEnvironmentConfig();
  return !!(config.address && config.pass && smtpEndpoint(config));
}

export function smtpSender(
  resolveConfig: () => Promise<SmtpConfig> = async () => smtpEnvironmentConfig(),
): Send {
  return async (mail) => {
    const config = await resolveConfig(),
      address = config.address;
    const transport = transportFor(config);
    try {
      const result = await transport.sendMail({
        from: address,
        to: mail.recipient,
        subject: mail.subject,
        text: mail.body,
        messageId: mail.messageId,
        attachments: [
          {
            filename: mail.attachmentName,
            content: Buffer.from(mail.attachment),
            contentType: "application/pdf",
          },
        ],
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      if (
        !result.accepted.some(
          (value) =>
            String(value).toLowerCase() === mail.recipient.toLowerCase(),
        )
      )
        throw new Error("邮件未被接受。");
      return {
        accepted: result.accepted.map(String),
        response: String(result.response).slice(0, 1000),
        messageId: result.messageId,
        acceptedAt: Date.now(),
      };
    } finally {
      transport.close();
    }
  };
}
