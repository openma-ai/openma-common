import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { resolveAcpRelease, prepareAcpRelease, validateAcpRelease, acpReleaseMatchesSource, parseAcpReleaseSource } from "../src/acp-artifacts/index.js";
const platform = `${process.platform}-${process.arch === "arm64" ? "aarch64" : "x86_64"}`;
const bytes = Buffer.from('#!/bin/sh\nprintf "%s:%s\\n" "$MODE" "$*"\n');
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
function manifest(version: string) { return { id: "fixture", version, distribution: { binary: { [platform]: {
  archive: "https://releases.test/agent", cmd: "./agent", sha256: createHash("sha256").update(bytes).digest("hex"), args: ["acp", "--stdio"], env: { MODE: "registry" },
} } } }; }
it("finds an exact historical release and preserves registry args/env through launch", async () => {
  const fetcher: typeof fetch = async input => {
    const address = String(input);
    if (address.endsWith('/main/fixture/agent.json')) return Response.json(manifest('2.0.0'));
    if (address.includes('/commits?')) return Response.json([{ sha: 'a'.repeat(40) }]);
    if (address.endsWith(`/${'a'.repeat(40)}/fixture/agent.json`)) return Response.json(manifest('1.0.0'));
    if (address === 'https://releases.test/agent') return new Response(bytes);
    throw new Error(`Unexpected URL ${address}`);
  };
  const release = await resolveAcpRelease({ id: "fixture", version: "1.0.0" }, { type: "registry" }, { fetch: fetcher });
  expect(release).toMatchObject({ id: "fixture", version: "1.0.0", schema: "openma.acp.registry.v1" });
  const root = await mkdtemp(join(tmpdir(), 'acp-registry-')); roots.push(root);
  const prepared = await prepareAcpRelease(release, { root, fetch: fetcher });
  expect((await promisify(execFile)(prepared.command, prepared.args, { env: { ...process.env, ...prepared.env } })).stdout.trim()).toBe('registry:acp --stdio');
  expect(acpReleaseMatchesSource(release, { type: "registry" })).toBe(true);
  expect(acpReleaseMatchesSource(release, { type: "registry", manifestUrl: "https://other.test/{version}/agent.json" })).toBe(false);
});
it("uses a compatible npx distribution when no binary matches this platform", async () => {
  const release = await resolveAcpRelease({ id: "fixture", version: "1.0.0" }, { type: "registry" }, { fetch: async input => {
    if (String(input).includes('raw.githubusercontent.com')) return Response.json({ id: 'fixture', version: '1.0.0', distribution: { binary: { other: manifest('1.0.0').distribution.binary[platform] }, npx: { package: '@fixture/agent@1.0.0', args: ['--acp'] } } });
    return Response.json({ name: '@fixture/agent', version: '1.0.0', bin: { agent: 'cli.js' }, dist: { tarball: 'https://registry.npmjs.org/agent.tgz', integrity: `sha512-${Buffer.alloc(64).toString('base64')}` } });
  } });
  expect(release).toMatchObject({ artifact: { schema: 'openma.acp.npm.v1', version: '1.0.0' }, args: ['--acp'] });
  expect(validateAcpRelease(release)).toEqual(release);
  expect(() => validateAcpRelease({ ...release, args: ['--different'] })).toThrow(/digest/);
});
it.each(["python-agent==1.0.0", "python-agent@1.0.0"])("resolves uvx from the registry using the exact Python release: %s", async packageSpec => {
  const release = await resolveAcpRelease({ id: 'fixture', version: '1.0.0' }, { type: 'registry' }, { fetch: async input =>
    String(input).includes('raw.githubusercontent.com')
      ? Response.json({ id: 'fixture', version: '1.0.0', distribution: { uvx: { package: packageSpec, args: ['acp'] } } })
      : Response.json({ info: { name: 'python-agent', version: '1.0.0' }, urls: [{ digests: { sha256: 'a'.repeat(64) } }] }),
  });
  expect(release).toMatchObject({ artifact: { schema: 'openma.acp.uvx.v1', package: 'python-agent', version: '1.0.0' }, args: ['acp'] });
});
it("never substitutes the current registry release for a missing historical version", async () => {
  await expect(resolveAcpRelease({ id: 'fixture', version: '1.0.0' }, { type: 'registry' }, { fetch: async input =>
    Response.json(String(input).includes('/commits?') ? [] : manifest('2.0.0')),
  })).rejects.toThrow(/not found/);
});
it("validates the identity in custom manifests rather than trusting their URL", async () => {
  await expect(resolveAcpRelease({ id: 'fixture', version: '1.0.0' }, { type: 'registry', manifestUrl: 'https://example.test/{version}/agent.json' }, {
    fetch: async () => Response.json(manifest('2.0.0')),
  })).rejects.toThrow(/identity/);
});
it.each(['https://example.test/install.sh', { type: 'uvx', package: '../bad' }, { type: 'unknown' }, { type: 'registry', manifestUrl: 'file:///tmp/agent.json' }])('rejects invalid release source %#', source => {
  expect(() => parseAcpReleaseSource(source)).toThrow();
});

it("pins content when an older binary manifest has no published checksum", async () => {
  const value = manifest("1.0.0");
  delete (value.distribution.binary[platform] as { sha256?: string }).sha256;
  const release = await resolveAcpRelease({ id: "fixture", version: "1.0.0" }, { type: "registry" }, {
    fetch: async input => String(input) === "https://releases.test/agent" ? new Response(bytes) : Response.json(value),
  });
  expect(release).toMatchObject({ artifact: { sha256: createHash("sha256").update(bytes).digest("hex") } });
  const root = await mkdtemp(join(tmpdir(), "acp-checksum-")); roots.push(root);
  await expect(prepareAcpRelease(release, { root, fetch: async () => new Response("changed after resolution") })).rejects.toThrow(/integrity/);
});
it("selects an explicitly requested preview without changing the stable release", async () => {
  const release = await resolveAcpRelease({ id: "fixture", version: "1.1.0-preview.1" }, { type: "registry" }, { fetch: async input => {
    if (String(input).includes("raw.githubusercontent.com")) return Response.json({ ...manifest("1.0.0"), preview: {
      version: "1.1.0-preview.1", distribution: { npx: { package: "@fixture/agent@1.1.0-preview.1" } },
    } });
    return Response.json({ name: "@fixture/agent", version: "1.1.0-preview.1", bin: { agent: "cli.js" },
      dist: { tarball: "https://registry.npmjs.org/agent.tgz", integrity: `sha512-${Buffer.alloc(64).toString("base64")}` } });
  } });
  expect(release).toMatchObject({ version: "1.1.0-preview.1", artifact: { version: "1.1.0-preview.1", schema: "openma.acp.npm.v1" } });
});
