import { access, chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";

import {
  ACP_NPM_INSTALL_TIMEOUT_MS,
  installAcpRegistryAgent,
  listAcpRegistryCatalog,
  readAcpHarnessInstallState,
  readAcpRegistryInstallMetadata,
} from "../src/acp-harnesses/installer.js";
import type { KnownAgentEntry } from "../src/acp-harnesses/known-agents.js";

/** Backchat installer tests use POSIX shell shims and fake npm scripts. */
const unixIt = process.platform === "win32" ? it.skip : it;

describe("ACP registry installer", () => {
  it("allows large managed npm packages enough time to install", () => {
    expect(ACP_NPM_INSTALL_TIMEOUT_MS).toBeGreaterThanOrEqual(10 * 60_000);
  });

  it("lists installable registry agents with platform args and env", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({
      agents: [
        {
          id: "gemini",
          name: "Gemini",
          version: "1.2.3",
          website: "https://example.test/gemini",
          distribution: {
            npx: {
              package: "@google/gemini-cli@1.2.3",
              args: ["--acp"],
              env: { GEMINI_MODE: "1" },
            },
          },
        },
      ],
    })) as never;

    await expect(listAcpRegistryCatalog({ fetchImpl })).resolves.toEqual([
      {
        id: "gemini",
        name: "Gemini",
        version: "1.2.3",
        homepage: "https://example.test/gemini",
        installable: true,
        args: ["--acp"],
        env: { GEMINI_MODE: "1" },
      },
    ]);
  });

  unixIt("keeps the installed npx command available until an upgrade is ready", async () => {
    const root = join(tmpdir(), `openma-acp-atomic-${process.pid}-${Date.now()}`);
    const binDir = join(root, "bin");
    const fakeNpm = join(root, "fake-npm.mjs");
    const started = join(root, "upgrade-started");
    const release = join(root, "release-upgrade");
    await mkdir(root, { recursive: true });
    await writeFile(fakeNpm, `#!/usr/bin/env node
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
const args = process.argv.slice(2);
const prefix = args[args.indexOf("--prefix") + 1];
const spec = args.at(-1);
const packageName = spec.startsWith("@")
  ? ((versionAt) => versionAt > 0 ? spec.slice(0, versionAt) : spec)(spec.indexOf("@", 1))
  : spec.split("@")[0];
const parts = packageName.split("/");
const binName = basename(packageName);
await rm(prefix, { recursive: true, force: true });
if (process.env.TEST_INSTALL_STARTED) {
  await writeFile(process.env.TEST_INSTALL_STARTED, "started");
  while (true) {
    try { await access(process.env.TEST_INSTALL_RELEASE); break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
const packageDir = join(prefix, "node_modules", ...parts);
await mkdir(join(prefix, "node_modules", ".bin"), { recursive: true });
await mkdir(packageDir, { recursive: true });
const pkgVersion = spec.startsWith("@")
  ? (spec.indexOf("@", 1) > 0 ? spec.slice(spec.indexOf("@", 1) + 1) : (process.env.TEST_DEFAULT_PKG_VERSION ?? "0.0.0"))
  : (spec.includes("@") ? spec.slice(spec.lastIndexOf("@") + 1) : (process.env.TEST_DEFAULT_PKG_VERSION ?? "0.0.0"));
await writeFile(join(packageDir, "package.json"), JSON.stringify({ bin: { [binName]: "cli.js" }, version: pkgVersion }));
await writeFile(join(prefix, "node_modules", ".bin", binName), "#!/bin/sh\\nexit 0\\n", { mode: 0o755 });
`, "utf8");
    await chmod(fakeNpm, 0o755);

    let version = "1.0.0";
    const fetchImpl = async () => new Response(JSON.stringify({
      agents: [{
        id: "example-agent",
        version,
        distribution: { npx: { package: `@example/agent@${version}` } },
      }],
    }), { status: 200 });

    await installAcpRegistryAgent({
      registryId: "example-agent",
      shimName: "example-agent",
      binDir,
      installRoot: root,
      npmCommand: fakeNpm,
      fetchImpl: fetchImpl as typeof fetch,
    });

    const shimPath = join(binDir, "example-agent");
    const oldShim = await readFile(shimPath, "utf8");
    const oldCommand = shellShimCommand(oldShim);
    expect(oldCommand).toContain("v_1.0.0_");
    await expect(access(oldCommand)).resolves.toBeUndefined();

    version = "2.0.0";
    const upgrading = installAcpRegistryAgent({
      registryId: "example-agent",
      shimName: "example-agent",
      binDir,
      installRoot: root,
      npmCommand: fakeNpm,
      fetchImpl: fetchImpl as typeof fetch,
      env: {
        ...process.env,
        TEST_INSTALL_STARTED: started,
        TEST_INSTALL_RELEASE: release,
      },
    });

    await waitForFile(started);
    expect(await readFile(shimPath, "utf8")).toBe(oldShim);
    await expect(access(oldCommand)).resolves.toBeUndefined();

    await writeFile(release, "release");
    await upgrading;
    const newCommand = shellShimCommand(await readFile(shimPath, "utf8"));
    expect(newCommand).toContain("v_2.0.0_");
    expect(newCommand).not.toBe(oldCommand);
    await expect(access(newCommand)).resolves.toBeUndefined();
    await rm(root, { recursive: true, force: true });
  });

  unixIt("installs from a supplied registry snapshot without fetching it again", async () => {
    const root = join(tmpdir(), `openma-acp-snapshot-${process.pid}-${Date.now()}`);
    const binDir = join(root, "bin");
    const fakeNpm = await writeFakeNpm(root);
    let fetchCount = 0;

    await installAcpRegistryAgent({
      registryId: "example-agent",
      shimName: "example-agent",
      binDir,
      installRoot: root,
      npmCommand: fakeNpm,
      registryAgent: {
        id: "example-agent",
        version: "1.0.0",
        distribution: { npx: { package: "@example/agent@1.0.0" } },
      },
      fetchImpl: (async () => {
        fetchCount += 1;
        throw new Error("registry should not be fetched");
      }) as typeof fetch,
    });

    expect(fetchCount).toBe(0);
    await rm(root, { recursive: true, force: true });
  });

  unixIt("can run npm through a bundled Node executable and CLI entrypoint", async () => {
    const root = join(tmpdir(), `openma-acp-bundled-npm-${process.pid}-${Date.now()}`);
    const binDir = join(root, "bin");
    const fakeNpm = await writeFakeNpm(root);

    await installAcpRegistryAgent({
      registryId: "example-agent",
      shimName: "example-agent",
      binDir,
      installRoot: root,
      npmCommand: process.execPath,
      npmCommandArgs: [fakeNpm],
      npmEnv: { TEST_BUNDLED_NPM: "1" },
      registryAgent: {
        id: "example-agent",
        version: "1.0.0",
        distribution: { npx: { package: "@example/agent@1.0.0" } },
      },
    });

    await expect(access(join(binDir, "example-agent"))).resolves.toBeUndefined();
    await rm(root, { recursive: true, force: true });
  });

  unixIt("installs an npx upgrade into a clean version directory", async () => {
    const root = join(tmpdir(), `openma-acp-clean-${process.pid}-${Date.now()}`);
    const binDir = join(root, "bin");
    const fakeNpm = await writeFakeNpm(root);
    let version = "1.0.0";
    const fetchImpl = async () => new Response(JSON.stringify({
      agents: [{
        id: "example-agent",
        version,
        distribution: { npx: { package: `@example/agent@${version}` } },
      }],
    }), { status: 200 });

    await installAcpRegistryAgent({
      registryId: "example-agent",
      shimName: "example-agent",
      binDir,
      installRoot: root,
      npmCommand: fakeNpm,
      fetchImpl: fetchImpl as typeof fetch,
    });

    const oldCommand = shellShimCommand(await readFile(join(binDir, "example-agent"), "utf8"));
    const oldPrefix = dirname(dirname(dirname(oldCommand)));
    await writeFile(join(oldPrefix, "reuse-marker"), "reuse me");

    version = "2.0.0";
    await installAcpRegistryAgent({
      registryId: "example-agent",
      shimName: "example-agent",
      binDir,
      installRoot: root,
      npmCommand: fakeNpm,
      fetchImpl: fetchImpl as typeof fetch,
      env: {
        ...process.env,
        TEST_REJECT_SEED: "1",
      },
    });

    await rm(root, { recursive: true, force: true });
  });

  unixIt("retries an ETARGET npx install against the online registry", async () => {
    const root = join(tmpdir(), `openma-acp-etarget-${process.pid}-${Date.now()}`);
    const binDir = join(root, "bin");
    const fakeNpm = join(root, "fake-npm-etarget.mjs");
    const callsPath = join(root, "npm-calls.log");
    await mkdir(root, { recursive: true });
    await writeFile(fakeNpm, `#!/usr/bin/env node
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
const args = process.argv.slice(2);
await appendFile(process.env.TEST_NPM_CALLS, args.join(" ") + "\\n");
if (args.includes("--prefer-offline")) {
  console.error("npm error code ETARGET");
  console.error("npm error notarget No matching version found");
  process.exit(1);
}
const prefix = args[args.indexOf("--prefix") + 1];
const spec = args.at(-1);
const packageName = spec.startsWith("@")
  ? ((versionAt) => versionAt > 0 ? spec.slice(0, versionAt) : spec)(spec.indexOf("@", 1))
  : spec.split("@")[0];
const parts = packageName.split("/");
const binName = basename(packageName);
const packageDir = join(prefix, "node_modules", ...parts);
await mkdir(join(prefix, "node_modules", ".bin"), { recursive: true });
await mkdir(packageDir, { recursive: true });
const pkgVersion = spec.startsWith("@")
  ? (spec.indexOf("@", 1) > 0 ? spec.slice(spec.indexOf("@", 1) + 1) : (process.env.TEST_DEFAULT_PKG_VERSION ?? "0.0.0"))
  : (spec.includes("@") ? spec.slice(spec.lastIndexOf("@") + 1) : (process.env.TEST_DEFAULT_PKG_VERSION ?? "0.0.0"));
await writeFile(join(packageDir, "package.json"), JSON.stringify({ bin: { [binName]: "cli.js" }, version: pkgVersion }));
await writeFile(join(prefix, "node_modules", ".bin", binName), "#!/bin/sh\\nexit 0\\n", { mode: 0o755 });
`, "utf8");
    await chmod(fakeNpm, 0o755);

    await installAcpRegistryAgent({
      registryId: "gemini",
      shimName: "gemini",
      binDir,
      installRoot: root,
      npmCommand: fakeNpm,
      registryAgent: {
        id: "gemini",
        version: "0.51.0",
        distribution: { npx: { package: "@google/gemini-cli@0.51.0" } },
      },
      env: {
        ...process.env,
        TEST_NPM_CALLS: callsPath,
      },
    });

    const calls = await readFile(callsPath, "utf8");
    expect(calls).toContain("--prefer-offline");
    expect(calls).toContain("--prefer-online");
    await rm(root, { recursive: true, force: true });
  });

  unixIt("falls back from the preferred npm registry to the official registry", async () => {
    const root = join(tmpdir(), `openma-acp-registry-fallback-${process.pid}-${Date.now()}`);
    const binDir = join(root, "bin");
    const fakeNpm = join(root, "fake-npm-registry-fallback.mjs");
    const callsPath = join(root, "npm-calls.log");
    await mkdir(root, { recursive: true });
    await writeFile(fakeNpm, `#!/usr/bin/env node
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
const args = process.argv.slice(2);
const registry = args[args.indexOf("--registry") + 1];
await appendFile(process.env.TEST_NPM_CALLS, registry + "\\n");
if (registry === "https://registry.npmmirror.com") {
  console.error("npm error code E502");
  process.exit(1);
}
if (registry !== "https://registry.npmjs.org") {
  console.error("unexpected npm registry: " + registry);
  process.exit(2);
}
const prefix = args[args.indexOf("--prefix") + 1];
const spec = args.at(-1);
const packageName = spec.startsWith("@")
  ? ((versionAt) => versionAt > 0 ? spec.slice(0, versionAt) : spec)(spec.indexOf("@", 1))
  : spec.split("@")[0];
const parts = packageName.split("/");
const binName = basename(packageName);
const packageDir = join(prefix, "node_modules", ...parts);
await mkdir(join(prefix, "node_modules", ".bin"), { recursive: true });
await mkdir(packageDir, { recursive: true });
const pkgVersion = spec.startsWith("@")
  ? (spec.indexOf("@", 1) > 0 ? spec.slice(spec.indexOf("@", 1) + 1) : (process.env.TEST_DEFAULT_PKG_VERSION ?? "0.0.0"))
  : (spec.includes("@") ? spec.slice(spec.lastIndexOf("@") + 1) : (process.env.TEST_DEFAULT_PKG_VERSION ?? "0.0.0"));
await writeFile(join(packageDir, "package.json"), JSON.stringify({ bin: { [binName]: "cli.js" }, version: pkgVersion }));
await writeFile(join(prefix, "node_modules", ".bin", binName), "#!/bin/sh\\nexit 0\\n", { mode: 0o755 });
`, "utf8");
    await chmod(fakeNpm, 0o755);

    await installAcpRegistryAgent({
      registryId: "gemini",
      shimName: "gemini",
      binDir,
      installRoot: root,
      npmCommand: fakeNpm,
      npmRegistryUrls: [
        "https://registry.npmmirror.com",
        "https://registry.npmjs.org",
      ],
      registryAgent: {
        id: "gemini",
        version: "0.51.0",
        distribution: { npx: { package: "@google/gemini-cli@0.51.0" } },
      },
      env: {
        ...process.env,
        TEST_NPM_CALLS: callsPath,
      },
    });

    await expect(access(join(binDir, "gemini"))).resolves.toBeUndefined();
    await expect(readFile(callsPath, "utf8")).resolves.toBe(
      "https://registry.npmmirror.com\nhttps://registry.npmjs.org\n",
    );
    await rm(root, { recursive: true, force: true });
  });

  unixIt("records the resolved npm version in install.json and avoids v_unknown directories", async () => {
    const root = join(tmpdir(), `openma-acp-version-metadata-${process.pid}-${Date.now()}`);
    const binDir = join(root, "bin");
    const fakeNpm = await writeFakeNpm(root);
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("registry.example.test")) {
        return new Response(JSON.stringify({
          "dist-tags": { latest: "0.1.6" },
        }), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${href}`);
    }) as typeof fetch;

    await installAcpRegistryAgent({
      registryId: "pi-acp",
      shimName: "openma-acp-pi-acp",
      binDir,
      installRoot: root,
      npmCommand: fakeNpm,
      npmRegistryUrls: ["https://registry.example.test"],
      fetchImpl,
      env: {
        ...process.env,
        TEST_DEFAULT_PKG_VERSION: "0.1.6",
      },
      registryAgent: {
        id: "pi-acp",
        distribution: { npx: { package: "@openma/pi-acp" } },
      },
    });

    const metadata = await readAcpRegistryInstallMetadata({
      registryId: "pi-acp",
      binDir,
      installRoot: root,
    });
    expect(metadata?.version).toBe("0.1.6");
    const { readdir } = await import("node:fs/promises");
    const versionDirs = await readdir(join(root, "registry", "pi-acp"));
    expect(versionDirs.some((entry) => /^v_0\.1\.6_/.test(entry))).toBe(true);
    expect(versionDirs.some((entry) => /v_unknown/.test(entry))).toBe(false);
    await rm(root, { recursive: true, force: true });
  });

  unixIt("reads legacy v_unknown installs through readAcpHarnessInstallState", async () => {
    const root = join(tmpdir(), `openma-acp-legacy-unknown-${process.pid}-${Date.now()}`);
    const binDir = join(root, "bin");
    const installDir = join(root, "registry", "pi-acp", "v_unknown_legacyhash");
    const packageDir = join(installDir, "node_modules", "@openma", "pi-acp");
    const packageBin = join(installDir, "node_modules", ".bin", "pi-acp");
    await mkdir(packageDir, { recursive: true });
    await mkdir(join(installDir, "node_modules", ".bin"), { recursive: true });
    await mkdir(binDir, { recursive: true });
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({ name: "@openma/pi-acp", version: "0.1.6", bin: { "pi-acp": "cli.js" } }),
    );
    await writeFile(packageBin, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    await writeFile(
      join(binDir, "openma-acp-pi-acp"),
      `#!/bin/sh\nexec '${packageBin}' "$@"\n`,
      { mode: 0o755 },
    );
    await writeFile(
      join(root, "registry", "pi-acp", "install.json"),
      JSON.stringify({
        source: "registry",
        registryId: "pi-acp",
        shimName: "openma-acp-pi-acp",
        installedAt: "2026-01-01T00:00:00.000Z",
      }),
      "utf8",
    );

    const entry: KnownAgentEntry = {
      id: "pi-acp",
      label: "Pi",
      spec: { command: "openma-acp-pi-acp" },
      registryId: "pi-acp",
      installSource: "registry",
      registryDistribution: { npx: { package: "@openma/pi-acp" } },
    };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      "dist-tags": { latest: "0.1.6" },
    }), { status: 200 })) as typeof fetch;

    await expect(readAcpHarnessInstallState({
      entry,
      binDir,
      installRoot: root,
      fetchImpl,
      npmRegistryUrls: ["https://registry.example.test"],
    })).resolves.toEqual({
      installed: true,
      installedVersion: "0.1.6",
      latestVersion: "0.1.6",
    });

    await rm(root, { recursive: true, force: true });
  });
});

