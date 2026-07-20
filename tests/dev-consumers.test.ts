import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "..");

function fakePnpm() {
  const root = mkdtempSync(join(tmpdir(), "openma-dev-consumers-"));
  const bin = join(root, "bin");
  const log = join(root, "calls.log");
  mkdirSync(bin);
  const executable = join(bin, "pnpm");
  writeFileSync(executable, `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const call = process.argv.slice(2).join(" ");
appendFileSync(process.env.OPENMA_TEST_LOG, call + "\\n");
if (call === "dev") {
  const exitCode = process.env.OPENMA_FAKE_DEV_EXIT;
  if (exitCode !== undefined) process.exit(Number(exitCode));
  setInterval(() => {}, 1000);
}
`);
  chmodSync(executable, 0o755);
  return { bin, log };
}

async function waitForCall(log: string, expected: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      if (readFileSync(log, "utf8").split("\n").includes(expected)) return;
    } catch {
      // The child has not created the log yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  throw new Error(`Timed out waiting for pnpm ${expected}`);
}

function runLifecycle(env: Record<string, string> = {}) {
  const fixture = fakePnpm();
  const child = spawn(process.execPath, ["scripts/dev-consumers.mjs"], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      ...env,
      PATH: `${fixture.bin}:${process.env.PATH ?? ""}`,
      OPENMA_TEST_LOG: fixture.log,
    },
    stdio: "pipe",
  });
  return { ...fixture, child };
}

function closeResult(child: ReturnType<typeof spawn>) {
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveClose) => {
    child.once("close", (code, signal) => resolveClose({ code, signal }));
  });
}

describe("dev:consumers lifecycle", () => {
  it("unlinks consumers and preserves the dev exit code", async () => {
    const { child, log } = runLifecycle({ OPENMA_FAKE_DEV_EXIT: "7" });
    const result = await closeResult(child);

    expect(result).toEqual({ code: 7, signal: null });
    expect(readFileSync(log, "utf8").trim().split("\n")).toEqual([
      "link:consumers",
      "dev",
      "unlink:consumers",
    ]);
  });

  it("unlinks consumers when the orchestrator is terminated", async () => {
    const { child, log } = runLifecycle();
    await waitForCall(log, "dev");
    child.kill("SIGTERM");
    const result = await closeResult(child);

    expect(result).toEqual({ code: 0, signal: null });
    expect(readFileSync(log, "utf8").trim().split("\n")).toEqual([
      "link:consumers",
      "dev",
      "unlink:consumers",
    ]);
  });
});
