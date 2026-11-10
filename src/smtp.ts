import nodemailer from "nodemailer";
import type { Send } from "./service.js";

export function smtpSender(): Send {
  return async (mail) => {
    const address = process.env.RESUME_SMTP_ADDRESS,
      pass = process.env.RESUME_SMTP_CODE;
    const host = (
      {
        qq: "smtp.qq.com",
        "163": "smtp.163.com",
        "126": "smtp.126.com",
      } as Record<string, string>
    )[process.env.RESUME_SMTP_PROVIDER ?? "qq"];
    if (!address || !pass || !host) throw new Error("邮箱配置不完整。");
    const transport = nodemailer.createTransport({
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
    } finally {
      transport.close();
    }
  };
}
