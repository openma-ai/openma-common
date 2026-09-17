/** Immutable npm releases for ACP hosts. No product settings or global installs. */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

export interface NpmAcpRelease {
  schema: "openma.acp.npm.v1";
  id: string;
  version: string;
  package: string;
  tarball: string;
  integrity: string;
  bin: string;
  digest: string;
}
export interface NpmAcpReleaseSelection { id: string; version: string; package: string }
export interface NpmAcpReleaseOptions { fetch?: typeof fetch; signal?: AbortSignal }
export interface PreparedAcpRelease { command: string; release: NpmAcpRelease }
const exec = promisify(execFile);
const exactVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const packageName = /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/;
const safeName = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

function validateSelection(value: NpmAcpReleaseSelection): void {
  if (!safeName.test(value.id) || !packageName.test(value.package)) throw new Error("Invalid ACP release identity");
  if (!exactVersion.test(value.version)) throw new Error("ACP release requires an exact version (no tags or ranges)");
}
function fingerprint(value: Omit<NpmAcpRelease, "digest">): string {
  return createHash("sha256").update(JSON.stringify([
    value.schema, value.id, value.version, value.package, value.tarball, value.integrity, value.bin,
  ])).digest("hex");
}
function httpsUrl(value: string): boolean {
  try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password; } catch { return false; }
}
/** Validate persisted release records before trusting their paths or digest. */
export function validateNpmAcpRelease(value: unknown): NpmAcpRelease {
  if (!value || typeof value !== "object") throw new Error("Invalid ACP release record");
  const r = value as NpmAcpRelease;
  for (const key of ["id", "version", "package", "tarball", "integrity", "bin", "digest"] as const) {
    if (typeof r[key] !== "string") throw new Error("Invalid ACP release record");
  }
  validateSelection(r);
  if (r.schema !== "openma.acp.npm.v1" || !httpsUrl(r.tarball)
    || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(r.integrity) || !safeName.test(r.bin)
    || r.digest !== fingerprint(r)) throw new Error("Invalid ACP release digest or metadata");
  return { schema: r.schema, id: r.id, version: r.version, package: r.package,
    tarball: r.tarball, integrity: r.integrity, bin: r.bin, digest: r.digest };
}

/** Read the release's own identity and integrity from npm; never resolve latest. */
export async function resolveNpmAcpRelease(
  selection: NpmAcpReleaseSelection, options: NpmAcpReleaseOptions = {},
): Promise<NpmAcpRelease> {
  validateSelection(selection);
  const response = await (options.fetch ?? fetch)(
    `https://registry.npmjs.org/${encodeURIComponent(selection.package)}/${encodeURIComponent(selection.version)}`,
    { signal: signalWithTimeout(options.signal, 30_000) },
  );
  if (!response.ok) throw new Error(`ACP release ${selection.id}@${selection.version}: registry HTTP ${response.status}`);
  const data = await response.json() as { name?: string; version?: string; bin?: string | Record<string, string>; dist?: { tarball?: string; integrity?: string } };
  if (data.name !== selection.package || data.version !== selection.version) throw new Error("ACP registry release identity mismatch");
  const unscoped = selection.package.split("/").at(-1)!;
  const bins = typeof data.bin === "string" ? [unscoped] : Object.keys(data.bin ?? {});
  const bin = bins.includes(selection.id) ? selection.id : bins.includes(unscoped) ? unscoped : bins.length === 1 ? bins[0]! : "";
  const record = { schema: "openma.acp.npm.v1" as const, ...selection,
    tarball: data.dist?.tarball ?? "", integrity: data.dist?.integrity ?? "", bin };
  return validateNpmAcpRelease({ ...record, digest: fingerprint(record) });
}
function signalWithTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);
}

/** Prepare inside the host/sandbox. Atomic publication prevents partial installs
 * from becoming launchable. Version directories are never upgraded in place. */
export async function prepareNpmAcpRelease(
  input: NpmAcpRelease,
  options: NpmAcpReleaseOptions & { root: string },
): Promise<PreparedAcpRelease> {
  const release = validateNpmAcpRelease(input);
  options.signal?.throwIfAborted();
  const root = resolve(options.root);
  const destination = join(root, release.digest);
  const cached = await readPrepared(destination, release);
  if (cached) return cached;
  await mkdir(root, { recursive: true });
  const staging = await mkdtemp(join(root, ".install-"));
  try {
    const response = await (options.fetch ?? fetch)(release.tarball, { signal: signalWithTimeout(options.signal, 120_000) });
    if (!response.ok) throw new Error(`ACP artifact download HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
    if (integrity !== release.integrity) throw new Error("ACP artifact integrity mismatch");
    const archive = join(staging, "release.tgz");
    await writeFile(archive, bytes);
    // Deliberately exclude Work tokens and model credentials from package scripts.
    const env: NodeJS.ProcessEnv = {};
    for (const key of ["PATH", "HOME", "TMPDIR", "TEMP", "SystemRoot"]) {
      if (process.env[key] !== undefined) env[key] = process.env[key];
    }
    await exec("npm", ["install", "--prefix", staging, "--omit=dev", "--no-audit", "--no-fund", "--", archive], {
      env, timeout: 600_000, maxBuffer: 1024 * 1024, signal: options.signal,
    });
    await verifyInstalled(staging, release);
    await writeFile(join(staging, "release.json"), JSON.stringify(release));
    options.signal?.throwIfAborted();
    try { await rename(staging, destination); }
    catch (error) {
      if (!["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      // Another process published this same release; validate the winner below.
    }
    const prepared = await readPrepared(destination, release);
    if (!prepared) throw new Error("ACP release was not published");
    return prepared;
  } finally { await rm(staging, { recursive: true, force: true }); }
}
async function verifyInstalled(directory: string, release: NpmAcpRelease): Promise<string> {
  const packageDir = join(directory, "node_modules", release.package);
  const metadata = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8")) as { name?: string; version?: string; bin?: string | Record<string, string> };
  if (metadata.name !== release.package || metadata.version !== release.version) throw new Error("ACP installed package identity mismatch");
  const binPath = typeof metadata.bin === "string" ? metadata.bin : metadata.bin?.[release.bin];
  if (typeof binPath !== "string" || isAbsolute(binPath)) throw new Error("ACP release executable is invalid");
  const target = await realpath(join(packageDir, binPath));
  const path = relative(await realpath(packageDir), target);
  if (path.startsWith("..") || isAbsolute(path)) throw new Error("ACP release executable escapes its package");
  const command = join(directory, "node_modules", ".bin", process.platform === "win32" ? `${release.bin}.cmd` : release.bin);
  await access(command, constants.X_OK);
  return command;
}
async function readPrepared(directory: string, release: NpmAcpRelease): Promise<PreparedAcpRelease | null> {
  let saved: string;
  try { saved = await readFile(join(directory, "release.json"), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  if (validateNpmAcpRelease(JSON.parse(saved)).digest !== release.digest) throw new Error("ACP cached release identity mismatch");
  return { command: await verifyInstalled(directory, release), release };
}
