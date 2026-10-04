import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, chmod, mkdir, readdir, readFile, rm, rename, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { latestNpmPackageVersion, npmVersionFromSpec, } from "./install-state.js";
const execFileAsync = promisify(execFile);
export const ACP_NPM_INSTALL_TIMEOUT_MS = 10 * 60_000;
const ACP_REGISTRY_URL = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
function currentPlatformKey() {
    const os = process.platform === "darwin"
        ? "darwin"
        : process.platform === "linux"
            ? "linux"
            : process.platform === "win32"
                ? "windows"
                : process.platform;
    const arch = process.arch === "arm64"
        ? "aarch64"
        : process.arch === "x64"
            ? "x86_64"
            : process.arch;
    return `${os}-${arch}`;
}
function currentDistribution(agent) {
    const target = agent.distribution?.binary?.[currentPlatformKey()];
    if (target) {
        return {
            installable: true,
            ...(target.args && target.args.length > 0 ? { args: target.args } : {}),
            ...(target.env && Object.keys(target.env).length > 0 ? { env: target.env } : {}),
        };
    }
    if (agent.distribution?.npx) {
        return {
            installable: true,
            ...(agent.distribution.npx.args && agent.distribution.npx.args.length > 0 ? { args: agent.distribution.npx.args } : {}),
            ...(agent.distribution.npx.env && Object.keys(agent.distribution.npx.env).length > 0 ? { env: agent.distribution.npx.env } : {}),
        };
    }
    if (agent.distribution?.uvx) {
        return {
            installable: true,
            ...(agent.distribution.uvx.args && agent.distribution.uvx.args.length > 0 ? { args: agent.distribution.uvx.args } : {}),
            ...(agent.distribution.uvx.env && Object.keys(agent.distribution.uvx.env).length > 0 ? { env: agent.distribution.uvx.env } : {}),
        };
    }
    return { installable: false };
}
function sanitizePathComponent(input) {
    const sanitized = input.replace(/[^a-zA-Z0-9._-]/g, "-");
    return sanitized.length > 0 ? sanitized : "unknown";
}
function shellQuote(value) {
    return `'${value.replace(/'/g, "'\\''")}'`;
}
function shellEnvExports(env) {
    return Object.entries(env).flatMap(([key, value]) => {
        if (value === undefined)
            return [];
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
            throw new Error(`Registry env key is not shell-safe: ${key}`);
        }
        return [`export ${key}=${shellQuote(value)}`];
    });
}
function renderShellShim(commandPath, args = [], env = {}) {
    return [
        "#!/bin/sh",
        "set -eu",
        ...shellEnvExports(env),
        `exec ${shellQuote(commandPath)}${args.length > 0 ? ` ${args.map(shellQuote).join(" ")}` : ""} "$@"`,
        "",
    ].join("\n");
}
async function writeExecutableShim(shimPath, commandPath, args = [], env = {}) {
    await mkdir(dirname(shimPath), { recursive: true });
    const stagedPath = `${shimPath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(stagedPath, renderShellShim(commandPath, args, env), "utf8");
    await chmod(stagedPath, 0o755);
    await rename(stagedPath, shimPath);
}
async function fetchBytes(url, fetchImpl) {
    const response = await fetchImpl(url);
    if (!response.ok)
        throw new Error(`Install download failed: HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
}
async function fetchRegistry(fetchImpl) {
    const response = await fetchImpl(ACP_REGISTRY_URL);
    if (!response.ok)
        throw new Error(`ACP registry unavailable: HTTP ${response.status}`);
    return await response.json();
}
export async function listAcpRegistryCatalog(options = {}) {
    const registry = await fetchRegistry(options.fetchImpl ?? fetch);
    return (registry.agents ?? [])
        .filter((agent) => typeof agent.id === "string" && agent.id.length > 0)
        .map((agent) => {
        const distribution = currentDistribution(agent);
        return {
            id: agent.id,
            name: agent.name ?? agent.id,
            ...(agent.version ? { version: agent.version } : {}),
            ...(agent.description ? { description: agent.description } : {}),
            ...(agent.website ?? agent.repository ? { homepage: agent.website ?? agent.repository } : {}),
            installable: distribution.installable,
            ...(distribution.args ? { args: distribution.args } : {}),
            ...(distribution.env ? { env: distribution.env } : {}),
        };
    });
}
function assertSafeRelativeCommand(cmd) {
    if (isAbsolute(cmd))
        throw new Error(`Registry command must be relative: ${cmd}`);
    const normalized = cmd.replace(/\\/g, "/");
    if (normalized.split("/").includes(".."))
        throw new Error(`Registry command cannot contain '..': ${cmd}`);
    return normalized.startsWith("./") ? normalized.slice(2) : normalized;
}
function archiveKind(url) {
    const path = (() => {
        try {
            return new URL(url).pathname.toLowerCase();
        }
        catch {
            return url.toLowerCase();
        }
    })();
    if (path.endsWith(".zip"))
        return "zip";
    if (path.endsWith(".tar.gz") || path.endsWith(".tgz"))
        return "tar-gz";
    if (path.endsWith(".tar.bz2") || path.endsWith(".tbz2"))
        return "tar-bz2";
    return "raw";
}
function rawBinaryFileName(url) {
    const path = (() => {
        try {
            return new URL(url).pathname;
        }
        catch {
            return url;
        }
    })();
    const name = decodeURIComponent(path.split("/").filter(Boolean).at(-1) ?? "");
    if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
        throw new Error(`Cannot determine binary file name from ${url}`);
    }
    return name;
}
function versionedInstallDir(root, registryId, version, archiveUrl) {
    const versionLabel = sanitizePathComponent(version);
    const hash = createHash("sha256").update(`${version}\0${archiveUrl}`).digest("hex").slice(0, 16);
    return join(root, "registry", sanitizePathComponent(registryId), `v_${versionLabel}_${hash}`);
}
function requireInstallVersion(version, context) {
    const trimmed = version?.trim();
    if (!trimmed) {
        throw new Error(`${context}: install version is required and could not be resolved`);
    }
    return trimmed;
}
function registryInstallMetadataPath(root, registryId) {
    return join(root, "registry", sanitizePathComponent(registryId), "install.json");
}
async function writeRegistryInstallMetadata(options, metadata) {
    const installRoot = options.installRoot ?? options.binDir;
    if (!installRoot)
        throw new Error("Install metadata requires an install root");
    const metadataPath = registryInstallMetadataPath(installRoot, options.registryId);
    await mkdir(dirname(metadataPath), { recursive: true });
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf8");
}
export async function readAcpRegistryInstallMetadata(options) {
    const installRoot = options.installRoot ?? options.binDir;
    try {
        const parsed = JSON.parse(await readFile(registryInstallMetadataPath(installRoot, options.registryId), "utf8"));
        if (parsed.source !== "registry" || parsed.registryId !== options.registryId || typeof parsed.shimName !== "string") {
            return null;
        }
        return {
            source: "registry",
            registryId: parsed.registryId,
            shimName: parsed.shimName,
            ...(typeof parsed.version === "string" && parsed.version.length > 0 ? { version: parsed.version } : {}),
            installedAt: typeof parsed.installedAt === "string" ? parsed.installedAt : "",
        };
    }
    catch {
        return null;
    }
}
/**
 * Rebuild a managed shim whose installed command moved together with the ACP
 * install root. The command is derived from its registry-relative suffix, so
 * no previous storage location is read or treated as a fallback.
 */
