import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { childEnvironment, digest, identity, installAtomically, launchOptions, timeout, url } from "./shared.js";
const exec = promisify(execFile);
const normalize = (name) => name.toLowerCase().replace(/[-_.]+/g, "-");
function releaseRecord(input, hashes) {
    identity(input.id, input.version);
    if (typeof input.package !== "string" || !/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(input.package))
        throw new Error("Invalid Python package name");
    const command = input.command ?? normalize(input.package);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(command))
        throw new Error("Invalid uvx executable");
    const python = input.python ?? "3";
    if (!/^3(?:\.\d+){0,2}$/.test(python))
        throw new Error("Invalid Python interpreter version");
    if (!Array.isArray(hashes) || hashes.length === 0 || hashes.some(h => typeof h !== "string" || !/^[a-f0-9]{64}$/.test(h)))
        throw new Error("Python releases require artifact SHA-256 hashes");
    return { schema: "openma.acp.uvx.v1", id: input.id, version: input.version, package: normalize(input.package), command, python,
        indexUrl: url(input.indexUrl ?? "https://pypi.org/simple", true), hashes: [...new Set(hashes)].sort(), ...launchOptions(input) };
}
export async function resolveUvxAcpRelease(input, options = {}) {
    // Validate before placing untrusted package/version text into a URL.
    releaseRecord(input, ["0".repeat(64)]);
    const response = await (options.fetch ?? fetch)(`https://pypi.org/pypi/${encodeURIComponent(input.package)}/${encodeURIComponent(input.version)}/json`, { signal: timeout(options.signal, 30_000) });
    if (!response.ok)
        throw new Error(`PyPI release HTTP ${response.status}`);
    const data = await response.json();
    if (typeof data.info?.name !== "string" || normalize(data.info.name) !== normalize(input.package) || data.info.version !== input.version)
        throw new Error("Python release identity mismatch");
    const hashes = (data.urls ?? []).filter(file => !file.yanked).map(file => file.digests?.sha256 ?? "");
    const result = releaseRecord(input, hashes);
    return { ...result, digest: digest(result) };
}
export function validateUvxAcpRelease(value) {
    if (!value || typeof value !== "object")
        throw new Error("Invalid uvx release");
    const input = value;
    const result = releaseRecord(input, input.hashes);
    if (input.schema !== result.schema || input.digest !== digest(result))
        throw new Error("Invalid uvx release digest");
    return { ...result, digest: input.digest };
}
export async function prepareUvxAcpRelease(input, options) {
    const release = validateUvxAcpRelease(input);
    options.signal?.throwIfAborted();
    const runOptions = { env: childEnvironment(), signal: options.signal, timeout: 600_000, maxBuffer: 1024 * 1024 };
    const interpreter = (await exec("uv", ["python", "find", "--no-config", release.python], runOptions)).stdout.trim();
    const runtime = (await exec(interpreter, ["-I", "-c", "import sys,sysconfig;print(sys.implementation.cache_tag+'-'+sysconfig.get_platform())"], runOptions)).stdout.trim();
    // Include the interpreter location: a moved/removed interpreter cannot reuse its old venv.
    const platform = `${process.platform}-${process.arch}-python-${digest([runtime, interpreter])}`;
    return installAtomically(join(options.root, platform), release, async (directory) => {
        const venv = join(directory, "venv");
        await exec("uv", ["venv", "--no-config", "--no-project", "--relocatable", "--python", interpreter, venv], runOptions);
        const requirements = join(directory, "requirements.txt");
        await writeFile(requirements, `${release.package}==${release.version} ${release.hashes.map(hash => `--hash=sha256:${hash}`).join(" ")}\n`);
        await exec("uv", ["pip", "install", "--no-config", "--native-tls", "--python", join(venv, "bin/python"), "--index-url", release.indexUrl, "-r", requirements], runOptions);
    }, async (directory) => {
        const venv = join(directory, "venv");
        const command = join(venv, "bin", release.command);
        const inspect = "import importlib.metadata as m,json,sys,pathlib;d=m.distribution(sys.argv[1]);target=pathlib.Path(sys.argv[2]).resolve();print(json.dumps({'name':d.metadata['Name'],'version':d.version,'owns_command':any(pathlib.Path(d.locate_file(f)).resolve()==target for f in (d.files or []))}))";
        const metadata = JSON.parse((await exec(join(venv, "bin/python"), ["-I", "-c", inspect, release.package, command], runOptions)).stdout);
        if (normalize(metadata.name) !== release.package || metadata.version !== release.version || !metadata.owns_command)
            throw new Error("Installed uvx package identity or entry point mismatch");
        await access(command, constants.X_OK);
        return { command, args: release.args, env: release.env };
    }, options.signal);
}
//# sourceMappingURL=uvx.js.map