import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, chmod, mkdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { unzipSync } from "fflate";
import * as tar from "tar";
import { digest, identity, safeRelative, url, launchOptions, platformKey, download, installAtomically, childEnvironment, type ArtifactOptions } from "./shared.js";

export type BinaryFormat = "raw" | "zip" | "tar" | "tar.gz" | "tar.bz2" | "tar.xz";
export interface BinaryAcpRelease {
  schema: "openma.acp.binary.v1";
  id: string; version: string; platform: string;
  archive: string; sha256: string; format: BinaryFormat; command: string;
  args: string[]; env: Record<string, string>; digest: string;
}
export interface BinaryAcpReleaseInput {
  id: string; version: string; platform: string; archive: string; sha256: string;
  format?: string; command: string; args?: string[]; env?: Record<string, string>;
}
export function binaryFormat(address: string): BinaryFormat {
  const path = new URL(address).pathname.toLowerCase();
  if (/\.(dmg|pkg|deb|rpm|msi|appimage)$/.test(path)) throw new Error("Installer packages are not ACP binary distributions");
  if (/\.(tar\.gz|tgz)$/.test(path)) return "tar.gz";
  if (/\.(tar\.bz2|tbz2)$/.test(path)) return "tar.bz2";
  if (/\.(tar\.xz|txz)$/.test(path)) return "tar.xz";
  if (path.endsWith(".tar")) return "tar";
  if (path.endsWith(".zip")) return "zip";
  return "raw";
}
export function resolveBinaryAcpRelease(input: BinaryAcpReleaseInput): BinaryAcpRelease {
  identity(input.id, input.version);
  if (typeof input.platform !== "string" || !/^[a-z0-9_-]+$/.test(input.platform)) throw new Error("Invalid binary platform");
  url(input.archive);
  if (typeof input.sha256 !== "string" || !/^[a-fA-F0-9]{64}$/.test(input.sha256)) throw new Error("Binary releases require a SHA-256 checksum");
  const format = input.format ?? binaryFormat(input.archive);
  if (!["raw", "zip", "tar", "tar.gz", "tar.bz2", "tar.xz"].includes(format)) throw new Error("Unsupported binary archive format");
  const record = { schema: "openma.acp.binary.v1" as const, id: input.id, version: input.version,
    platform: input.platform, archive: input.archive, sha256: input.sha256.toLowerCase(), format: format as BinaryFormat,
    command: safeRelative(input.command), ...launchOptions(input) };
  return { ...record, digest: digest(record) };
}
export function validateBinaryAcpRelease(value: unknown): BinaryAcpRelease {
  if (!value || typeof value !== "object") throw new Error("Invalid binary release");
  const input = value as BinaryAcpRelease;
  const result = resolveBinaryAcpRelease(input);
  if (input.schema !== result.schema || input.digest !== result.digest) throw new Error("Invalid binary release digest");
  return result;
}
export async function prepareBinaryAcpRelease(input: BinaryAcpRelease, options: ArtifactOptions & { root: string }) {
  const release = validateBinaryAcpRelease(input);
  if (release.platform !== platformKey()) throw new Error(`Binary platform ${release.platform} does not match ${platformKey()}`);
  return installAtomically(join(options.root, platformKey()), release, async directory => {
    const bytes = await download(release.archive, options);
    if (createHash("sha256").update(bytes).digest("hex") !== release.sha256) throw new Error("Binary artifact integrity mismatch");
    const payload = join(directory, "payload"); await mkdir(payload);
    if (release.format === "raw") {
      await mkdir(dirname(join(payload, release.command)), { recursive: true });
      await writeFile(join(payload, release.command), bytes);
    } else if (release.format === "zip") {
      const entries = Object.entries(unzipSync(bytes));
      for (const [name] of entries) safeRelative(name);
      for (const [name, data] of entries) {
        const target = join(payload, safeRelative(name));
        if (name.endsWith("/")) await mkdir(target, { recursive: true });
        else { await mkdir(dirname(target), { recursive: true }); await writeFile(target, data); }
      }
    } else {
      const archive = join(directory, "archive.tar");
      if (release.format === "tar.bz2" || release.format === "tar.xz") {
        const compressed = join(directory, "compressed"); await writeFile(compressed, bytes);
        const decoded = await promisify(execFile)(release.format === "tar.bz2" ? "bzip2" : "xz", ["-dc", compressed], {
          encoding: "buffer", maxBuffer: 1024 * 1024 * 1024, timeout: 120_000, signal: options.signal, env: childEnvironment(),
        });
        await writeFile(archive, decoded.stdout);
      } else await writeFile(archive, bytes);
      let invalid: Error | undefined;
      await tar.t({ file: archive, strict: true, onReadEntry(entry) {
        try {
          if (entry.type === "Directory" && [".", "./"].includes(entry.path)) return;
          safeRelative(entry.path);
          if (!["File", "OldFile", "Directory"].includes(entry.type)) throw new Error("Binary archives cannot contain links or special files");
        } catch (error) { invalid = error as Error; }
      } });
      if (invalid) throw invalid;
      await tar.x({ file: archive, cwd: payload, strict: true, preserveOwner: false, chmod: true });
      await rm(archive);
      await rm(join(directory, "compressed"), { force: true });
    }
    await chmod(join(payload, release.command), 0o755);
  }, async directory => {
    const payload = await realpath(join(directory, "payload"));
    const command = await realpath(join(payload, release.command));
    const rel = relative(payload, command);
    if (rel.startsWith("..") || isAbsolute(rel) || !(await stat(command)).isFile()) throw new Error("Binary executable path escapes the artifact");
    await access(command, constants.X_OK);
    return { command, args: release.args, env: release.env };
  }, options.signal);
}
