import { spawn, type ChildProcess } from "node:child_process";
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

  posixIt("re-raises SIGTERM when the host has no other listener", async () => {
    const reportPath = tempReportPath("no-listener");
    const parent = spawnHostScript(hostSignalScript(reportPath));
    let report: SignalReport | undefined;
    try {
      report = await readSignalReport(reportPath, parent);
      expect(report).toMatchObject({ electron: null, type: null, sighup: 1, sigint: 1, sigterm: 1 });
      expect(report.exit).toBeGreaterThan(0);
      const exited = waitForExit(parent);
      parent.kill("SIGTERM");
      await expect(exited).resolves.toEqual({ code: null, signal: "SIGTERM" });
      await waitForGone(report.grandchildPid);
    } finally {
      stopHost(parent, report);
    }
  });

  posixIt("does not re-raise SIGTERM when the host has its own listener", async () => {
    const reportPath = tempReportPath("host-listener");
    const markerPath = tempReportPath("host-listener-marker");
    const parent = spawnHostScript(hostSignalScript(reportPath, `
const { writeFileSync } = await import("node:fs");
process.on("SIGTERM", () => {
  setImmediate(() => {
    writeFileSync(${JSON.stringify(markerPath)}, "host-shutdown");
    process.exit(0);
  });
});
`));
    let report: SignalReport | undefined;
    try {
      report = await readSignalReport(reportPath, parent);
      expect(report).toMatchObject({ sighup: 1, sigint: 1, sigterm: 2 });
      const exited = waitForExit(parent);
      parent.kill("SIGTERM");
      await expect(exited).resolves.toEqual({ code: 0, signal: null });
      expect(await readFile(markerPath, "utf8")).toBe("host-shutdown");
      await waitForGone(report.grandchildPid);
    } finally {
      stopHost(parent, report);
    }
  });

  posixIt("leaves shutdown signals to the Electron main process and reaps children when it exits", async () => {
    const reportPath = tempReportPath("electron-main");
    const markerPath = tempReportPath("electron-main-marker");
    const parent = spawnHostScript(hostSignalScript(reportPath, `
Object.defineProperty(process.versions, "electron", { value: "42.5.1", configurable: true, enumerable: true });
process.type = "browser";
`, `
const { writeFileSync } = await import("node:fs");
process.on("SIGTERM", () => {
  writeFileSync(${JSON.stringify(markerPath)}, "graceful");
  process.exit(0);
});
`));
    let report: SignalReport | undefined;
    try {
      report = await readSignalReport(reportPath, parent);
      expect(report).toMatchObject({
        electron: "42.5.1",
        type: "browser",
        sighup: 0,
        sigint: 0,
        sigterm: 0,
      });
      expect(report.exit).toBeGreaterThan(0);
      const exited = waitForExit(parent);
      parent.kill("SIGTERM");
      await expect(exited).resolves.toEqual({ code: 0, signal: null });
      expect(await readFile(markerPath, "utf8")).toBe("graceful");
      await waitForGone(report.grandchildPid);
    } finally {
      stopHost(parent, report);
    }
  });

  posixIt("still re-raises SIGTERM when Electron is not the main process", async () => {
    const reportPath = tempReportPath("electron-run-as-node");
    const parent = spawnHostScript(hostSignalScript(reportPath, `
Object.defineProperty(process.versions, "electron", { value: "42.5.1", configurable: true, enumerable: true });
`));
    let report: SignalReport | undefined;
    try {
      report = await readSignalReport(reportPath, parent);
      expect(report).toMatchObject({ electron: "42.5.1", type: null, sighup: 1, sigint: 1, sigterm: 1 });
      const exited = waitForExit(parent);
      parent.kill("SIGTERM");
      await expect(exited).resolves.toEqual({ code: null, signal: "SIGTERM" });
      await waitForGone(report.grandchildPid);
    } finally {
      stopHost(parent, report);
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

interface SignalReport {
  childPid: number;
  grandchildPid: number;
  electron: string | null;
  type: string | null;
  sighup: number;
  sigint: number;
  sigterm: number;
  exit: number;
}

function tempReportPath(label: string): string {
  return join(tmpdir(), `openma-node-spawner-${label}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);
}

function hostSignalScript(reportPath: string, prelude = "", afterReport = ""): string {
  const spawnerUrl = new URL("../src/acp-runtime/spawners/node.ts", import.meta.url).href;
  return `
${prelude}
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
const [childPid, grandchildPid] = (await readFirstLine(handle.stdout)).split(":").map(Number);
await writeFile(${JSON.stringify(reportPath)}, JSON.stringify({
  childPid,
  grandchildPid,
  electron: process.versions.electron ?? null,
  type: process.type ?? null,
  sighup: process.listenerCount("SIGHUP"),
  sigint: process.listenerCount("SIGINT"),
  sigterm: process.listenerCount("SIGTERM"),
  exit: process.listenerCount("exit"),
}));
${afterReport}
setInterval(() => {}, 1000);
`;
}

function spawnHostScript(script: string): ChildProcess & { output: () => string } {
  const parent = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  parent.stdout?.setEncoding("utf8");
  parent.stderr?.setEncoding("utf8");
  parent.stdout?.on("data", (chunk: string) => { stdout += chunk; });
  parent.stderr?.on("data", (chunk: string) => { stderr += chunk; });
  return Object.assign(parent, {
    output: () => `stdout:\n${stdout}\nstderr:\n${stderr}`,
  });
}

async function readSignalReport(
  reportPath: string,
  parent: ChildProcess & { output: () => string },
): Promise<SignalReport> {
  const start = Date.now();
  while (Date.now() - start < 4_000) {
    if (parent.exitCode !== null || parent.signalCode !== null) {
      throw new Error(`host exited early (${String(parent.exitCode)}, ${String(parent.signalCode)})\n${parent.output()}`);
    }
    try {
      const text = (await readFile(reportPath, "utf8")).trim();
      if (text) {
        const report = JSON.parse(text) as SignalReport;
        if (!Number.isInteger(report.childPid) || !Number.isInteger(report.grandchildPid)) {
          throw new Error(`incomplete signal report: ${text}\n${parent.output()}`);
        }
        return report;
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        // The report file is still being written.
      } else if (error instanceof Error && error.message.startsWith("incomplete signal report")) {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${reportPath}\n${parent.output()}`);
}

function waitForExit(
  child: ChildProcess & { output?: () => string },
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`process did not exit\n${child.output?.() ?? ""}`));
    }, 4_000);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function stopHost(parent: ChildProcess, report?: SignalReport): void {
  parent.kill("SIGKILL");
  if (report) {
    try { process.kill(-report.childPid, "SIGKILL"); } catch { /* already gone */ }
    try { process.kill(report.grandchildPid, "SIGKILL"); } catch { /* already gone */ }
  }
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
