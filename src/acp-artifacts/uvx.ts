import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { childEnvironment, digest, identity, installAtomically, launchOptions, timeout, url, type ArtifactOptions } from "./shared.js";

export interface UvxAcpRelease {
  schema: "openma.acp.uvx.v1";
  id: string; version: string; package: string; command: string; python: string;
  indexUrl: string; hashes: string[]; args: string[]; env: Record<string, string>; digest: string;
}
export interface UvxAcpReleaseInput {
  id: string; version: string; package: string; command?: string; python?: string;
  indexUrl?: string; args?: string[]; env?: Record<string, string>;
}
const exec = promisify(execFile);
const normalize = (name: string) => name.toLowerCase().replace(/[-_.]+/g, "-");
// uv's venv layout is bin/python on POSIX and Scripts\python.exe on Windows.
function venvPython(venv: string): string {
  return process.platform === "win32" ? join(venv, "Scripts", "python.exe") : join(venv, "bin", "python");
}
function venvScriptCandidates(venv: string, command: string): string[] {
  if (process.platform !== "win32") return [join(venv, "bin", command)];
  const scripts = join(venv, "Scripts");
  return [`${command}.exe`, `${command}.cmd`, command, `${command}.bat`].map(name => join(scripts, name));
}
async function venvCommand(venv: string, command: string): Promise<string> {
  const candidates = venvScriptCandidates(venv, command);
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.F_OK);
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return candidates[0]!;
}
function releaseRecord(input: UvxAcpReleaseInput, hashes: string[]): Omit<UvxAcpRelease, "digest"> {
  identity(input.id, input.version);
  if (typeof input.package !== "string" || !/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(input.package)) throw new Error("Invalid Python package name");
  const command = input.command ?? normalize(input.package);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(command)) throw new Error("Invalid uvx executable");
  const python = input.python ?? "3";
  if (!/^3(?:\.\d+){0,2}$/.test(python)) throw new Error("Invalid Python interpreter version");
  if (!Array.isArray(hashes) || hashes.length === 0 || hashes.some(h => typeof h !== "string" || !/^[a-f0-9]{64}$/.test(h))) throw new Error("Python releases require artifact SHA-256 hashes");
  return { schema: "openma.acp.uvx.v1", id: input.id, version: input.version, package: normalize(input.package), command, python,
    indexUrl: url(input.indexUrl ?? "https://pypi.org/simple", true), hashes: [...new Set(hashes)].sort(), ...launchOptions(input) };
}
export async function resolveUvxAcpRelease(input: UvxAcpReleaseInput, options: ArtifactOptions = {}): Promise<UvxAcpRelease> {
  // Validate before placing untrusted package/version text into a URL.
  releaseRecord(input, ["0".repeat(64)]);
  const response = await (options.fetch ?? fetch)(`https://pypi.org/pypi/${encodeURIComponent(input.package)}/${encodeURIComponent(input.version)}/json`, { signal: timeout(options.signal, 30_000) });
  if (!response.ok) throw new Error(`PyPI release HTTP ${response.status}`);
  const data = await response.json() as { info?: { name?: string; version?: string }; urls?: { digests?: { sha256?: string }; yanked?: boolean }[] };
  if (typeof data.info?.name !== "string" || normalize(data.info.name) !== normalize(input.package) || data.info.version !== input.version) throw new Error("Python release identity mismatch");
  const hashes = (data.urls ?? []).filter(file => !file.yanked).map(file => file.digests?.sha256 ?? "");
  const result = releaseRecord(input, hashes);
  return { ...result, digest: digest(result) };
}
export function validateUvxAcpRelease(value: unknown): UvxAcpRelease {
  if (!value || typeof value !== "object") throw new Error("Invalid uvx release");
  const input = value as UvxAcpRelease;
  const result = releaseRecord(input, input.hashes);
  if (input.schema !== result.schema || input.digest !== digest(result)) throw new Error("Invalid uvx release digest");
  return { ...result, digest: input.digest };
}
export async function prepareUvxAcpRelease(input: UvxAcpRelease, options: ArtifactOptions & { root: string }) {
  const release = validateUvxAcpRelease(input);
  options.signal?.throwIfAborted();
  const runOptions = { env: childEnvironment(), signal: options.signal, timeout: 600_000, maxBuffer: 1024 * 1024 };
  const interpreter = (await exec("uv", ["python", "find", "--no-config", release.python], runOptions)).stdout.trim();
  const runtime = (await exec(interpreter, ["-I", "-c", "import sys,sysconfig;print(sys.implementation.cache_tag+'-'+sysconfig.get_platform())"], runOptions)).stdout.trim();
  // Include the interpreter location: a moved/removed interpreter cannot reuse its old venv.
  const platform = `${process.platform}-${process.arch}-python-${digest([runtime, interpreter])}`;
  return installAtomically(join(options.root, platform), release, async directory => {
    const venv = join(directory, "venv");
    await exec("uv", ["venv", "--no-config", "--no-project", "--relocatable", "--python", interpreter, venv], runOptions);
    const requirements = join(directory, "requirements.txt");
    await writeFile(requirements, `${release.package}==${release.version} ${release.hashes.map(hash => `--hash=sha256:${hash}`).join(" ")}\n`);
    await exec("uv", ["pip", "install", "--no-config", "--native-tls", "--python", venvPython(venv), "--index-url", release.indexUrl, "-r", requirements], runOptions);
  }, async directory => {
    const venv = join(directory, "venv");
    const command = await venvCommand(venv, release.command);
    const inspect = "import importlib.metadata as m,json,sys,os;d=m.distribution(sys.argv[1]);\ndef owned(f):\n try: return os.path.samefile(d.locate_file(f), sys.argv[2])\n except OSError: return False\nprint(json.dumps({'name':d.metadata['Name'],'version':d.version,'owns_command':any(owned(f) for f in (d.files or []))}))";
    const metadata = JSON.parse((await exec(venvPython(venv), ["-I", "-c", inspect, release.package, command], runOptions)).stdout) as { name: string; version: string; owns_command: boolean };
    if (normalize(metadata.name) !== release.package || metadata.version !== release.version || !metadata.owns_command) throw new Error("Installed uvx package identity or entry point mismatch");
    await access(command, constants.X_OK);
    return { command, args: release.args, env: release.env };
  }, options.signal);
}
