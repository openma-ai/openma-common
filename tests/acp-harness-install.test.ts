import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import * as tar from "tar";
import { afterEach, describe, expect, it } from "vitest";
import {
  detectInstalledAcpHarness,
  installAcpHarnesses,
  type AcpCatalogHarness,
} from "../src/acp-harnesses/install.js";
import { runCaptured } from "./run-command.js";

const exec = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

async function npmFixture(version = "1.8.0") {
  const root = await mkdtemp(join(tmpdir(), "acp-harness-install-"));
  roots.push(root);
  await mkdir(join(root, "package"));
  await writeFile(
    join(root, "package/package.json"),
    JSON.stringify({
      name: "@test/harness",
      version,
      bin: { "fixture-acp": "cli.cjs" },
    }),
  );
  await writeFile(
    join(root, "package/cli.cjs"),
    "#!/usr/bin/env node\nconsole.log(require(\"./package.json\").version)\n",
    { mode: 0o755 },
  );
  await tar.c({ gzip: true, file: join(root, "package.tgz"), cwd: root, portable: true }, ["package"]);
  const archive = await readFile(join(root, "package.tgz"));
  const metadata = {
    name: "@test/harness",
    version,
    bin: { "fixture-acp": "cli.cjs" },
    dist: {
      tarball: "https://registry.npmjs.org/test.tgz",
      integrity: `sha512-${createHash("sha512").update(archive).digest("base64")}`,
    },
  };
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url === "https://registry.npmjs.org/test.tgz") return new Response(archive);
    if (url === `https://registry.npmjs.org/%40test%2Fharness/${version}`) return Response.json(metadata);
    throw new Error(`unexpected URL ${url}`);
  };
  const entry: AcpCatalogHarness = {
    id: "fixture-acp",
    label: "Fixture",
    version,
    source: { type: "npm", package: "@test/harness" },
  };
  return { root, entry, fetcher };
}

describe("installAcpHarnesses", () => {
  it("installs via npm source with a custom nodePath and is idempotent offline", async () => {
    const f = await npmFixture();
    const installRoot = join(f.root, "harnesses");
    const nodePath = process.execPath;
    const first = await installAcpHarnesses({
      root: installRoot,
      catalog: [f.entry],
      fetch: f.fetcher,
      nodePath,
      env: { CUSTOM_INSTALLER_FLAG: "1" },
    });
    expect(first).toHaveLength(1);
    expect((await runCaptured(first[0]!.command, first[0]!.args)).stdout.trim()).toBe("1.8.0");

    const second = await installAcpHarnesses({
      root: installRoot,
      catalog: [f.entry],
      fetch: async () => {
        throw new Error("offline");
      },
      nodePath,
    });
    expect(second[0]!.command).toBe(first[0]!.command);

    const detected = await detectInstalledAcpHarness(f.entry, { root: installRoot, nodePath });
    expect(detected?.command).toBe(first[0]!.command);
  }, 60_000);

  it("uses nodePath to select the Node module ABI cache segment", async () => {
    const f = await npmFixture("1.9.0");
    const installRoot = join(f.root, "harnesses");
    await installAcpHarnesses({
      root: installRoot,
      catalog: [f.entry],
      fetch: f.fetcher,
      nodePath: process.execPath,
    });
    const { stdout } = await exec(process.execPath, ["-p", "process.versions.modules"]);
    const abi = stdout.trim();
    const { readdir } = await import("node:fs/promises");
    const platformDirs = await readdir(installRoot);
    expect(platformDirs.some((name) => name.includes(`node${abi}`))).toBe(true);
  }, 60_000);
});