async function writeFakeNpm(root: string): Promise<string> {
  const fakeNpm = join(root, "fake-npm-seeded.mjs");
  await mkdir(root, { recursive: true });
  await writeFile(fakeNpm, `#!/usr/bin/env node
import { access, mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
const args = process.argv.slice(2);
const prefix = args[args.indexOf("--prefix") + 1];
const spec = args.at(-1);
const packageName = spec.startsWith("@")
  ? ((versionAt) => versionAt > 0 ? spec.slice(0, versionAt) : spec)(spec.indexOf("@", 1))
  : spec.split("@")[0];
const parts = packageName.split("/");
const binName = basename(packageName);
if (process.env.TEST_REJECT_SEED) {
  try {
    await access(join(prefix, "reuse-marker"));
    throw new Error("upgrade directory inherited files from the active version");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
const packageDir = join(prefix, "node_modules", ...parts);
await mkdir(join(prefix, "node_modules", ".bin"), { recursive: true });
await mkdir(packageDir, { recursive: true });
const pkgVersion = spec.startsWith("@")
  ? (spec.indexOf("@", 1) > 0 ? spec.slice(spec.indexOf("@", 1) + 1) : (process.env.TEST_DEFAULT_PKG_VERSION ?? "0.0.0"))
  : (spec.includes("@") ? spec.slice(spec.lastIndexOf("@") + 1) : (process.env.TEST_DEFAULT_PKG_VERSION ?? "0.0.0"));
await writeFile(join(packageDir, "package.json"), JSON.stringify({ bin: { [binName]: "cli.js" }, version: pkgVersion }));
await writeFile(join(prefix, "node_modules", ".bin", binName), "#!/bin/sh\\nexit 0\\n", { mode: 0o755 });
`, "utf8");
  await chmod(fakeNpm, 0o755);
  return fakeNpm;
}

function shellShimCommand(shim: string): string {
  const match = shim.match(/^exec '([^']+)'/m);
  if (!match?.[1]) throw new Error(`Could not parse shim: ${shim}`);
  return match[1];
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await access(path);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}
