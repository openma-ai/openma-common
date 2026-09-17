import { resolveNpmAcpRelease, prepareNpmAcpRelease, validateNpmAcpRelease } from "./npm.js";
import { resolveUvxAcpRelease, prepareUvxAcpRelease, validateUvxAcpRelease } from "./uvx.js";
import { resolveBinaryAcpRelease, prepareBinaryAcpRelease, validateBinaryAcpRelease } from "./binary.js";
import { digest, identity, record, url, launchOptions, platformKey, timeout, download } from "./shared.js";
import { createHash } from "node:crypto";
const official = "https://raw.githubusercontent.com/agentclientprotocol/registry";
/** String entries are the backwards-compatible npm package catalog. */
export function parseAcpReleaseSource(value) {
    if (typeof value === "string")
        value = { type: "npm", package: value };
    if (!record(value))
        throw new Error("Invalid ACP release source");
    if (value.type === "npm" || value.type === "npx") {
        if (typeof value.package !== "string" || !/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(value.package))
            throw new Error("Invalid npm package source");
        return { type: "npm", package: value.package };
    }
    if (value.type === "uvx") {
        if (typeof value.package !== "string" || !/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(value.package))
            throw new Error("Invalid uvx package source");
        if (value.command !== undefined && (typeof value.command !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value.command)))
            throw new Error("Invalid uvx command");
        if (value.python !== undefined && (typeof value.python !== "string" || !/^3(?:\.\d+){0,2}$/.test(value.python)))
            throw new Error("Invalid Python interpreter version");
        return { type: "uvx", package: value.package,
            ...(value.command === undefined ? {} : { command: value.command }),
            ...(value.python === undefined ? {} : { python: value.python }),
            ...(value.indexUrl === undefined ? {} : { indexUrl: url(value.indexUrl, true) }), ...launchOptions(value) };
    }
    if (value.type === "registry") {
        const preference = value.preference;
        if (preference !== undefined && (!Array.isArray(preference) || preference.length === 0 || preference.some(p => !["binary", "npx", "uvx"].includes(p)) || new Set(preference).size !== preference.length))
            throw new Error("Invalid ACP distribution preference");
        return { type: "registry", ...(value.manifestUrl === undefined ? {} : { manifestUrl: url(value.manifestUrl) }),
            ...(preference === undefined ? {} : { preference: [...preference] }) };
    }
    throw new Error("Unsupported ACP release source");
}
export function validateAcpRelease(value) {
    if (!record(value))
        throw new Error("Invalid ACP release");
    if (value.schema === "openma.acp.npm.v1")
        return validateNpmAcpRelease(value);
    if (value.schema === "openma.acp.uvx.v1")
        return validateUvxAcpRelease(value);
    if (value.schema === "openma.acp.binary.v1")
        return validateBinaryAcpRelease(value);
    if (value.schema !== "openma.acp.registry.v1")
        throw new Error("Unknown ACP release schema");
    identity(value.id, value.version);
    const artifact = validateAcpRelease(value.artifact);
    if (artifact.schema === "openma.acp.registry.v1" || artifact.id !== value.id || artifact.version !== value.version)
        throw new Error("Registry artifact identity mismatch");
    const result = { schema: "openma.acp.registry.v1", id: value.id, version: value.version,
        source: url(value.source), artifact, ...launchOptions(value) };
    if (value.digest !== digest(result))
        throw new Error("Invalid registry release digest");
    return { ...result, digest: value.digest };
}
export function acpReleaseMatchesSource(release, input) {
    const source = parseAcpReleaseSource(input);
    if (source.type === "npm")
        return release.schema === "openma.acp.npm.v1" && release.package === source.package;
    if (source.type === "registry")
        return release.schema === "openma.acp.registry.v1" && release.source === (source.manifestUrl ?? official);
    if (release.schema !== "openma.acp.uvx.v1")
        return false;
    const name = source.package.toLowerCase().replace(/[-_.]+/g, "-");
    return release.package === name && release.command === (source.command ?? name)
        && release.python === (source.python ?? "3") && release.indexUrl === (source.indexUrl ?? "https://pypi.org/simple")
        && JSON.stringify(launchOptions(release)) === JSON.stringify(launchOptions(source));
}
async function json(address, options) {
    const response = await (options.fetch ?? fetch)(address, { signal: timeout(options.signal, 30_000), headers: { Accept: "application/json" } });
    if (!response.ok)
        throw new Error(`ACP registry HTTP ${response.status}`);
    return response.json();
}
function exactManifest(value, selection) {
    if (!record(value) || value.id !== selection.id)
        throw new Error("ACP manifest identity mismatch");
    if (value.version === selection.version)
        return value;
    if (record(value.preview) && value.preview.version === selection.version)
        return { ...value, version: value.preview.version, distribution: value.preview.distribution };
    return null;
}
async function registryManifest(selection, source, options) {
    if (source.manifestUrl) {
        const value = exactManifest(await json(source.manifestUrl.replaceAll("{version}", encodeURIComponent(selection.version)).replaceAll("{id}", encodeURIComponent(selection.id)), options), selection);
        if (!value)
            throw new Error("ACP manifest release identity mismatch");
        return value;
    }
    const path = `${selection.id}/agent.json`;
    const latest = exactManifest(await json(`${official}/main/${path}`, options), selection);
    if (latest)
        return latest;
    for (let page = 1;; page++) {
        options.signal?.throwIfAborted();
        const commits = await json(`https://api.github.com/repos/agentclientprotocol/registry/commits?path=${encodeURIComponent(path)}&per_page=100&page=${page}`, options);
        if (!Array.isArray(commits))
            throw new Error("Invalid ACP registry history");
        if (commits.length === 0)
            break;
        for (const commit of commits) {
            if (!record(commit) || typeof commit.sha !== "string" || !/^[a-f0-9]{40}$/.test(commit.sha))
                throw new Error("Invalid ACP registry commit");
            const found = exactManifest(await json(`${official}/${commit.sha}/${path}`, options), selection);
            if (found)
                return found;
        }
        if (commits.length < 100)
            break;
    }
    throw new Error(`ACP registry release not found: ${selection.id}@${selection.version}`);
}
export async function resolveAcpRelease(selection, input = { type: "registry" }, options = {}) {
    identity(selection.id, selection.version);
    const source = parseAcpReleaseSource(input);
    if (source.type === "npm")
        return resolveNpmAcpRelease({ ...selection, package: source.package }, options);
    if (source.type === "uvx")
        return resolveUvxAcpRelease({ ...source, ...selection }, options);
    const manifest = await registryManifest(selection, source, options);
    if (!record(manifest.distribution))
        throw new Error("ACP manifest has no distributions");
    const distribution = manifest.distribution;
    for (const kind of source.preference ?? ["binary", "npx", "uvx"]) {
        let artifact;
        let launch;
        if (kind === "binary") {
            if (!record(distribution.binary))
                continue;
            const target = distribution.binary[platformKey()];
            if (!record(target))
                continue;
            const archive = url(target.archive);
            // Older manifests omit checksums: freeze the bytes fetched over HTTPS on
            // first resolution. This is a recorded content hash, not publisher attestation.
            const sha256 = target.sha256 === undefined ? createHash("sha256").update(await download(archive, options)).digest("hex") : target.sha256;
            artifact = resolveBinaryAcpRelease({ ...selection, platform: platformKey(), archive, sha256: sha256, command: target.cmd });
            launch = launchOptions(target);
        }
        else {
            const entry = distribution[kind];
            if (!record(entry) || typeof entry.package !== "string")
                continue;
            launch = launchOptions(entry);
            if (kind === "npx") {
                const at = entry.package.lastIndexOf("@");
                const name = at > 0 ? entry.package.slice(0, at) : entry.package;
                if (at > 0 && entry.package.slice(at + 1) !== selection.version)
                    throw new Error("Registry npm package version does not match release");
                artifact = await resolveNpmAcpRelease({ ...selection, package: name }, options);
            }
            else {
                const parts = entry.package.split("==");
                if (parts.length > 2 || parts.length === 2 && parts[1] !== selection.version)
                    throw new Error("Registry uvx package version does not match release");
                artifact = await resolveUvxAcpRelease({ ...selection, package: parts[0] }, options);
            }
        }
        const result = { schema: "openma.acp.registry.v1", ...selection, source: source.manifestUrl ?? official, artifact, ...launch };
        return { ...result, digest: digest(result) };
    }
    throw new Error(`No supported ACP distribution for ${platformKey()}`);
}
export async function prepareAcpRelease(input, options) {
    const release = validateAcpRelease(input);
    switch (release.schema) {
        case "openma.acp.npm.v1": return prepareNpmAcpRelease(release, options);
        case "openma.acp.uvx.v1": return prepareUvxAcpRelease(release, options);
        case "openma.acp.binary.v1": return prepareBinaryAcpRelease(release, options);
        case "openma.acp.registry.v1": {
            const prepared = await prepareAcpRelease(release.artifact, options);
            return { command: prepared.command, args: [...prepared.args ?? [], ...release.args], env: { ...prepared.env, ...release.env }, release };
        }
    }
}
//# sourceMappingURL=registry.js.map