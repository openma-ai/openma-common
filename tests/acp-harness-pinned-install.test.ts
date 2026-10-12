import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import {
  acpHarnessPinnedPackages,
  acpLauncherInvocation,
  compareCodePoints,
  installAcpRegistryAgent,
  installPinnedAcpHarness,
  pinnedAcpHarnessPaths,
  readAcpHarnessPinState,
  readAcpRegistryInstallMetadata,
} from "../src/acp-harnesses/installer.js";
import { exactDependencyPins } from "../src/acp-harnesses/install-state.js";
import { OVERLAY_AGENTS, type KnownAgentEntry } from "../src/acp-harnesses/known-agents.js";
import { launcherTarget } from "../src/acp-harnesses/launcher.js";

const execFileAsync = promisify(execFile);
const windows = process.platform === "win32";
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const entry: KnownAgentEntry = {
  id: "example",
  label: "Example",
  spec: { command: "openma-acp-example", args: ["acp", "two words"], env: { EXAMPLE: "1 %PATH% & 2" } },
  registryId: "example",
  installSource: "registry",
  pinned: {
    package: "@example/agent@1.2.3",
    dependencies: { "@example/sdk": "4.5.6", "example-core": "7.8.9" },
  },
};

/**
 * A stand-in for npm that runs on every platform (`node fake-npm.mjs …`) and
 * honours `overrides` the way npm does: it installs the requested package
 * and, for each override in the package.json at the prefix, that dependency
 * at the overridden version. Like npm it writes both a POSIX and a `.cmd`
 * bin; each starts `cli.mjs`, which records its arguments and environment.
 * TEST_DRIFT installs one dependency at another version, TEST_SKIP leaves one
 * out, TEST_ETARGET fails the offline attempt.
 */
async function fakeNpm(): Promise<{ root: string; npm: string; calls: string; binOut: string }> {
  // A space in the path exercises quoting in the launcher and the npm call.
  const root = join(tmpdir(), `openma acp pinned-${process.pid}-${Date.now()}-${roots.length}`);
  roots.push(root);
  const npm = join(root, "fake-npm.mjs");
  const calls = join(root, "npm-calls.log");
  const binOut = join(root, "bin-out.json");
  await mkdir(root, { recursive: true });
  await writeFile(npm, `import { appendFile, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
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
const write = async (name, version) => {
  const dir = join(prefix, "node_modules", ...name.split("/"));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "package.json"), JSON.stringify({ version, bin: { [basename(name)]: "cli.mjs" } }));
  return dir;
};
const name = spec.slice(0, at);
const cli = join(await write(name, spec.slice(at + 1)), "cli.mjs");
await writeFile(cli, 'import { writeFileSync } from "node:fs";\\nwriteFileSync(process.env.TEST_BIN_OUT, JSON.stringify({ argv: process.argv.slice(2), example: process.env.EXAMPLE ?? null }));\\n');
const bin = join(prefix, "node_modules", ".bin");
await mkdir(bin, { recursive: true });
// Relative to the bin, as npm's own shims are: the prefix is renamed after the install.
const relative = name.split("/").join("/") + "/cli.mjs";
await writeFile(join(bin, basename(name)), "#!/bin/sh\\nexec '" + process.execPath + "' \\"$(dirname \\"$0\\")/../" + relative + "\\" \\"$@\\"\\n");
await chmod(join(bin, basename(name)), 0o755);
await writeFile(join(bin, basename(name) + ".cmd"), '@"' + process.execPath + '" "%~dp0..\\\\' + relative.split("/").join("\\\\") + '" %*\\r\\n');
for (const [dependency, version] of Object.entries(JSON.parse(manifest).overrides ?? {})) {
  if (dependency === process.env.TEST_SKIP) continue;
  await write(dependency, dependency === process.env.TEST_DRIFT ? "9.9.9" : version);
}
`, "utf8");
  return { root, npm, calls, binOut };
}

/** Options that run the stand-in npm without a shell, as hosts with a bundled Node do. */
function viaNode(npm: string) {
  return { npmCommand: process.execPath, npmCommandArgs: [npm] };
}

async function runLauncher(commandPath: string, args: string[], binOut: string) {
  const invocation = acpLauncherInvocation(commandPath, args);
  await execFileAsync(invocation.file, invocation.args, {
    env: { ...process.env, TEST_BIN_OUT: binOut },
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
  });
  return JSON.parse(await readFile(binOut, "utf8")) as { argv: string[]; example: string | null };
}

