import assert from "node:assert/strict";
import { test } from "node:test";
import nodemailer from "nodemailer";
import { smtpSender } from "../../src/infrastructure/smtp.js";
import { mailCredentialRef, smtpEndpoint } from "../../src/shared/mail-settings.js";

test("自定义 SMTP 使用指定端口和强制 STARTTLS，发送沿用预览附件名", async (t) => {
  const config = { address: "candidate@example.com", pass: "test-code", provider: "custom", host: "MAIL.example.com", port: 587, security: "starttls" as const };
  let transport: any, filename: string | undefined;
  t.mock.method(nodemailer, "createTransport", (options: unknown) => {
    transport = options;
    return {
      async sendMail(mail: { attachments: Array<{ filename: string }> }) {
        filename = mail.attachments[0].filename;
        return { accepted: ["hr@example.com"], messageId: "<test@example.com>", response: "250 queued" };
      },
      close() {},
    };
  });
  await smtpSender(async () => config)({
    recipient: "hr@example.com", subject: "应聘", body: "测试", attachmentName: "前端-林沐.pdf",
    attachment: Uint8Array.of(1), messageId: "<test@example.com>",
  });
  assert.equal(filename, "前端-林沐.pdf");
  assert.equal(transport.host, "mail.example.com");
  assert.equal(transport.port, 587);
  assert.equal(transport.secure, false);
  assert.equal(transport.requireTLS, true);
  assert.equal(transport.tls.rejectUnauthorized, true);
  assert.equal(smtpEndpoint({ ...config, host: "https://mail.example.com" }), undefined);
  assert.notEqual(mailCredentialRef(config.address, config.provider, config),
    mailCredentialRef(config.address, config.provider, { ...config, host: "other.example.com" }));
  assert.deepEqual(smtpEndpoint({ provider: "qq" }), { host: "smtp.qq.com", port: 465, security: "tls" });
});
