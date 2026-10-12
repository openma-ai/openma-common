import { access, readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import type { KnownAgentEntry } from "./known-agents.js";
import type { AcpRegistryInstallMetadata } from "./installer.js";
import { launcherTarget } from "./launcher.js";

/** Harness ids whose latest version comes from npm, not the public ACP registry snapshot. */
export const OPENMA_NPM_HARNESS_IDS = new Set(["pi-acp", "dsh-acp"]);

export interface AcpHarnessInstallState {
  installed: boolean;
  installedVersion?: string;
  latestVersion?: string;
  updateAvailable?: boolean;
}

export interface ReadAcpHarnessInstallStateOptions {
  entry: KnownAgentEntry;
  binDir: string;
  installRoot?: string;
  fetchImpl?: typeof fetch;
  npmRegistryUrls?: string[];
}

export function usesOpenMaNpmLatestSource(entry: KnownAgentEntry): boolean {
  const registryId = entry.registryId ?? entry.id;
  return OPENMA_NPM_HARNESS_IDS.has(registryId) || OPENMA_NPM_HARNESS_IDS.has(entry.id);
}

export async function readAcpHarnessInstallState(
  options: ReadAcpHarnessInstallStateOptions,
): Promise<AcpHarnessInstallState> {
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

export interface AcpHarnessPinState {
  package: { name: string; pinned: string; installed?: string };
  dependencies: Array<{ name: string; pinned: string; installed?: string }>;
  /** Every pinned package is installed at exactly its pinned version. */
  satisfied: boolean;
}

/** Orders by UTF-16 code unit, the same on every machine. `localeCompare` follows the host locale. */
export function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function isExactVersion(version: string | undefined): version is string {
  return version !== undefined && EXACT_VERSION.test(version);
}

/** Dependency pins in a stable order. Throws when one is not an exact version. */
export function exactDependencyPins(pins: Record<string, string> | undefined): Array<[string, string]> {
  const entries = Object.entries(pins ?? {}).sort(([left], [right]) => compareCodePoints(left, right));
  for (const [name, version] of entries) {
    if (!isExactVersion(version)) {
      throw new Error(`npm override for ${name} must be an exact version, got ${JSON.stringify(version)}`);
    }
  }
  return entries;
}

export interface AcpHarnessPinnedPackages {
  package: { name: string; version: string };
  dependencies: Array<[string, string]>;
}

/**
 * The exact versions an entry pins. Throws when the entry pins nothing or
 * names anything other than an exact version: the installer and the state
 * reader refuse the same input.
 */
export function acpHarnessPinnedPackages(entry: KnownAgentEntry): AcpHarnessPinnedPackages {
  if (!entry.pinned || !entry.registryId) {
    throw new Error(`${entry.label} (${entry.id}) has no pinned install`);
  }
  const version = npmVersionFromSpec(entry.pinned.package);
  if (!isExactVersion(version)) {
    throw new Error(`${entry.label} (${entry.id}) pins ${entry.pinned.package}, which is not an exact version`);
  }
  return {
    package: { name: npmPackageNameFromSpec(entry.pinned.package), version },
    dependencies: exactDependencyPins(entry.pinned.dependencies),
  };
}

/**
 * Where a pinned install lives. Its launcher name and its state directory
 * differ from the product install's, so the two can share one bin directory
 * and install root without overwriting each other.
 */
export function pinnedAcpHarnessPaths(
  entry: KnownAgentEntry,
  binDir: string,
  options: { platform?: NodeJS.Platform } = {},
): { stateId: string; launcherName: string; launcherPath: string } {
  const windows = (options.platform ?? process.platform) === "win32";
  const base = `${posixBasename(entry.spec.command)}-pinned`;
  const launcherName = windows ? `${base}.cmd` : base;
  return {
    stateId: `${entry.registryId ?? entry.id}-pinned`,
    launcherName,
    launcherPath: join(binDir, launcherName),
  };
}

function posixBasename(command: string): string {
  return command.replaceAll("\\", "/").split("/").at(-1)!;
}

/**
 * Compares the install a pinned launcher points at with the exact versions
 * the registry entry pins. Reads only local files. Null when the entry pins
 * nothing; throws when its pins are not exact versions.
 */
export async function readAcpHarnessPinState(options: {
  entry: KnownAgentEntry;
  shimPath: string;
}): Promise<AcpHarnessPinState | null> {
  if (!options.entry.pinned) return null;
  const pins = acpHarnessPinnedPackages(options.entry);
  const installedPackage = await installedNpmPackageVersionFromShim(options.shimPath, pins.package.name);
  const dependencies = await Promise.all(
    pins.dependencies.map(async ([dependency, version]) => {
      const installed = await installedNpmPackageVersionFromShim(options.shimPath, dependency);
      return { name: dependency, pinned: version, ...(installed ? { installed } : {}) };
    }),
  );
  return {
    package: {
      name: pins.package.name,
      pinned: pins.package.version,
      ...(installedPackage ? { installed: installedPackage } : {}),
    },
    dependencies,
    satisfied: installedPackage === pins.package.version
      && dependencies.every((dependency) => dependency.installed === dependency.pinned),
  };
}

export function npmPackageNameFromSpec(packageSpec: string): string {
  if (packageSpec.startsWith("@")) {
    const versionIndex = packageSpec.indexOf("@", 1);
    return versionIndex > 0 ? packageSpec.slice(0, versionIndex) : packageSpec;
  }
  const versionIndex = packageSpec.lastIndexOf("@");
  return versionIndex > 0 ? packageSpec.slice(0, versionIndex) : packageSpec;
}

export function npmVersionFromSpec(packageSpec: string): string | undefined {
  if (packageSpec.startsWith("@")) {
    const versionIndex = packageSpec.indexOf("@", 1);
    return versionIndex > 0 ? packageSpec.slice(versionIndex + 1) : undefined;
  }
  const versionIndex = packageSpec.lastIndexOf("@");
  return versionIndex > 0 ? packageSpec.slice(versionIndex + 1) : undefined;
}

export async function latestNpmPackageVersion(
  packageName: string,
  options: {
    fetchImpl?: typeof fetch;
    npmRegistryUrls?: string[];
  } = {},
): Promise<string | undefined> {
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
      if (!response.ok) continue;
      const parsed = await response.json() as {
        "dist-tags"?: { latest?: unknown };
      };
      const latest = parsed["dist-tags"]?.latest;
      if (typeof latest === "string" && latest.length > 0) {
        return latest;
      }
    } catch {
      // Try the next registry mirror.
    }
  }
  return undefined;
}

