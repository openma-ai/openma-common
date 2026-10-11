import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import {
  installAcpRegistryAgent,
  installPinnedAcpHarness,
  readAcpHarnessPinState,
  readAcpRegistryInstallMetadata,
} from "../src/acp-harnesses/installer.js";
import { OVERLAY_AGENTS, type KnownAgentEntry } from "../src/acp-harnesses/known-agents.js";

/** Installer tests use POSIX shell shims and fake npm scripts. */
const unixIt = process.platform === "win32" ? it.skip : it;

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const entry: KnownAgentEntry = {
  id: "example",
  label: "Example",
  spec: { command: "openma-acp-example", args: ["acp"], env: { EXAMPLE: "1" } },
  registryId: "example",
  installSource: "registry",
  pinned: {
    package: "@example/agent@1.2.3",
    dependencies: { "@example/sdk": "4.5.6", "example-core": "7.8.9" },
  },
};

/**
 * A stand-in for npm that honours `overrides` the way npm does: it installs
 * the requested package and, for each override in the package.json at the
 * prefix, that dependency at the overridden version. TEST_DRIFT installs one
 * dependency at another version; TEST_ETARGET fails the offline attempt.
 */
async function fakeNpm(): Promise<{ root: string; npm: string; calls: string }> {
  const root = join(tmpdir(), `openma-acp-pinned-${process.pid}-${Date.now()}-${roots.length}`);
  roots.push(root);
  const npm = join(root, "fake-npm.mjs");
  const calls = join(root, "npm-calls.log");
  await mkdir(root, { recursive: true });
  await writeFile(npm, `#!/usr/bin/env node
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
const args = process.argv.slice(2);
const prefix = args[args.indexOf("--prefix") + 1];
const manifest = await readFile(join(prefix, "package.json"), "utf8").catch(() => "{}");
await appendFile(${JSON.stringify(calls)}, JSON.stringify({ args, manifest: JSON.parse(manifest) }) + "\\n");
if (process.env.TEST_ETARGET && args.includes("--prefer-offline")) {
  console.error("npm error code ETARGET");
  process.exit(1);
}
const spec = args.at(-1);
const at = spec.indexOf("@", 1);
const write = async (name, version, bin) => {
  const dir = join(prefix, "node_modules", ...name.split("/"));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "package.json"), JSON.stringify({ version, ...(bin ? { bin: { [bin]: "cli.js" } } : {}) }));
};
const name = spec.slice(0, at);
await write(name, spec.slice(at + 1), basename(name));
await mkdir(join(prefix, "node_modules", ".bin"), { recursive: true });
await writeFile(join(prefix, "node_modules", ".bin", basename(name)), "#!/bin/sh\\nexit 0\\n", { mode: 0o755 });
for (const [dependency, version] of Object.entries(JSON.parse(manifest).overrides ?? {})) {
  if (dependency === process.env.TEST_SKIP) continue;
  await write(dependency, dependency === process.env.TEST_DRIFT ? "9.9.9" : version);
}
`, "utf8");
  await chmod(npm, 0o755);
  return { root, npm, calls };
}

function shimCommand(shim: string): string {
  return shim.match(/^exec '([^']+)'/m)![1]!;
}

