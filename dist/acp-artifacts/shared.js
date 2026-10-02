import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join, posix, resolve } from "node:path";
export function digest(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function record(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
export function pinnedVersion(value) {
    return typeof value === "string" && /^\d+(?:\.\d+)*(?:(?:a|b|rc|\.post|\.dev)\d+)*(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
}
export function identity(id, version) {
    if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || !pinnedVersion(version))
        throw new Error("ACP release requires an id and exact version");
}
export function safeRelative(value) {
    if (typeof value !== "string" || value.includes("\0") || /^[A-Za-z]:/.test(value))
        throw new Error("Unsafe artifact path");
    const path = value.replaceAll("\\", "/");
    if (path.startsWith("/") || path.split("/").includes(".."))
        throw new Error("Unsafe artifact path");
    const normalized = posix.normalize(path).replace(/\/$/, "");
    if (normalized === "." || normalized === "")
        throw new Error("Unsafe artifact path");
    return normalized;
}
export function url(value, loopback = false) {
    if (typeof value !== "string")
        throw new Error("Invalid artifact URL");
    const parsed = new URL(value);
    if (parsed.username || parsed.password || !(parsed.protocol === "https:" || loopback && parsed.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)))
        throw new Error("Artifact URL requires HTTPS");
    return value;
}
export function launchOptions(value) {
    if (value.args !== undefined && (!Array.isArray(value.args) || value.args.some(a => typeof a !== "string" || a.includes("\0"))))
        throw new Error("Invalid artifact launch args");
    if (value.env !== undefined && (!record(value.env) || Object.entries(value.env).some(([k, v]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) || typeof v !== "string" || v.includes("\0"))))
        throw new Error("Invalid artifact launch env");
    return { args: [...(value.args ?? [])], env: Object.fromEntries(Object.entries((value.env ?? {})).sort(([a], [b]) => a.localeCompare(b))) };
}
export function childEnvironment() {
    // Windows installers need cmd/PATHEXT and the profile npm uses for its cache.
    // Work tokens, model credentials, and other host variables stay excluded.
    const keys = [
        "PATH", "PATHEXT", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH",
        "TMPDIR", "TEMP", "TMP", "SystemRoot", "SystemDrive", "ComSpec",
        "APPDATA", "LOCALAPPDATA", "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS",
    ];
    return Object.fromEntries(keys.flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]]]));
}
export function timeout(signal, ms = 120_000) { return signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms); }
export async function download(address, options) {
    const response = await (options.fetch ?? fetch)(address, { signal: timeout(options.signal) });
    if (!response.ok)
        throw new Error(`Artifact download HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
}
export function platformKey() {
    return `${process.platform === "win32" ? "windows" : process.platform}-${process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : process.arch}`;
}
async function pathExists(path) {
    try {
        await realpath(path);
        return true;
    }
    catch {
        return false;
    }
}
/** Move a finished install into place. Windows MoveFileEx returns EPERM when the
 * destination directory already exists, and briefly while a scanner holds a new file. */
export async function publishDirectory(staging, destination) {
    const retries = process.platform === "win32" ? 8 : 1;
    let last;
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            await rename(staging, destination);
            return;
        }
        catch (error) {
            last = error;
            const code = error.code ?? "";
            if (code === "EEXIST" || code === "ENOTEMPTY")
                return;
            if ((code === "EPERM" || code === "EBUSY") && await pathExists(destination))
                return;
            if (process.platform === "win32" && (code === "EPERM" || code === "EBUSY") && attempt < retries - 1) {
                await new Promise(resolveDelay => setTimeout(resolveDelay, 50 * (attempt + 1)));
                continue;
            }
            throw error;
        }
    }
    throw last;
}
export async function discardStaging(staging, destination) {
    if (await pathExists(staging) && await pathExists(destination)) {
        const [stagingReal, destinationReal] = await Promise.all([realpath(staging), realpath(destination)]);
        const same = process.platform === "win32"
            ? stagingReal.toLowerCase() === destinationReal.toLowerCase()
            : stagingReal === destinationReal;
        if (same)
            return;
    }
    else if (!await pathExists(staging))
        return;
    try {
        await rm(staging, { recursive: true, force: true });
    }
    catch (error) {
        const code = error.code;
        if (code !== "ENOENT" && code !== "EPERM" && code !== "EBUSY")
            throw error;
    }
}
export async function installAtomically(root, release, build, inspect, signal) {
    signal?.throwIfAborted();
    const destination = join(resolve(root), release.digest);
    async function cached() {
        let saved;
        try {
            saved = await readFile(join(destination, "release.json"), "utf8");
        }
        catch (error) {
            if (error.code === "ENOENT")
                return null;
            throw error;
        }
        if (JSON.stringify(JSON.parse(saved)) !== JSON.stringify(release))
            throw new Error("Cached artifact release mismatch");
        return { ...await inspect(destination), release };
    }
    const ready = await cached();
    if (ready)
        return ready;
    await mkdir(resolve(root), { recursive: true });
    const staging = await mkdtemp(join(resolve(root), ".install-"));
    try {
        await build(staging);
        await inspect(staging);
        await writeFile(join(staging, "release.json"), JSON.stringify(release));
        signal?.throwIfAborted();
        await publishDirectory(staging, destination);
        const result = await cached();
        if (!result)
            throw new Error("Artifact installation was not published");
        return result;
    }
    finally {
        await discardStaging(staging, destination);
    }
}
//# sourceMappingURL=shared.js.map