export async function readInstalledNpmPackageVersion(options: {
  shimPath: string;
  packageName: string;
  installRoot?: string;
  registryId?: string;
}): Promise<string | undefined> {
  const fromShim = await installedNpmPackageVersionFromShim(
    options.shimPath,
    options.packageName,
  );
  if (fromShim) return fromShim;
  if (!options.installRoot || !options.registryId) return undefined;
  return await scanRegistryInstallPackageVersion(
    options.installRoot,
    options.registryId,
    options.packageName,
  );
}

export async function installedNpmPackageVersionFromShim(
  shimPath: string,
  packageName: string,
): Promise<string | undefined> {
  try {
    const commandPath = launcherTarget(await readFile(shimPath, "utf8"));
    if (!commandPath) return undefined;
    return await readPackageJsonVersion(join(
      dirnameFromShim(commandPath),
      "node_modules",
      ...packageName.split("/"),
      "package.json",
    ));
  } catch {
    return undefined;
  }
}

function dirnameFromShim(commandPath: string): string {
  const normalized = commandPath.replaceAll("\\", "/");
  const marker = "/node_modules/.bin/";
  const markerIndex = normalized.lastIndexOf(marker);
  if (markerIndex < 0) {
    throw new Error(`Shim does not point at an npm prefix: ${commandPath}`);
  }
  return normalized.slice(0, markerIndex);
}

async function scanRegistryInstallPackageVersion(
  installRoot: string,
  registryId: string,
  packageName: string,
): Promise<string | undefined> {
  const registryDir = join(installRoot, "registry", sanitizePathComponent(registryId));
  let entries: string[];
  try {
    entries = await readdir(registryDir);
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    if (!entry.startsWith("v_")) continue;
    const version = await readPackageJsonVersion(join(
      registryDir,
      entry,
      "node_modules",
      ...packageName.split("/"),
      "package.json",
    ));
    if (version) return version;
  }
  return undefined;
}

async function readPackageJsonVersion(packageJsonPath: string): Promise<string | undefined> {
  try {
    const parsed = JSON.parse(await readFile(packageJsonPath, "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" && parsed.version.length > 0
      ? parsed.version
      : undefined;
  } catch {
    return undefined;
  }
}

async function readRegistryInstallMetadata(
  installRoot: string,
  registryId: string,
): Promise<AcpRegistryInstallMetadata | null> {
  try {
    const parsed = JSON.parse(await readFile(join(
      installRoot,
      "registry",
      sanitizePathComponent(registryId),
      "install.json",
    ), "utf8")) as Partial<AcpRegistryInstallMetadata>;
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
  } catch {
    return null;
  }
}

function sanitizePathComponent(input: string): string {
  const sanitized = input.replace(/[^a-zA-Z0-9._-]/g, "-");
  return sanitized.length > 0 ? sanitized : "unknown";
}

type ParsedSemver = {
  core: readonly [number, number, number];
  prerelease: readonly string[];
};

export function isStrictlyNewerVersion(candidate?: string, current?: string): boolean {
  if (!candidate || !current) return false;
  const parsedCandidate = parseSemver(candidate);
  const parsedCurrent = parseSemver(current);
  if (!parsedCandidate || !parsedCurrent) return false;
  return compareSemver(parsedCandidate, parsedCurrent) > 0;
}

function parseSemver(version: string): ParsedSemver | null {
  const match = version.trim().match(
    /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
  );
  if (!match) return null;
  const core = match.slice(1, 4).map(Number);
  if (core.some((part) => !Number.isSafeInteger(part))) return null;
  return {
    core: core as [number, number, number],
    prerelease: match[4]?.split(".") ?? [],
  };
}

function compareSemver(left: ParsedSemver, right: ParsedSemver): number {
  for (let index = 0; index < left.core.length; index += 1) {
    const difference = left.core[index]! - right.core[index]!;
    if (difference !== 0) return difference;
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return right.prerelease.length - left.prerelease.length;
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
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
    if (leftIsNumeric !== rightIsNumeric) return leftIsNumeric ? -1 : 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}
