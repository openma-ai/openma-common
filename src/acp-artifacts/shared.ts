import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, posix, resolve } from "node:path";

export interface ArtifactOptions { fetch?: typeof fetch; signal?: AbortSignal }
export interface Launch { command: string; args?: string[]; env?: Record<string, string> }
export function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
export function pinnedVersion(value: unknown): value is string {
  return typeof value === "string" && /^\d+(?:\.\d+)*(?:(?:a|b|rc|\.post|\.dev)\d+)*(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
}
export function identity(id: unknown, version: unknown): void {
  if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || !pinnedVersion(version)) throw new Error("ACP release requires an id and exact version");
}
export function safeRelative(value: unknown): string {
  if (typeof value !== "string" || value.includes("\0") || /^[A-Za-z]:/.test(value)) throw new Error("Unsafe artifact path");
  const path = value.replaceAll("\\", "/");
  if (path.startsWith("/") || path.split("/").includes("..")) throw new Error("Unsafe artifact path");
  const normalized = posix.normalize(path).replace(/\/$/, "");
  if (normalized === "." || normalized === "") throw new Error("Unsafe artifact path");
  return normalized;
}
export function url(value: unknown, loopback = false): string {
  if (typeof value !== "string") throw new Error("Invalid artifact URL");
  const parsed = new URL(value);
  if (parsed.username || parsed.password || !(parsed.protocol === "https:" || loopback && parsed.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname))) throw new Error("Artifact URL requires HTTPS");
  return value;
}
export function launchOptions(value: { args?: unknown; env?: unknown }): { args: string[]; env: Record<string, string> } {
  if (value.args !== undefined && (!Array.isArray(value.args) || value.args.some(a => typeof a !== "string" || a.includes("\0")))) throw new Error("Invalid artifact launch args");
  if (value.env !== undefined && (!record(value.env) || Object.entries(value.env).some(([k, v]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) || typeof v !== "string" || v.includes("\0")))) throw new Error("Invalid artifact launch env");
  return { args: [...(value.args as string[] ?? [])], env: Object.fromEntries(Object.entries((value.env ?? {}) as Record<string, string>).sort(([a], [b]) => a.localeCompare(b))) };
}
export function childEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(["PATH", "HOME", "TMPDIR", "TEMP", "SystemRoot"].flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]]]));
}
export function timeout(signal?: AbortSignal, ms = 120_000): AbortSignal { return signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms); }
export async function download(address: string, options: ArtifactOptions): Promise<Buffer> {
  const response = await (options.fetch ?? fetch)(address, { signal: timeout(options.signal) });
  if (!response.ok) throw new Error(`Artifact download HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
export function platformKey(): string {
  return `${process.platform === "win32" ? "windows" : process.platform}-${process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : process.arch}`;
}
export async function installAtomically<R extends { digest: string }>(
  root: string, release: R, build: (directory: string) => Promise<void>, inspect: (directory: string) => Promise<Launch>, signal?: AbortSignal,
): Promise<Launch & { release: R }> {
  signal?.throwIfAborted();
  const destination = join(resolve(root), release.digest);
  async function cached() {
    let saved: string;
    try { saved = await readFile(join(destination, "release.json"), "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    if (JSON.stringify(JSON.parse(saved)) !== JSON.stringify(release)) throw new Error("Cached artifact release mismatch");
    return { ...await inspect(destination), release };
  }
  const ready = await cached();
  if (ready) return ready;
  await mkdir(resolve(root), { recursive: true });
  const staging = await mkdtemp(join(resolve(root), ".install-"));
  try {
    await build(staging);
    await inspect(staging);
    await writeFile(join(staging, "release.json"), JSON.stringify(release));
    signal?.throwIfAborted();
    try { await rename(staging, destination); }
    catch (error) { if (!["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
    const result = await cached();
    if (!result) throw new Error("Artifact installation was not published");
    return result;
  } finally { await rm(staging, { recursive: true, force: true }); }
}
