import nodemailer from "nodemailer";
import type { Send, Workspace } from "../core/workspace.js";

export type SmtpConfig = { address: string; pass: string; provider: string };
export function mailSendingEnabled(workspace: Workspace) {
  return (
    !!workspace.send &&
    (workspace.sendEnabled
      ? workspace.sendEnabled()
      : process.env.RESUME_ALLOW_SEND === "1" && smtpConfigured())
  );
}
function environmentConfig(): SmtpConfig {
  return {
    address: process.env.RESUME_SMTP_ADDRESS ?? "",
    pass: process.env.RESUME_SMTP_CODE ?? "",
    provider: process.env.RESUME_SMTP_PROVIDER ?? "qq",
  };
}
function transportFor({ address, pass, provider }: SmtpConfig) {
  const host = (
    {
      qq: "smtp.qq.com",
      "163": "smtp.163.com",
      "126": "smtp.126.com",
    } as Record<string, string>
  )[provider];
  if (!address || !pass || !host) throw new Error("邮箱配置不完整。");
  return nodemailer.createTransport({
    host,
    port: 465,
    secure: true,
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
  return (
    !!process.env.RESUME_SMTP_ADDRESS &&
    !!process.env.RESUME_SMTP_CODE &&
    ["qq", "163", "126"].includes(process.env.RESUME_SMTP_PROVIDER ?? "qq")
  );
}

export function smtpSender(
  resolveConfig: () => Promise<SmtpConfig> = async () => environmentConfig(),
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
            filename: "resume.pdf",
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
