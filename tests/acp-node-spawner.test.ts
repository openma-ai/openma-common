import { describe, expect, it } from "vitest";
import { NodeSpawner } from "../src/acp-runtime/spawners/node.js";

async function readFirstLine(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return "";
      chunks.push(value);
      const text = new TextDecoder().decode(Buffer.concat(chunks));
      const newline = text.indexOf("\n");
      if (newline >= 0) return text.slice(0, newline).trim();
    }
  } finally {
    reader.releaseLock();
  }
}

async function waitForGone(pid: number, timeoutMs = 1_500): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`process ${pid} was still alive`);
}

describe("shared ACP NodeSpawner lifecycle", () => {
  const posixIt = process.platform === "win32" ? it.skip : it;

  posixIt("kills the child process group without orphaning grandchildren", async () => {
    const spawner = new NodeSpawner();
    const handle = await spawner.spawn({
      command: process.execPath,
      args: [
        "-e",
        `
const { spawn } = require("node:child_process");
const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
console.log(grandchild.pid);
setInterval(() => {}, 1000);
`,
      ],
    });
    const grandchildPid = Number(await readFirstLine(handle.stdout));
    expect(Number.isInteger(grandchildPid)).toBe(true);

    try {
      await handle.kill("SIGTERM");
      await waitForGone(grandchildPid);
    } finally {
      try {
        process.kill(grandchildPid, "SIGKILL");
      } catch {
        // Already reaped by the process-group shutdown.
      }
    }
  });
});
