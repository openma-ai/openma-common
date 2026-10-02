import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NodeSpawner } from "../src/acp-runtime/spawners/node.js";

describe("NodeSpawner", () => {
  const posixIt = process.platform === "win32" ? it.skip : it;

  it("rejects with the spawn error when an ACP executable is missing", async () => {
    const spawner = new NodeSpawner();

    await expect(spawner.spawn({
      command: "openma-definitely-missing-acp-executable",
    })).rejects.toMatchObject({ code: "ENOENT" });
  });

  posixIt("kills the child process group so grandchildren are not orphaned", async () => {
    const spawner = new NodeSpawner();
    const script = `
const { spawn } = require("node:child_process");
const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
console.log(grandchild.pid);
setInterval(() => {}, 1000);
`;
    const handle = await spawner.spawn({
      command: process.execPath,
      args: ["-e", script],
    });
    const grandchildPid = Number(await readFirstStdoutLine(handle.stdout));
    expect(Number.isInteger(grandchildPid)).toBe(true);
    try {
      await handle.kill("SIGTERM");
      await waitForGone(grandchildPid);
    } finally {
      try { process.kill(-grandchildPid, "SIGKILL"); } catch { /* already gone */ }
    }
  });

  posixIt("escalates to SIGKILL when the process group ignores SIGTERM", async () => {
    const spawner = new NodeSpawner();
    const handle = await spawner.spawn({
      command: process.execPath,
      args: ["-e", "process.on('SIGTERM', () => {}); console.log(process.pid); setInterval(() => {}, 1000)"],
    });
    const childPid = Number(await readFirstStdoutLine(handle.stdout));
    expect(Number.isInteger(childPid)).toBe(true);
    try {
      const stopped = await Promise.race([
        handle.kill("SIGTERM").then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 3_500)),
      ]);
      expect(stopped).toBe(true);
      await waitForGone(childPid);
    } finally {
      try { process.kill(-childPid, "SIGKILL"); } catch { /* already gone */ }
      await handle.exited;
    }
  }, 8_000);

  posixIt("signals live child process groups when the host exits", async () => {
    const pidFile = join(tmpdir(), `openma-node-spawner-grandchild-${process.pid}-${Date.now()}.txt`);
    const spawnerUrl = new URL("../src/acp-runtime/spawners/node.ts", import.meta.url).href;
    const parentScript = `
const { writeFile } = await import("node:fs/promises");
const { NodeSpawner } = await import(${JSON.stringify(spawnerUrl)});
async function readFirstLine(stream) {
  const reader = stream.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) return "";
    chunks.push(value);
    const text = new TextDecoder().decode(Buffer.concat(chunks));
    const newline = text.indexOf("\\n");
    if (newline >= 0) return text.slice(0, newline).trim();
  }
}
const script = ${JSON.stringify(`
const { spawn } = require("node:child_process");
const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
console.log(grandchild.pid);
setInterval(() => {}, 1000);
`)};
const spawner = new NodeSpawner();
const handle = await spawner.spawn({ command: process.execPath, args: ["-e", script] });
await writeFile(${JSON.stringify(pidFile)}, await readFirstLine(handle.stdout), "utf8");
process.exit(0);
`;
    const parent = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", parentScript], {
      stdio: "ignore",
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("parent process did not exit")), 4_000);
      parent.once("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`parent exited with ${code}`));
      });
      parent.once("error", reject);
    });
    const grandchildPid = Number((await readFile(pidFile, "utf8")).trim());
    expect(Number.isInteger(grandchildPid)).toBe(true);
    await waitForGone(grandchildPid);
  });

  posixIt("signals live child process groups when the host is interrupted", async () => {
    const pidFile = join(tmpdir(), `openma-node-spawner-sigint-${process.pid}-${Date.now()}.txt`);
    const spawnerUrl = new URL("../src/acp-runtime/spawners/node.ts", import.meta.url).href;
    const parentScript = `
const { writeFile } = await import("node:fs/promises");
const { NodeSpawner } = await import(${JSON.stringify(spawnerUrl)});
async function readFirstLine(stream) {
  const reader = stream.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) return "";
    chunks.push(value);
    const text = new TextDecoder().decode(Buffer.concat(chunks));
    const newline = text.indexOf("\\n");
    if (newline >= 0) return text.slice(0, newline).trim();
  }
}
const script = ${JSON.stringify(`
const { spawn } = require("node:child_process");
const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
console.log(process.pid + ":" + grandchild.pid);
setInterval(() => {}, 1000);
`)};
const spawner = new NodeSpawner();
const handle = await spawner.spawn({ command: process.execPath, args: ["-e", script] });
await writeFile(${JSON.stringify(pidFile)}, await readFirstLine(handle.stdout), "utf8");
setInterval(() => {}, 1000);
`;
    const parent = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", parentScript], {
      stdio: "ignore",
    });
    let childPid: number | undefined;
    let grandchildPid: number | undefined;
    try {
      const start = Date.now();
      while (Date.now() - start < 4_000) {
        try {
          const [child, grandchild] = (await readFile(pidFile, "utf8")).trim().split(":").map(Number);
          if (Number.isInteger(child) && Number.isInteger(grandchild)) {
            childPid = child;
            grandchildPid = grandchild;
            break;
          }
        } catch {
          // The pid file is written after the child prints.
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(Number.isInteger(childPid)).toBe(true);
      expect(Number.isInteger(grandchildPid)).toBe(true);
      parent.kill("SIGINT");
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("parent process did not exit after SIGINT")), 4_000);
        parent.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        parent.once("error", reject);
      });
      await waitForGone(grandchildPid!);
    } finally {
      parent.kill("SIGKILL");
      if (childPid !== undefined) {
        try { process.kill(-childPid, "SIGKILL"); } catch { /* already gone */ }
      }
    }
  });
});

async function waitForGone(pid: number, timeoutMs = 1_500): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`process ${pid} was still alive`);
}

async function readFirstStdoutLine(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  try {
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      const text = new TextDecoder().decode(Buffer.concat(chunks));
      const newline = text.indexOf("\n");
      if (newline >= 0) return text.slice(0, newline).trim();
    }
    return "";
  } finally {
    reader.releaseLock();
  }
}