export async function repairRelocatedAcpRegistryShim(options) {
    const installRoot = resolve(options.installRoot ?? options.binDir);
    const metadata = await readAcpRegistryInstallMetadata(options);
    if (!metadata || metadata.shimName !== options.shimName)
        return false;
    const shimPath = join(options.binDir, options.shimName);
    const shim = await readFile(shimPath, "utf8").catch(() => "");
    const commandMatch = shim.match(/^exec '([^'\r\n]+)'/m);
    const currentCommand = commandMatch?.[1];
    if (!currentCommand)
        return false;
    if (await access(currentCommand).then(() => true, () => false))
        return false;
    const registrySuffix = join("registry", sanitizePathComponent(options.registryId));
    const marker = `${registrySuffix}/`;
    const normalizedCommand = currentCommand.replace(/\\/g, "/");
    const markerIndex = normalizedCommand.lastIndexOf(`/${marker}`);
    if (markerIndex < 0)
        return false;
    const relativeCommand = normalizedCommand.slice(markerIndex + 1);
    const repairedCommand = resolve(installRoot, relativeCommand);
    const relativeToRoot = relative(installRoot, repairedCommand);
    if (relativeToRoot.startsWith("..")
        || isAbsolute(relativeToRoot)
        || !(await access(repairedCommand).then(() => true, () => false))) {
        return false;
    }
    const repairedShim = shim.replace(shellQuote(currentCommand), shellQuote(repairedCommand));
    if (repairedShim === shim)
        return false;
    const stagedPath = `${shimPath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(stagedPath, repairedShim, "utf8");
    await chmod(stagedPath, 0o755);
    await rename(stagedPath, shimPath);
    return true;
}
function verifySha256(bytes, expected) {
    if (!expected)
        return;
    const normalized = expected.startsWith("sha256:") ? expected.slice("sha256:".length) : expected;
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual.toLowerCase() !== normalized.toLowerCase()) {
        throw new Error(`ACP registry archive checksum mismatch: expected ${normalized}, got ${actual}`);
    }
}
async function installBinaryDistribution(agent, target, options) {
    const fetchImpl = options.fetchImpl ?? fetch;
    const installRoot = options.installRoot ?? options.binDir;
    const binaryVersion = requireInstallVersion(agent.version, `${agent.name ?? agent.id} binary install`);
    const finalDir = versionedInstallDir(installRoot, options.registryId, binaryVersion, target.archive);
    const commandRelativePath = assertSafeRelativeCommand(target.cmd);
    const commandPath = resolve(finalDir, commandRelativePath);
    const relativeCommandPath = relative(resolve(finalDir), commandPath);
    if (relativeCommandPath.startsWith("..") || isAbsolute(relativeCommandPath)) {
        throw new Error(`Registry command escapes install directory: ${target.cmd}`);
    }
    try {
        await chmod(commandPath, 0o755);
    }
    catch {
        const tmpDir = `${finalDir}.tmp-${process.pid}-${Date.now()}`;
        await rm(tmpDir, { recursive: true, force: true });
        await mkdir(tmpDir, { recursive: true });
        const bytes = await fetchBytes(target.archive, fetchImpl);
        verifySha256(bytes, target.sha256);
        const kind = archiveKind(target.archive);
        const archivePath = join(tmpDir, `download${kind === "zip" ? ".zip" : kind === "tar-gz" ? ".tar.gz" : kind === "tar-bz2" ? ".tar.bz2" : extname(rawBinaryFileName(target.archive))}`);
        if (kind === "raw") {
            await writeFile(join(tmpDir, rawBinaryFileName(target.archive)), bytes);
        }
        else {
            await writeFile(archivePath, bytes);
            if (kind === "zip") {
                await execFileAsync("unzip", ["-q", archivePath, "-d", tmpDir]);
            }
            else if (kind === "tar-gz") {
                await execFileAsync("tar", ["-xzf", archivePath, "-C", tmpDir]);
            }
            else {
                await execFileAsync("tar", ["-xjf", archivePath, "-C", tmpDir]);
            }
            await rm(archivePath, { force: true });
        }
        await rm(finalDir, { recursive: true, force: true });
        await mkdir(dirname(finalDir), { recursive: true });
        await rename(tmpDir, finalDir);
        await chmod(commandPath, 0o755);
    }
    const shimPath = join(options.binDir, options.shimName);
    await writeExecutableShim(shimPath, commandPath, options.shimArgs ?? target.args ?? [], {
        ...(target.env ?? {}),
        ...(options.shimEnv ?? {}),
    });
    return { commandPath: shimPath, version: binaryVersion };
}
function packageNameFromSpec(packageSpec) {
    if (packageSpec.startsWith("@")) {
        const versionIndex = packageSpec.indexOf("@", 1);
        return versionIndex > 0 ? packageSpec.slice(0, versionIndex) : packageSpec;
    }
    const versionIndex = packageSpec.lastIndexOf("@");
    return versionIndex > 0 ? packageSpec.slice(0, versionIndex) : packageSpec;
}
function packagePathParts(packageName) {
    return packageName.split("/").filter(Boolean);
}
function isNpmTargetMissing(error) {
    const stderr = typeof error === "object" && error !== null && "stderr" in error
        ? String(error.stderr ?? "")
        : "";
    const message = error instanceof Error ? error.message : String(error);
    return /\bETARGET\b|No matching version found/i.test(`${message}\n${stderr}`);
}
async function resolvePackageVersion(prefixDir, packageSpec) {
    const packageName = packageNameFromSpec(packageSpec);
    const packageJsonPath = join(prefixDir, "node_modules", ...packagePathParts(packageName), "package.json");
    const pkg = JSON.parse(await readFile(packageJsonPath, "utf8"));
    if (typeof pkg.version === "string" && pkg.version.length > 0) {
        return pkg.version;
    }
    throw new Error(`${packageSpec} is installed but package.json is missing a version`);
}
async function resolvePackageBin(prefixDir, packageSpec) {
    const packageName = packageNameFromSpec(packageSpec);
    const packageJsonPath = join(prefixDir, "node_modules", ...packagePathParts(packageName), "package.json");
    const pkg = JSON.parse(await readFile(packageJsonPath, "utf8"));
    const unscopedName = basename(packageName);
    const binName = typeof pkg.bin === "string"
        ? unscopedName
        : pkg.bin?.[unscopedName]
            ? unscopedName
            : Object.keys(pkg.bin ?? {})[0];
    if (!binName)
        throw new Error(`${packageSpec} does not expose an executable bin`);
    return join(prefixDir, "node_modules", ".bin", process.platform === "win32" ? `${binName}.cmd` : binName);
}
async function resolveNpmInstallVersion(packageSpec, options) {
    if (options.explicitVersion?.trim())
        return options.explicitVersion.trim();
    const fromSpec = npmVersionFromSpec(packageSpec);
    if (fromSpec)
        return fromSpec;
    const latest = await latestNpmPackageVersion(packageNameFromSpec(packageSpec), {
        npmRegistryUrls: options.npmRegistryUrls,
        fetchImpl: options.fetchImpl,
    });
    return requireInstallVersion(latest, `Could not resolve npm version for ${packageNameFromSpec(packageSpec)}`);
}
async function installNpxDistribution(npx, options) {
    const installRoot = options.installRoot ?? options.binDir;
    const resolvedVersion = await resolveNpmInstallVersion(npx.package, {
        explicitVersion: options.version,
        npmRegistryUrls: options.npmRegistryUrls,
        fetchImpl: options.fetchImpl,
    });
    const prefixDir = versionedInstallDir(installRoot, options.registryId, resolvedVersion, `npx:${npx.package}`);
    let packageBin;
    try {
        packageBin = await resolvePackageBin(prefixDir, npx.package);
        await access(packageBin);
    }
    catch {
        const stagedDir = `${prefixDir}.tmp-${process.pid}-${Date.now()}`;
        await rm(stagedDir, { recursive: true, force: true });
        try {
            const npmOptions = {
                env: {
                    ...process.env,
                    ...(options.env ?? {}),
                    ...(options.npmEnv ?? {}),
                },
                timeout: ACP_NPM_INSTALL_TIMEOUT_MS,
                maxBuffer: 1024 * 1024,
            };
            const installArgs = [
                "install",
                "--prefix",
                stagedDir,
                "--omit=dev",
                "--no-audit",
                "--no-fund",
            ];
            const registryUrls = options.npmRegistryUrls?.length
                ? options.npmRegistryUrls
                : [undefined];
            let installed = false;
            let lastError;
            for (const registryUrl of registryUrls) {
                const registryArgs = registryUrl ? ["--registry", registryUrl] : [];
                try {
                    await execFileAsync(options.npmCommand ?? "npm", [
                        ...(options.npmCommandArgs ?? []),
                        ...installArgs,
                        ...registryArgs,
                        "--prefer-offline",
                        npx.package,
                    ], npmOptions);
                    installed = true;
                    break;
                }
                catch (error) {
                    lastError = error;
                    if (isNpmTargetMissing(error)) {
                        await rm(stagedDir, { recursive: true, force: true });
                        try {
                            await execFileAsync(options.npmCommand ?? "npm", [
                                ...(options.npmCommandArgs ?? []),
                                ...installArgs,
                                ...registryArgs,
                                "--prefer-online",
                                npx.package,
                            ], npmOptions);
                            installed = true;
                            break;
                        }
                        catch (onlineError) {
                            lastError = onlineError;
                        }
                    }
                    await rm(stagedDir, { recursive: true, force: true });
                }
            }
            if (!installed)
                throw lastError;
            const stagedBin = await resolvePackageBin(stagedDir, npx.package);
            await access(stagedBin);
            await rm(prefixDir, { recursive: true, force: true });
            await mkdir(dirname(prefixDir), { recursive: true });
            await rename(stagedDir, prefixDir);
        }
        catch (error) {
            await rm(stagedDir, { recursive: true, force: true });
            throw error;
        }
        packageBin = await resolvePackageBin(prefixDir, npx.package);
    }
    const installedVersion = await resolvePackageVersion(prefixDir, npx.package);
    const shimPath = join(options.binDir, options.shimName);
    await writeExecutableShim(shimPath, packageBin, options.shimArgs ?? npx.args ?? [], {
        ...(npx.env ?? {}),
        ...(options.shimEnv ?? {}),
    });
    return { commandPath: shimPath, version: installedVersion };
}
function pythonVersionFromSpec(packageSpec) {
    const name = pythonPackageNameFromSpec(packageSpec);
    const remainder = packageSpec.slice(name.length).trim();
    if (!remainder.startsWith("@"))
        return undefined;
    const version = remainder.slice(1).trim();
    return version.length > 0 ? version : undefined;
}
async function readInstalledUvxVersion(toolDir, packageName) {
    const normalizedName = packageName.replace(/-/g, "_").toLowerCase();
    let entries;
    try {
        entries = await readdir(toolDir, { recursive: true });
    }
    catch {
        return undefined;
    }
    for (const entry of entries) {
        if (!entry.endsWith(".dist-info/METADATA") && !entry.endsWith(".dist-info\\METADATA"))
            continue;
        if (!entry.toLowerCase().includes(normalizedName))
            continue;
        try {
            const metadata = await readFile(join(toolDir, entry), "utf8");
            const versionLine = metadata
                .split("\n")
                .find((line) => line.startsWith("Version:"));
            const version = versionLine?.slice("Version:".length).trim();
            if (version)
                return version;
        }
        catch {
            // Keep scanning other dist-info directories.
        }
    }
    return undefined;
}
async function installUvxDistribution(uvx, options) {
    const installRoot = options.installRoot ?? options.binDir;
    const packageName = pythonPackageNameFromSpec(uvx.package);
    const resolvedVersion = requireInstallVersion(options.version ?? pythonVersionFromSpec(uvx.package), `${packageName} uvx install`);
    const prefixDir = versionedInstallDir(installRoot, options.registryId, resolvedVersion, `uvx:${uvx.package}`);
    const toolDir = join(prefixDir, "tools");
    const toolBinDir = join(prefixDir, "bin");
    await mkdir(toolBinDir, { recursive: true });
    await execFileAsync("uv", ["tool", "install", "--force", uvx.package], {
        env: {
            ...process.env,
            ...(options.env ?? {}),
            UV_TOOL_DIR: toolDir,
            UV_TOOL_BIN_DIR: toolBinDir,
        },
        timeout: 120_000,
        maxBuffer: 1024 * 1024,
    });
    const packageBin = await firstExecutableInDir(toolBinDir, packageName);
    const installedVersion = await readInstalledUvxVersion(toolDir, packageName) ?? resolvedVersion;
    const shimPath = join(options.binDir, options.shimName);
    await writeExecutableShim(shimPath, packageBin, options.shimArgs ?? uvx.args ?? [], {
        ...(uvx.env ?? {}),
        ...(options.shimEnv ?? {}),
    });
    return { commandPath: shimPath, version: installedVersion };
}
function pythonPackageNameFromSpec(packageSpec) {
    return (packageSpec
        .split(/[<>=!~\[]/, 1)[0]
        ?? packageSpec)
        .trim()
        .replace(/_/g, "-");
}
async function firstExecutableInDir(binDir, preferredName) {
    const entries = await readdir(binDir).catch(() => []);
    const preferred = [
        preferredName,
        preferredName.replace(/-/g, "_"),
        basename(preferredName),
    ];
    for (const name of [...preferred, ...entries]) {
        if (!entries.includes(name))
            continue;
        const candidate = join(binDir, name);
        try {
            await access(candidate);
            return candidate;
        }
        catch {
            // Keep looking; uv may create several helper files depending on platform.
        }
    }
    throw new Error(`uv did not expose an executable for ${preferredName}`);
}
export async function installAcpRegistryAgent(options) {
    const fetchImpl = options.fetchImpl ?? fetch;
    const registry = options.registryAgent ? null : await fetchRegistry(fetchImpl);
    const agent = options.registryAgent ?? registry?.agents?.find((candidate) => candidate.id === options.registryId);
    if (!agent)
        throw new Error(`ACP registry agent not found: ${options.registryId}`);
    if (agent.id !== options.registryId) {
        throw new Error(`ACP registry snapshot mismatch: expected ${options.registryId}, got ${agent.id}`);
    }
    const platformKey = currentPlatformKey();
    const target = agent.distribution?.binary?.[platformKey];
    let result;
    if (target) {
        result = await installBinaryDistribution(agent, target, {
            registryId: options.registryId,
            shimName: options.shimName,
            binDir: options.binDir,
            installRoot: options.installRoot,
            fetchImpl,
            shimArgs: options.shimArgs,
            shimEnv: options.shimEnv,
        });
    }
    else if (agent.distribution?.npx) {
        result = await installNpxDistribution(agent.distribution.npx, {
            registryId: options.registryId,
            shimName: options.shimName,
            binDir: options.binDir,
            installRoot: options.installRoot,
            npmCommand: options.npmCommand,
            npmCommandArgs: options.npmCommandArgs,
            npmEnv: options.npmEnv,
            npmRegistryUrls: options.npmRegistryUrls,
            fetchImpl,
            env: options.env,
            shimArgs: options.shimArgs,
            shimEnv: options.shimEnv,
            version: agent.version,
        });
    }
    else if (agent.distribution?.uvx) {
        result = await installUvxDistribution(agent.distribution.uvx, {
            registryId: options.registryId,
            shimName: options.shimName,
            binDir: options.binDir,
            installRoot: options.installRoot,
            env: options.env,
            shimArgs: options.shimArgs,
            shimEnv: options.shimEnv,
            version: agent.version,
        });
    }
    else {
        throw new Error(`${agent.name ?? agent.id} has no registry install for ${platformKey}`);
    }
    const installedVersion = result.version ?? agent.version;
    await writeRegistryInstallMetadata(options, {
        source: "registry",
        registryId: options.registryId,
        shimName: options.shimName,
        ...(installedVersion ? { version: installedVersion } : {}),
        installedAt: new Date().toISOString(),
    });
    return result;
}
export { readAcpHarnessInstallState, OPENMA_NPM_HARNESS_IDS, usesOpenMaNpmLatestSource, latestNpmPackageVersion, npmPackageNameFromSpec, npmVersionFromSpec, readInstalledNpmPackageVersion, installedNpmPackageVersionFromShim, isStrictlyNewerVersion, } from "./install-state.js";
export async function installManagedAdapter(options) {
    const fetchImpl = options.fetchImpl ?? fetch;
    const bytes = await fetchBytes(options.downloadUrl, fetchImpl);
    await mkdir(options.binDir, { recursive: true });
    const commandPath = join(options.binDir, basename(options.command));
    await writeFile(commandPath, bytes);
    await chmod(commandPath, 0o755);
    return { commandPath };
}
export async function uninstallAcpRegistryAgent(options) {
    const installRoot = options.installRoot ?? options.binDir;
    await rm(join(options.binDir, options.shimName), { force: true });
    await rm(join(installRoot, "registry", sanitizePathComponent(options.registryId)), {
        recursive: true,
        force: true,
    });
}
export async function uninstallManagedAdapter(options) {
    await rm(join(options.binDir, basename(options.command)), { force: true });
}
//# sourceMappingURL=installer.js.map