describe("pinned ACP harness install", () => {
  it("pins the Pi adapter and every Pi SDK package it resolves to one exact version", () => {
    const pi = OVERLAY_AGENTS.find((agent) => agent.id === "pi-acp")!;
    const exact = /^\d+\.\d+\.\d+$/;

    expect(pi.pinned!.package).toMatch(/^@openma\/pi-acp@\d+\.\d+\.\d+$/);
    expect(Object.keys(pi.pinned!.dependencies).length).toBeGreaterThan(0);
    for (const [name, version] of Object.entries(pi.pinned!.dependencies)) {
      expect(name).toMatch(/^@earendil-works\//);
      expect(version).toMatch(exact);
    }
  });

  unixIt("installs the pinned package with npm overrides and records what was installed", async () => {
    const { root, npm, calls } = await fakeNpm();
    const binDir = join(root, "bin");

    const result = await installPinnedAcpHarness({ entry, binDir, installRoot: root, npmCommand: npm });

    expect(result).toEqual({
      commandPath: join(binDir, "openma-acp-example"),
      version: "1.2.3",
      dependencies: { "@example/sdk": "4.5.6", "example-core": "7.8.9" },
    });
    const call = JSON.parse((await readFile(calls, "utf8")).trim()) as {
      args: string[];
      manifest: Record<string, unknown>;
    };
    expect(call.args.at(-1)).toBe("@example/agent@1.2.3");
    expect(call.manifest).toEqual({
      private: true,
      overrides: { "@example/sdk": "4.5.6", "example-core": "7.8.9" },
    });
    const shim = await readFile(result.commandPath, "utf8");
    expect(shim).toContain("export EXAMPLE='1'");
    expect(shim).toContain("' 'acp' \"$@\"");
    await expect(
      readAcpRegistryInstallMetadata({ registryId: "example", binDir, installRoot: root }),
    ).resolves.toMatchObject({
      version: "1.2.3",
      dependencies: { "@example/sdk": "4.5.6", "example-core": "7.8.9" },
    });

    await expect(readAcpHarnessPinState({ entry, shimPath: result.commandPath })).resolves.toEqual({
      package: { name: "@example/agent", pinned: "1.2.3", installed: "1.2.3" },
      dependencies: [
        { name: "@example/sdk", pinned: "4.5.6", installed: "4.5.6" },
        { name: "example-core", pinned: "7.8.9", installed: "7.8.9" },
      ],
      satisfied: true,
    });

    // The same package installed without pins lives in another directory.
    const floating = await installAcpRegistryAgent({
      registryId: "example",
      registryAgent: { id: "example", version: "1.2.3", distribution: { npx: { package: "@example/agent@1.2.3" } } },
      shimName: "floating",
      binDir,
      installRoot: root,
      npmCommand: npm,
    });
    expect(floating.dependencies).toBeUndefined();
    expect(dirname(shimCommand(await readFile(floating.commandPath, "utf8")))).not.toBe(dirname(shimCommand(shim)));
    await expect(
      readAcpRegistryInstallMetadata({ registryId: "example", binDir, installRoot: root }),
    ).resolves.not.toHaveProperty("dependencies");
  });

  unixIt("writes the overrides again for the online retry", async () => {
    const { root, npm, calls } = await fakeNpm();

    await installPinnedAcpHarness({
      entry,
      binDir: join(root, "bin"),
      npmCommand: npm,
      env: { ...process.env, TEST_ETARGET: "1" },
    });

    const attempts = (await readFile(calls, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as {
      args: string[];
      manifest: { overrides?: unknown };
    });
    expect(attempts.map(({ args }) => args.includes("--prefer-online"))).toEqual([false, true]);
    expect(attempts[1]!.manifest.overrides).toEqual(entry.pinned!.dependencies);
  });

  unixIt("fails when npm installed a pinned dependency at another version, or not at all", async () => {
    const { root, npm } = await fakeNpm();
    const install = (variable: string) =>
      installPinnedAcpHarness({
        entry,
        binDir: join(root, variable),
        installRoot: join(root, variable),
        npmCommand: npm,
        env: { ...process.env, [variable]: "example-core" },
      });

    await expect(install("TEST_DRIFT")).rejects.toThrow(/example-core is pinned to 7\.8\.9 but 9\.9\.9 is installed/);
    await expect(install("TEST_SKIP")).rejects.toThrow(/example-core is pinned to 7\.8\.9 but nothing is installed/);
  });

  unixIt("reports an install that no longer matches the pins", async () => {
    const { root, npm } = await fakeNpm();
    const result = await installPinnedAcpHarness({ entry, binDir: join(root, "bin"), installRoot: root, npmCommand: npm });
    const prefix = dirname(dirname(dirname(shimCommand(await readFile(result.commandPath, "utf8")))));
    await writeFile(join(prefix, "node_modules", "example-core", "package.json"), JSON.stringify({ version: "7.9.0" }));
    await rm(join(prefix, "node_modules", "@example", "sdk"), { recursive: true });

    await expect(readAcpHarnessPinState({ entry, shimPath: result.commandPath })).resolves.toEqual({
      package: { name: "@example/agent", pinned: "1.2.3", installed: "1.2.3" },
      dependencies: [
        { name: "@example/sdk", pinned: "4.5.6" },
        { name: "example-core", pinned: "7.8.9", installed: "7.9.0" },
      ],
      satisfied: false,
    });
    // Reusing that directory is refused too: the pins are checked on every install.
    await expect(
      installPinnedAcpHarness({ entry, binDir: join(root, "bin"), installRoot: root, npmCommand: npm }),
    ).rejects.toThrow(/@example\/sdk is pinned to 4\.5\.6 but nothing is installed/);
  });

  it("reads no pin state for an unpinned entry or a missing shim", async () => {
    const { pinned: _pinned, ...unpinned } = entry;

    await expect(readAcpHarnessPinState({ entry: unpinned, shimPath: "/missing" })).resolves.toBeNull();
    await expect(readAcpHarnessPinState({ entry, shimPath: "/missing" })).resolves.toEqual({
      package: { name: "@example/agent", pinned: "1.2.3" },
      dependencies: [
        { name: "@example/sdk", pinned: "4.5.6" },
        { name: "example-core", pinned: "7.8.9" },
      ],
      satisfied: false,
    });
    await expect(
      readAcpHarnessPinState({
        entry: { ...entry, pinned: { package: "@example/agent", dependencies: {} } },
        shimPath: "/missing",
      }),
    ).resolves.toMatchObject({ package: { pinned: "" }, satisfied: false });
  });

  it("refuses entries and overrides that are not exact", async () => {
    const options = { binDir: "/unused", npmCommand: "/unused" };
    const { pinned: _pinned, ...unpinned } = entry;
    const { registryId: _registryId, ...unregistered } = entry;

    await expect(installPinnedAcpHarness({ ...options, entry: unpinned })).rejects.toThrow(
      "Example (example) has no pinned install",
    );
    await expect(installPinnedAcpHarness({ ...options, entry: unregistered })).rejects.toThrow(
      "has no pinned install",
    );
    for (const spec of ["@example/agent", "@example/agent@^1.2.3"]) {
      await expect(
        installPinnedAcpHarness({ ...options, entry: { ...entry, pinned: { package: spec, dependencies: {} } } }),
      ).rejects.toThrow(/is not an exact version/);
    }
    await expect(
      installPinnedAcpHarness({
        ...options,
        entry: { ...entry, pinned: { package: "@example/agent@1.2.3", dependencies: { "example-core": "^7" } } },
      }),
    ).rejects.toThrow('npm override for example-core must be an exact version, got "^7"');
  });

  it("ignores recorded dependencies that are not a name-to-version map", async () => {
    const root = join(tmpdir(), `openma-acp-pinned-metadata-${process.pid}-${Date.now()}`);
    roots.push(root);
    const metadataPath = join(root, "registry", "example", "install.json");
    await mkdir(dirname(metadataPath), { recursive: true });
    const write = (dependencies: unknown) =>
      writeFile(metadataPath, JSON.stringify({ source: "registry", registryId: "example", shimName: "s", dependencies }));
    const read = () => readAcpRegistryInstallMetadata({ registryId: "example", binDir: root });

    for (const invalid of [["a"], "a", null, { a: 1 }]) {
      await write(invalid);
      await expect(read()).resolves.not.toHaveProperty("dependencies");
    }
    await write({ a: "1.0.0" });
    await expect(read()).resolves.toMatchObject({ dependencies: { a: "1.0.0" } });
  });
});
