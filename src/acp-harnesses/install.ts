import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  prepareAcpRelease,
  resolveAcpRelease,
  resolveBinaryAcpRelease,
  validateAcpRelease,
  type AcpRelease,
  type AcpReleaseSource,
  type ArtifactOptions,
} from "../acp-artifacts/index.js";
import type { AcpCatalogHarness } from "./catalog.js";
import {
  OPENMA_ACP_HARNESS_CATALOG,
  selectCatalogHarnesses,
} from "./catalog.js";
import type { AcpHarnessInstallSource } from "./source.js";

export type { AcpHarnessInstallSource } from "./source.js";
export type { AcpCatalogHarness } from "./catalog.js";
export { OPENMA_ACP_HARNESS_CATALOG, catalogHarnessById, selectCatalogHarnesses } from "./catalog.js";

export interface AcpHarnessInstallResult {
  id: string;
  label: string;
  version: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  release: AcpRelease;
}

export interface AcpHarnessInstallOptions extends ArtifactOptions {
  /** Directory where harness releases are prepared (idempotent cache root). */
  root: string;
  /** Install every catalog entry when omitted or empty. */
  ids?: readonly string[];
  /** Catalog to install from; defaults to {@link OPENMA_ACP_HARNESS_CATALOG}. */
  catalog?: readonly AcpCatalogHarness[];
}

/** Prepare catalog harnesses into `root` and return launch commands. Idempotent. */
export async function installAcpHarnesses(
  options: AcpHarnessInstallOptions,
): Promise<AcpHarnessInstallResult[]> {
  const catalog = options.catalog ?? OPENMA_ACP_HARNESS_CATALOG;
  const entries = selectCatalogHarnesses(options.ids, catalog);
  const results: AcpHarnessInstallResult[] = [];
  for (const entry of entries) {
    results.push(await installCatalogHarness(entry, options));
  }
  return results;
}

/** Re-run installation for the requested catalog entries (new versions get new digest dirs). */
export async function upgradeAcpHarnesses(
  options: AcpHarnessInstallOptions,
): Promise<AcpHarnessInstallResult[]> {
  return installAcpHarnesses(options);
}

/** Return a prepared harness when it is already cached under `root`, without network I/O. */
export async function detectInstalledAcpHarness(
  entry: AcpCatalogHarness,
  options: Pick<AcpHarnessInstallOptions, "root"> & Partial<Pick<AcpHarnessInstallOptions, "nodePath" | "npmCliPath" | "env" | "signal">>,
): Promise<AcpHarnessInstallResult | null> {
  const offline: typeof fetch = async () => {
    throw new Error("offline");
  };
  try {
    return await installCatalogHarness(entry, { ...options, fetch: offline });
  } catch {
    return null;
  }
}

async function installCatalogHarness(
  entry: AcpCatalogHarness,
  options: AcpHarnessInstallOptions,
): Promise<AcpHarnessInstallResult> {
  const release = await resolveCatalogRelease(entry, { ...options, root: options.root });
  const prepared = await prepareAcpRelease(release, {
    root: options.root,
    fetch: options.fetch,
    signal: options.signal,
    nodePath: options.nodePath,
    npmCliPath: options.npmCliPath,
    env: options.env,
  });
  const extra = entry.launch ?? {};
  return {
    id: entry.id,
    label: entry.label,
    version: entry.version,
    command: prepared.command,
    args: [...(prepared.args ?? []), ...(extra.args ?? [])],
    env: { ...(prepared.env ?? {}), ...(extra.env ?? {}) },
    release: prepared.release,
  };
}

function releaseManifestPath(root: string, entry: AcpCatalogHarness): string {
  return join(resolve(root), ".releases", `${entry.id}@${entry.version}.json`);
}

async function resolveCatalogRelease(
  entry: AcpCatalogHarness,
  options: ArtifactOptions & { root: string },
): Promise<AcpRelease> {
  const manifestPath = releaseManifestPath(options.root, entry);
  const cached = await readCachedReleaseManifest(manifestPath);
  if (cached) return cached;
  const { id, version, source } = entry;
  if (source.type === "binary") {
    const release = resolveBinaryAcpRelease({
      id,
      version,
      platform: source.platform,
      archive: source.archive,
      sha256: source.sha256,
      format: source.format,
      command: source.command,
      args: source.args,
      env: source.env,
    });
    await persistReleaseManifest(manifestPath, release);
    return release;
  }
  const release = await resolveAcpRelease({ id, version }, toReleaseSource(source), options);
  await persistReleaseManifest(manifestPath, release);
  return release;
}

async function readCachedReleaseManifest(path: string): Promise<AcpRelease | null> {
  try {
    return validateAcpRelease(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null;
  }
}

async function persistReleaseManifest(path: string, release: AcpRelease): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(release));
}

function toReleaseSource(source: Exclude<AcpHarnessInstallSource, { type: "binary" }>): AcpReleaseSource {
  if (source.type === "npm") return { type: "npm", package: source.package };
  if (source.type === "registry") {
    return {
      type: "registry",
      ...(source.manifestUrl === undefined ? {} : { manifestUrl: source.manifestUrl }),
      ...(source.preference === undefined ? {} : { preference: [...source.preference] }),
    };
  }
  return {
    type: "uvx",
    package: source.package,
    ...(source.command === undefined ? {} : { command: source.command }),
    ...(source.python === undefined ? {} : { python: source.python }),
    ...(source.indexUrl === undefined ? {} : { indexUrl: source.indexUrl }),
    ...(source.args === undefined ? {} : { args: source.args }),
    ...(source.env === undefined ? {} : { env: source.env }),
  };
}
