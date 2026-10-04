import { access, readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
/** Harness ids whose latest version comes from npm, not the public ACP registry snapshot. */
export const OPENMA_NPM_HARNESS_IDS = new Set(["pi-acp", "dsh-acp"]);
export function usesOpenMaNpmLatestSource(entry) {
    const registryId = entry.registryId ?? entry.id;
    return OPENMA_NPM_HARNESS_IDS.has(registryId) || OPENMA_NPM_HARNESS_IDS.has(entry.id);
}
export async function readAcpHarnessInstallState(options) {
    const installRoot = options.installRoot ?? options.binDir;
    const registryLatestVersion = usesOpenMaNpmLatestSource(options.entry)
        ? undefined
        : options.entry.version;
    if (!options.entry.installSource) {
        return {
            installed: false,
            ...(registryLatestVersion ? { latestVersion: registryLatestVersion } : {}),
        };
    }
    const shimPath = join(options.binDir, basename(options.entry.spec.command));
    const installed = await access(shimPath).then(() => true, () => false);
    if (!installed) {
        return {
            installed: false,
            ...(registryLatestVersion ? { latestVersion: registryLatestVersion } : {}),
        };
    }
    const npmPackageName = options.entry.registryDistribution?.npx?.package
        ? npmPackageNameFromSpec(options.entry.registryDistribution.npx.package)
        : undefined;
    const registryId = options.entry.registryId;
    const [metadata, installedNpmVersion, npmLatestVersion] = await Promise.all([
        options.entry.installSource === "registry" && registryId
            ? readRegistryInstallMetadata(installRoot, registryId)
            : Promise.resolve(null),
        npmPackageName
            ? readInstalledNpmPackageVersion({
                shimPath,
                packageName: npmPackageName,
                installRoot,
                registryId,
            })
            : Promise.resolve(undefined),
        !registryLatestVersion && npmPackageName && usesOpenMaNpmLatestSource(options.entry)
            ? latestNpmPackageVersion(npmPackageName, {
                fetchImpl: options.fetchImpl,
                npmRegistryUrls: options.npmRegistryUrls,
            })
            : Promise.resolve(undefined),
    ]);
    const installedVersion = installedNpmVersion ?? metadata?.version;
    const latestVersion = registryLatestVersion ?? npmLatestVersion;
    const updateAvailable = options.entry.installSource === "registry"
        && Boolean(installedVersion)
        && Boolean(latestVersion)
        && isStrictlyNewerVersion(latestVersion, installedVersion);
    return {
        installed: true,
        ...(installedVersion ? { installedVersion } : {}),
        ...(latestVersion ? { latestVersion } : {}),
        ...(updateAvailable ? { updateAvailable: true } : {}),
    };
}
export function npmPackageNameFromSpec(packageSpec) {
    if (packageSpec.startsWith("@")) {
        const versionIndex = packageSpec.indexOf("@", 1);
        return versionIndex > 0 ? packageSpec.slice(0, versionIndex) : packageSpec;
    }
    const versionIndex = packageSpec.lastIndexOf("@");
    return versionIndex > 0 ? packageSpec.slice(0, versionIndex) : packageSpec;
}
export function npmVersionFromSpec(packageSpec) {
    if (packageSpec.startsWith("@")) {
        const versionIndex = packageSpec.indexOf("@", 1);
        return versionIndex > 0 ? packageSpec.slice(versionIndex + 1) : undefined;
    }
    const versionIndex = packageSpec.lastIndexOf("@");
    return versionIndex > 0 ? packageSpec.slice(versionIndex + 1) : undefined;
}
export async function latestNpmPackageVersion(packageName, options = {}) {
    const fetchImpl = options.fetchImpl ?? fetch;
    const registryUrls = options.npmRegistryUrls?.length
        ? options.npmRegistryUrls
        : [undefined];
    for (const registryUrl of registryUrls) {
        try {
            const base = registryUrl ?? "https://registry.npmjs.org";
            const url = `${base.replace(/\/$/, "")}/${encodeURIComponent(packageName)}`;
            const response = await fetchImpl(url, {
                headers: { accept: "application/vnd.npm.install-v1+json" },
                signal: AbortSignal.timeout(5_000),
            });
            if (!response.ok)
                continue;
            const parsed = await response.json();
            const latest = parsed["dist-tags"]?.latest;
            if (typeof latest === "string" && latest.length > 0) {
                return latest;
            }
        }
        catch {
            // Try the next registry mirror.
        }
    }
    return undefined;
}
export async function readInstalledNpmPackageVersion(options) {
    const fromShim = await installedNpmPackageVersionFromShim(options.shimPath, options.packageName);
    if (fromShim)
        return fromShim;
    if (!options.installRoot || !options.registryId)
        return undefined;
    return await scanRegistryInstallPackageVersion(options.installRoot, options.registryId, options.packageName);
}
export async function installedNpmPackageVersionFromShim(shimPath, packageName) {
    try {
        const shim = await readFile(shimPath, "utf8");
        const commandPath = shim.match(/^exec\s+'([^']+)'(?:\s|$)/m)?.[1];
        if (!commandPath)
            return undefined;
        return await readPackageJsonVersion(join(dirnameFromShim(commandPath), "node_modules", ...packageName.split("/"), "package.json"));
    }
    catch {
        return undefined;
    }
}
function dirnameFromShim(commandPath) {
    const normalized = commandPath.replaceAll("\\", "/");
    const marker = "/node_modules/.bin/";
    const markerIndex = normalized.lastIndexOf(marker);
    if (markerIndex < 0) {
        throw new Error(`Shim does not point at an npm prefix: ${commandPath}`);
    }
    return normalized.slice(0, markerIndex);
}
async function scanRegistryInstallPackageVersion(installRoot, registryId, packageName) {
    const registryDir = join(installRoot, "registry", sanitizePathComponent(registryId));
    let entries;
    try {
        entries = await readdir(registryDir);
    }
    catch {
        return undefined;
    }
    for (const entry of entries) {
        if (!entry.startsWith("v_"))
            continue;
        const version = await readPackageJsonVersion(join(registryDir, entry, "node_modules", ...packageName.split("/"), "package.json"));
        if (version)
            return version;
    }
    return undefined;
}
async function readPackageJsonVersion(packageJsonPath) {
    try {
        const parsed = JSON.parse(await readFile(packageJsonPath, "utf8"));
        return typeof parsed.version === "string" && parsed.version.length > 0
            ? parsed.version
            : undefined;
    }
    catch {
        return undefined;
    }
}
async function readRegistryInstallMetadata(installRoot, registryId) {
    try {
        const parsed = JSON.parse(await readFile(join(installRoot, "registry", sanitizePathComponent(registryId), "install.json"), "utf8"));
        if (parsed.source !== "registry" || parsed.registryId !== registryId || typeof parsed.shimName !== "string") {
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
function sanitizePathComponent(input) {
    const sanitized = input.replace(/[^a-zA-Z0-9._-]/g, "-");
    return sanitized.length > 0 ? sanitized : "unknown";
}
export function isStrictlyNewerVersion(candidate, current) {
    if (!candidate || !current)
        return false;
    const parsedCandidate = parseSemver(candidate);
    const parsedCurrent = parseSemver(current);
    if (!parsedCandidate || !parsedCurrent)
        return false;
    return compareSemver(parsedCandidate, parsedCurrent) > 0;
}
function parseSemver(version) {
    const match = version.trim().match(/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/);
    if (!match)
        return null;
    const core = match.slice(1, 4).map(Number);
    if (core.some((part) => !Number.isSafeInteger(part)))
        return null;
    return {
        core: core,
        prerelease: match[4]?.split(".") ?? [],
    };
}
function compareSemver(left, right) {
    for (let index = 0; index < left.core.length; index += 1) {
        const difference = left.core[index] - right.core[index];
        if (difference !== 0)
            return difference;
    }
    if (left.prerelease.length === 0 || right.prerelease.length === 0) {
        return right.prerelease.length - left.prerelease.length;
    }
    const length = Math.max(left.prerelease.length, right.prerelease.length);
    for (let index = 0; index < length; index += 1) {
        const leftPart = left.prerelease[index];
        const rightPart = right.prerelease[index];
        if (leftPart === undefined)
            return -1;
        if (rightPart === undefined)
            return 1;
        if (leftPart === rightPart)
            continue;
        const leftIsNumeric = /^\d+$/.test(leftPart);
        const rightIsNumeric = /^\d+$/.test(rightPart);
        if (leftIsNumeric && rightIsNumeric) {
            const normalizedLeft = leftPart.replace(/^0+(?=\d)/, "");
            const normalizedRight = rightPart.replace(/^0+(?=\d)/, "");
            if (normalizedLeft.length !== normalizedRight.length) {
                return normalizedLeft.length - normalizedRight.length;
            }
            return normalizedLeft < normalizedRight ? -1 : 1;
        }
        if (leftIsNumeric !== rightIsNumeric)
            return leftIsNumeric ? -1 : 1;
        return leftPart < rightPart ? -1 : 1;
    }
    return 0;
}
//# sourceMappingURL=install-state.js.map