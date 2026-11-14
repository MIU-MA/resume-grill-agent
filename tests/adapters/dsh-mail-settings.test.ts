import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nativeMail,
  NativeConfig,
} from "../../src/adapters/dsh/mail-settings.js";
import {
  nativeControls,
  selectedSessionId,
} from "../../src/adapters/dsh/controls.js";
import {
  mailCredentialRef,
  defaultMailSettings,
  type MailSettings,
} from "../../src/shared/mail-settings.js";

test("原生邮箱设置实时生效，凭据按账号隔离，删除授权码停用发送", async () => {
  let value: MailSettings = { ...defaultMailSettings },
    watch!: () => Promise<void>,
    changed!: () => Promise<void>;
  const secrets = new Map<string, string>(),
    effects: Array<() => void> = [];
  const ctx = {
    settings: {
      register: (_name: string, schema: any, options: any) => {
        assert.deepEqual(schema({}), defaultMailSettings);
        options.validate(value);
        assert.throws(() =>
          options.validate({ ...value, provider: "unknown" }),
        );
        return {
          get: () => value,
          watch: (fn: any) => {
            watch = fn;
            return () => {};
          },
        };
      },
    },
    credentials: {
      describe: async (ref: string) => ({ configured: secrets.has(ref) }),
      resolve: async (ref: string) =>
        secrets.has(ref) ? { value: secrets.get(ref) } : undefined,
    },
    on: (_event: string, fn: any) => {
      changed = fn;
      return () => {};
    },
    effect: (fn: () => () => void) => {
      effects.push(fn());
    },
  };
  const mail = await nativeMail(ctx);
  value = { address: "first@qq.com", provider: "qq", enabled: true };
  await watch();
  assert.equal(mail.enabled(), false);
  secrets.set(
    mailCredentialRef(value.address, value.provider),
    "fake-authorization-code",
  );
  await changed();
  assert.equal(mail.enabled(), true);
  value = { ...value, address: "other@qq.com" };
  assert.equal(mail.enabled(), false);
  await watch();
  assert.equal(mail.enabled(), false);
  value = { ...value, address: "FIRST@qq.com" };
  await watch();
  assert.equal(mail.enabled(), true);
  value = { ...value, enabled: false };
  assert.equal(mail.enabled(), false);
  value = { ...value, enabled: true };
  secrets.clear();
  await changed();
  assert.equal(mail.enabled(), false);
  assert.ok(!JSON.stringify(value).includes("authorization-code"));
  for (const dispose of effects) dispose();
});

test("桌面版 volatile Config 与主会话选择可用，侧栏恢复只执行引用查询", async () => {
  const parsed = NativeConfig({});
  assert.equal(parsed.address.get(), "");
  assert.equal(parsed.provider.get(), "qq");
  assert.equal(parsed.enabled.get(), false);
  const mail = await nativeMail(
    {
      settings: {},
      credentials: { describe: async () => ({ configured: false }) },
      on: () => () => {},
      effect: (fn: any) => fn(),
    },
    parsed,
  );
  assert.equal(mail.enabled(), false);
  assert.equal(
    selectedSessionId({
      byId: {
        one: { id: "one", retainedBy: { mainView: 1 } },
        two: { id: "two", retainedBy: { mainView: 0 } },
      },
    }),
    "one",
  );
  let received: any;
  const controls = nativeControls(
    {
      remote: {
        commands: {
          execute: async (_id: string, text: string) => {
            received = JSON.parse(text.slice("/resume-grill ".length));
            return {
              ok: true,
              value: {
                result: { kind: "success", text: '{"kind":"workspace"}' },
              },
            };
          },
        },
      },
    },
    "one",
    "workbench",
  );
  await controls.act({ action: "restore", reference: { action: "workspace" } });
  assert.deepEqual(received, { action: "workspace", surface: "workbench" });
});