describe("pinned ACP harness install", () => {
  it("pins the Pi adapter and every Pi SDK package it resolves to one exact version", () => {
    const pi = OVERLAY_AGENTS.find((agent) => agent.id === "pi-acp")!;
    const pins = acpHarnessPinnedPackages(pi);

    expect(pins.package.name).toBe("@openma/pi-acp");
    expect(pins.dependencies.length).toBeGreaterThan(0);
    for (const [name, version] of pins.dependencies) {
      expect(name).toMatch(/^@earendil-works\//);
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("installs on this platform, and the launcher it writes starts the pinned package", async () => {
    const { root, npm, calls, binOut } = await fakeNpm();
    const binDir = join(root, "bin");
    const paths = pinnedAcpHarnessPaths(entry, binDir);

    const result = await installPinnedAcpHarness({ entry, binDir, installRoot: root, ...viaNode(npm) });

    expect(result).toEqual({
      commandPath: paths.launcherPath,
      version: "1.2.3",
      dependencies: { "@example/sdk": "4.5.6", "example-core": "7.8.9" },
    });
    expect(paths.launcherName).toBe(windows ? "openma-acp-example-pinned.cmd" : "openma-acp-example-pinned");
    const call = JSON.parse((await readFile(calls, "utf8")).trim()) as {
      args: string[];
      manifest: Record<string, unknown>;
    };
    expect(call.args.at(-1)).toBe("@example/agent@1.2.3");
    expect(call.manifest).toEqual({
      private: true,
      overrides: { "@example/sdk": "4.5.6", "example-core": "7.8.9" },
    });

    // Run the launcher for real: fixed arguments, the caller's arguments and
    // the entry's variables all reach the package bin, quoting intact.
    await expect(runLauncher(result.commandPath, ["--flag", "a b"], binOut)).resolves.toEqual({
      argv: ["acp", "two words", "--flag", "a b"],
      example: "1 %PATH% & 2",
    });

    await expect(
      readAcpRegistryInstallMetadata({ registryId: paths.stateId, binDir, installRoot: root }),
    ).resolves.toMatchObject({
      registryId: "example-pinned",
      shimName: paths.launcherName,
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
  });

  it("finds npm on PATH, through cmd.exe where npm is a .cmd file", async () => {
    const { root, npm, binOut } = await fakeNpm();
    const pathDir = join(root, "path dir");
    await mkdir(pathDir);
    await writeFile(join(pathDir, "npm"), `#!/bin/sh\nexec '${process.execPath}' '${npm}' "$@"\n`);
    await chmod(join(pathDir, "npm"), 0o755);
    await writeFile(join(pathDir, "npm.cmd"), `@"${process.execPath}" "${npm}" %*\r\n`);
    const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path") ?? "PATH";

    const result = await installPinnedAcpHarness({
      entry,
      binDir: join(root, "bin"),
      env: { ...process.env, [pathKey]: `${pathDir}${delimiter}${process.env[pathKey] ?? ""}` },
    });

    expect(result.version).toBe("1.2.3");
    await expect(runLauncher(result.commandPath, [], binOut)).resolves.toMatchObject({
      argv: ["acp", "two words"],
    });
  });

  it.each(["win32", "linux"] as const)("lays out a %s install with that platform's launcher", async (platform) => {
    const { root, npm } = await fakeNpm();
    const binDir = join(root, "bin");
    const paths = pinnedAcpHarnessPaths(entry, binDir, { platform });

    const result = await installPinnedAcpHarness({ entry, binDir, platform, ...viaNode(npm) });

    const launcher = await readFile(result.commandPath, "utf8");
    const target = launcherTarget(launcher)!;
    if (platform === "win32") {
      expect(paths.launcherName).toBe("openma-acp-example-pinned.cmd");
      expect(launcher.split("\r\n")).toEqual([
        "@echo off",
        "setlocal",
        'set "EXAMPLE=1 %%PATH%% & 2"',
        `call "${target}" acp "two words" %*`,
        "exit /b %ERRORLEVEL%",
        "",
      ]);
      expect(target.endsWith(join("node_modules", ".bin", "agent.cmd"))).toBe(true);
    } else {
      expect(paths.launcherName).toBe("openma-acp-example-pinned");
      expect(launcher).toContain("export EXAMPLE='1 %PATH% & 2'");
      expect(launcher).toContain(`exec '${target}' 'acp' 'two words' "$@"`);
      expect(target.endsWith(join("node_modules", ".bin", "agent"))).toBe(true);
    }
    // The state reader follows either launcher to the same npm prefix.
    await expect(readAcpHarnessPinState({ entry, shimPath: result.commandPath })).resolves.toMatchObject({
      satisfied: true,
    });
  });

  it("shares a bin directory and install root with the product install without touching it", async () => {
    const { root, npm } = await fakeNpm();
    const binDir = join(root, "bin");
    const product = () =>
      installAcpRegistryAgent({
        registryId: "example",
        registryAgent: { id: "example", version: "2.0.0", distribution: { npx: { package: "@example/agent@2.0.0" } } },
        shimName: "openma-acp-example",
        binDir,
        installRoot: root,
        ...viaNode(npm),
      });
    const snapshot = async () => ({
      launcher: await readFile(join(binDir, "openma-acp-example"), "utf8"),
      state: await readFile(join(root, "registry", "example", "install.json"), "utf8"),
    });

    const installedProduct = await product();
    const before = await snapshot();
    const pinned = await installPinnedAcpHarness({ entry, binDir, installRoot: root, ...viaNode(npm) });

    // The product's launcher and install.json are byte-for-byte what they were.
    expect(await snapshot()).toEqual(before);
    expect(pinned.commandPath).not.toBe(installedProduct.commandPath);
    expect(JSON.parse(before.state)).toMatchObject({ registryId: "example", version: "2.0.0" });
    expect(JSON.parse(before.state)).not.toHaveProperty("dependencies");

    // And the other way round: a product upgrade leaves the pinned install alone.
    const pinnedPaths = pinnedAcpHarnessPaths(entry, binDir);
    const pinnedBefore = {
      launcher: await readFile(pinnedPaths.launcherPath, "utf8"),
      state: await readFile(join(root, "registry", pinnedPaths.stateId, "install.json"), "utf8"),
    };
    await product();
    expect({
      launcher: await readFile(pinnedPaths.launcherPath, "utf8"),
      state: await readFile(join(root, "registry", pinnedPaths.stateId, "install.json"), "utf8"),
    }).toEqual(pinnedBefore);
    await expect(readAcpHarnessPinState({ entry, shimPath: pinned.commandPath })).resolves.toMatchObject({
      package: { installed: "1.2.3" },
      satisfied: true,
    });
  });

  it("writes the overrides again for the online retry", async () => {
    const { root, npm, calls } = await fakeNpm();

    await installPinnedAcpHarness({
      entry,
      binDir: join(root, "bin"),
      ...viaNode(npm),
      env: { ...process.env, TEST_ETARGET: "1" },
    });

    const attempts = (await readFile(calls, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as {
      args: string[];
      manifest: { overrides?: unknown };
    });
    expect(attempts.map(({ args }) => args.includes("--prefer-online"))).toEqual([false, true]);
    expect(attempts[1]!.manifest.overrides).toEqual(entry.pinned!.dependencies);
  });

  it("fails when npm installed a pinned dependency at another version, or not at all", async () => {
    const { root, npm } = await fakeNpm();
    const install = (variable: string) =>
      installPinnedAcpHarness({
        entry,
        binDir: join(root, variable),
        installRoot: join(root, variable),
        ...viaNode(npm),
        env: { ...process.env, [variable]: "example-core" },
      });

    await expect(install("TEST_DRIFT")).rejects.toThrow(/example-core is pinned to 7\.8\.9 but 9\.9\.9 is installed/);
    await expect(install("TEST_SKIP")).rejects.toThrow(/example-core is pinned to 7\.8\.9 but nothing is installed/);
  });

  it("reports an install that no longer matches the pins", async () => {
    const { root, npm } = await fakeNpm();
    const options = { entry, binDir: join(root, "bin"), installRoot: root, ...viaNode(npm) };
    const result = await installPinnedAcpHarness(options);
    const prefix = dirname(dirname(dirname(launcherTarget(await readFile(result.commandPath, "utf8"))!)));
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
    await expect(installPinnedAcpHarness(options)).rejects.toThrow(
      /@example\/sdk is pinned to 4\.5\.6 but nothing is installed/,
    );
  });

  it("reads no pin state for an unpinned entry, and an unsatisfied one for a missing launcher", async () => {
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
  });

  it("refuses the same inexact pins when installing and when reading state", async () => {
    const options = { binDir: "/unused", npmCommand: "/unused" };
    const { pinned: _pinned, ...unpinned } = entry;
    const { registryId: _registryId, ...unregistered } = entry;
    const inexact: Array<[KnownAgentEntry, string | RegExp]> = [
      [{ ...entry, pinned: { package: "@example/agent", dependencies: {} } }, /pins @example\/agent, which is not an exact version/],
      [{ ...entry, pinned: { package: "@example/agent@^1.2.3", dependencies: {} } }, /is not an exact version/],
      [
        { ...entry, pinned: { package: "@example/agent@1.2.3", dependencies: { "example-core": "^7" } } },
        'npm override for example-core must be an exact version, got "^7"',
      ],
    ];

    for (const [bad, message] of inexact) {
      await expect(installPinnedAcpHarness({ ...options, entry: bad })).rejects.toThrow(message);
      await expect(readAcpHarnessPinState({ entry: bad, shimPath: "/missing" })).rejects.toThrow(message);
    }
    await expect(installPinnedAcpHarness({ ...options, entry: unpinned })).rejects.toThrow(
      "Example (example) has no pinned install",
    );
    await expect(installPinnedAcpHarness({ ...options, entry: unregistered })).rejects.toThrow(
      "has no pinned install",
    );
    expect(() => acpHarnessPinnedPackages(unregistered)).toThrow("has no pinned install");
  });

  it("refuses npm overrides for a harness that does not install from npm", async () => {
    const platformKey = `${process.platform === "win32" ? "windows" : process.platform}-${
      process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : process.arch
    }`;
    const install = (distribution: Record<string, unknown>) =>
      installAcpRegistryAgent({
        registryId: "example",
        registryAgent: { id: "example", name: "Example", version: "1.0.0", distribution },
        shimName: "example",
        binDir: "/unused",
        npmOverrides: { "example-core": "7.8.9" },
      });
    const message = `Example does not install from npm on ${platformKey}, so npmOverrides cannot be applied`;

    await expect(install({ uvx: { package: "example==1.0.0" } })).rejects.toThrow(message);
    await expect(
      installAcpRegistryAgent({
        registryId: "nameless",
        registryAgent: { id: "nameless", distribution: {} },
        shimName: "nameless",
        binDir: "/unused",
        npmOverrides: { "example-core": "7.8.9" },
      }),
    ).rejects.toThrow(`nameless does not install from npm on ${platformKey}`);
    // A binary target wins over npx on this platform, so the overrides would be dropped.
    await expect(
      install({
        binary: { [platformKey]: { archive: "https://example.test/a.tar.gz", cmd: "./agent" } },
        npx: { package: "@example/agent@1.0.0" },
      }),
    ).rejects.toThrow(message);
  });

  it("applies and records npm overrides on an ordinary registry install too", async () => {
    const { root, npm } = await fakeNpm();
    const binDir = join(root, "bin");

    const result = await installAcpRegistryAgent({
      registryId: "example",
      registryAgent: { id: "example", version: "1.2.3", distribution: { npx: { package: "@example/agent@1.2.3" } } },
      shimName: "openma-acp-example",
      binDir,
      installRoot: root,
      npmOverrides: { "example-core": "7.8.9" },
      ...viaNode(npm),
    });

    expect(result.dependencies).toEqual({ "example-core": "7.8.9" });
    await expect(
      readAcpRegistryInstallMetadata({ registryId: "example", binDir, installRoot: root }),
    ).resolves.toMatchObject({ version: "1.2.3", dependencies: { "example-core": "7.8.9" } });
  });

  it("orders pins by code point, whatever the machine's locale", () => {
    const names = ["b", "B", "_x", "a", "@scope/z", "Z", "é"];
    const ordered = exactDependencyPins(Object.fromEntries(names.map((name) => [name, "1.0.0"]))).map(([name]) => name);

    expect(ordered).toEqual(["@scope/z", "B", "Z", "_x", "a", "b", "é"]);
    // A locale-aware sort puts these elsewhere, and differently per locale.
    expect([...names].sort(new Intl.Collator("en").compare)).not.toEqual(ordered);
    expect(compareCodePoints("B", "a")).toBe(-1);
    expect(compareCodePoints("a", "B")).toBe(1);
    expect(compareCodePoints("a", "a")).toBe(0);
  });

  it("names the pinned launcher and state apart from the product's, whatever the command path looks like", () => {
    expect(pinnedAcpHarnessPaths(entry, "/bin", { platform: "linux" })).toEqual({
      stateId: "example-pinned",
      launcherName: "openma-acp-example-pinned",
      launcherPath: join("/bin", "openma-acp-example-pinned"),
    });
    const { registryId: _registryId, ...unregistered } = entry;
    expect(
      pinnedAcpHarnessPaths(
        { ...unregistered, spec: { command: "C:\\tools\\openma-acp-example" } },
        "/bin",
        { platform: "win32" },
      ),
    ).toMatchObject({ stateId: "example-pinned", launcherName: "openma-acp-example-pinned.cmd" });
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
