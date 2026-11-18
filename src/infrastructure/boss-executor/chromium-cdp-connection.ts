import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";
import { StringDecoder } from "node:string_decoder";

type ChromiumBackend = "edge" | "chrome";
const maxMessageLength = 16 * 1024 * 1024;
const paths = {
  edge: {
    win32: "Microsoft/Edge/Application/msedge.exe",
    darwin: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    linux: "/opt/microsoft/msedge/msedge",
    command: "microsoft-edge",
  },
  chrome: {
    win32: "Google/Chrome/Application/chrome.exe",
    darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    linux: "/opt/google/chrome/chrome",
    command: "google-chrome",
  },
};

async function browserExecutable(backend: ChromiumBackend) {
  const browser = paths[backend];
  const platform = process.platform;
  const candidates =
    platform === "win32"
      ? [
          process.env.ProgramFiles,
          process.env["ProgramFiles(x86)"],
          process.env.LOCALAPPDATA,
        ]
          .filter((root): root is string => Boolean(root))
          .map((root) => join(root, browser.win32))
      : platform === "darwin" || platform === "linux"
        ? [browser[platform]]
        : [];
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue with the next standard installation location.
    }
  }
  return platform === "win32"
    ? backend === "edge"
      ? "msedge.exe"
      : "chrome.exe"
    : browser.command;
}

/** Chrome DevTools traffic stays on inherited pipes of the plugin's browser. */
export class ChromiumCdpSocket extends EventTarget {
  readyState: number = WebSocket.OPEN;
  private readonly input: Writable;
  private readonly childDone: Promise<void>;
  private readonly decoder = new StringDecoder("utf8");
  private remainder = "";

  constructor(private readonly child: ChildProcess) {
    super();
    this.input = child.stdio[3] as Writable;
    const output = child.stdio[4] as Readable;
    this.childDone = new Promise<void>((done) => {
      const finish = () => {
        this.closed();
        done();
      };
      child.once("exit", finish);
      child.once("close", finish);
    });
    child.on("error", () => this.closed());
    this.input.on("error", () => this.closed());
    output.on("error", () => this.closed());
    output.on("close", () => this.closed());
    output.on("data", (chunk: Buffer) => this.receive(chunk));
  }

  static async connect(directory: string, backend: ChromiumBackend) {
    await mkdir(directory, { recursive: true });
    const child = spawn(
      await browserExecutable(backend),
      [
        `--user-data-dir=${directory}`,
        "--remote-debugging-pipe",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-mode",
        "about:blank",
      ],
      {
        stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"],
      },
    );
    const socket = new ChromiumCdpSocket(child);
    await new Promise<void>((done, reject) => {
      child.once("spawn", done);
      child.once("error", reject);
    });
    return socket;
  }

  private receive(chunk: Buffer) {
    this.remainder += this.decoder.write(chunk);
    let end = this.remainder.indexOf("\0");
    while (end !== -1) {
      if (end > maxMessageLength) break;
      const data = this.remainder.slice(0, end);
      this.remainder = this.remainder.slice(end + 1);
      this.dispatchEvent(new MessageEvent("message", { data }));
      end = this.remainder.indexOf("\0");
    }
    if (this.remainder.length > maxMessageLength) {
      this.remainder = "";
      void this.close();
    }
  }

  private closed() {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    this.dispatchEvent(new Event("close"));
  }

  send(message: string) {
    if (this.readyState === WebSocket.OPEN) this.input.write(message + "\0");
  }

  async close() {
    if (this.readyState === WebSocket.CLOSING) return;
    if (this.readyState === WebSocket.OPEN) {
      this.readyState = WebSocket.CLOSING;
      this.input.write('{"id":0,"method":"Browser.close"}\0');
    }
    const timer = setTimeout(() => this.child.kill(), 4000);
    try {
      await this.childDone;
    } finally {
      clearTimeout(timer);
    }
  }
}
