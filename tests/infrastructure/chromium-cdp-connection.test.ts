import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { ChromiumCdpSocket } from "../../src/infrastructure/boss-executor/chromium-cdp-connection.js";

test("Chromium 管道组装跨块的中文消息，并先请求正常退出", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const child = Object.assign(new EventEmitter(), {
    stdio: [null, null, null, input, output],
    kill: () => assert.fail("正常退出时不应强制终止浏览器"),
  });
  const socket = new ChromiumCdpSocket(child as unknown as ChildProcess);
  const received: string[] = [];
  const sent: string[] = [];
  input.on("data", (data: Buffer) => sent.push(data.toString()));
  socket.addEventListener("message", (event) =>
    received.push(String((event as MessageEvent).data)),
  );
  const payload = Buffer.from('{"name":"岗位"}\0{"id":2}\0');
  const split = payload.indexOf(Buffer.from("岗")) + 1;
  output.write(payload.subarray(0, split));
  assert.deepEqual(received, []);
  output.write(payload.subarray(split));
  assert.deepEqual(received, ['{"name":"岗位"}', '{"id":2}']);

  socket.send('{"id":7,"method":"Target.getTargets"}');
  const closing = socket.close();
  child.emit("close");
  await closing;
  assert.deepEqual(sent, [
    '{"id":7,"method":"Target.getTargets"}\0',
    '{"id":0,"method":"Browser.close"}\0',
  ]);
  assert.equal(socket.readyState, WebSocket.CLOSED);
});
