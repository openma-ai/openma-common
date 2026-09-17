import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { zipSync, strToU8 } from "fflate";
import { afterEach, expect, it } from "vitest";
import { resolveBinaryAcpRelease, prepareBinaryAcpRelease, resolveUvxAcpRelease, prepareUvxAcpRelease } from "../src/acp-artifacts/index.js";

const exec = promisify(execFile);
const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()))));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
async function temp() { const root = await mkdtemp(join(tmpdir(), "acp-distribution-")); roots.push(root); return root; }
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const script = '#!/bin/sh\nprintf "release-1.0.0:%s\\n" "$*"\n';
async function binaryFixture(format: string) {
  const root = await temp(); await mkdir(join(root, "bin"));
  await writeFile(join(root, "bin/agent"), script);
  let bytes: Buffer;
  if (format === "raw") bytes = Buffer.from(script);
  else if (format === "zip") bytes = Buffer.from(zipSync({ "bin/agent": strToU8(script) }));
  else {
    await exec("tar", ["-cf", join(root, "release.tar"), "-C", root, "bin/agent"]);
    if (format === "tar") bytes = await readFile(join(root, "release.tar"));
    else bytes = (await exec(format === "tar.gz" ? "gzip" : format === "tar.bz2" ? "bzip2" : "xz", ["-c", join(root, "release.tar")], { encoding: "buffer" })).stdout;
  }
  const platform = `${process.platform}-${process.arch === "arm64" ? "aarch64" : "x86_64"}`;
  const release = resolveBinaryAcpRelease({ id: "fixture", version: "1.0.0", platform,
    archive: `https://example.test/release.${format}`, format,
    sha256: sha(bytes), command: "bin/agent", args: ["acp"], env: { MODE: "fixture" } });
  return { root, bytes, release };
}

it.each(["raw", "zip", "tar", "tar.gz", "tar.bz2", "tar.xz"])("prepares and launches a %s binary without preinstallation", async format => {
  const f = await binaryFixture(format);
  const options = { root: join(f.root, "cache"), fetch: async () => new Response(new Uint8Array(f.bytes)) };
  const [first, second] = await Promise.all([prepareBinaryAcpRelease(f.release, options), prepareBinaryAcpRelease(f.release, options)]);
  expect(first.command).toBe(second.command);
  expect((await exec(first.command, first.args)).stdout.trim()).toBe("release-1.0.0:acp");
  expect(first.env).toEqual({ MODE: "fixture" });
  const cached = await prepareBinaryAcpRelease(f.release, { root: options.root, fetch: async () => { throw new Error("offline"); } });
  expect((await exec(cached.command, ["again"])).stdout.trim()).toBe("release-1.0.0:again");
});

it("rejects a corrupt binary download, then permits a clean retry", async () => {
  const f = await binaryFixture("zip");
  const root = join(f.root, "cache");
  await expect(prepareBinaryAcpRelease(f.release, { root, fetch: async () => new Response("corrupt") })).rejects.toThrow(/integrity/);
  const prepared = await prepareBinaryAcpRelease(f.release, { root, fetch: async () => new Response(new Uint8Array(f.bytes)) });
  expect((await exec(prepared.command, [])).stdout).toContain("release-1.0.0");
});

it("rejects a binary for a different platform before downloading", async () => {
  const f = await binaryFixture("raw");
  const release = resolveBinaryAcpRelease({ ...f.release, platform: "other-platform" });
  await expect(prepareBinaryAcpRelease(release, { root: f.root })).rejects.toThrow(/platform/);
});

it.each(["../escape", "/tmp/escape", "bin/../../escape", "C:\\escape"])("rejects unsafe binary paths: %s", command => {
  expect(() => resolveBinaryAcpRelease({ id: "fixture", version: "1.0.0", platform: "linux-x86_64",
    archive: "https://example.test/a.zip", format: "zip", sha256: "a".repeat(64), command })).toThrow(/path/);
});

it("rejects archive traversal entries even when the requested executable is safe", async () => {
  const f = await binaryFixture("zip");
  const bytes = zipSync({ "bin/agent": strToU8(script), "../escape": strToU8("unsafe") });
  const release = resolveBinaryAcpRelease({ ...f.release, sha256: sha(bytes) });
  await expect(prepareBinaryAcpRelease(release, { root: f.root, fetch: async () => new Response(bytes) })).rejects.toThrow(/path/);
});

function wheel(name: string, version: string, dependency = false, native = false) {
  const stem = `${name}-${version}.dist-info`;
  const files: Record<string, Uint8Array> = {
    [`${name}.py`]: strToU8(name === "tiny_dependency" ? 'VALUE = "dependency-ready"\n' : `import sys\nfrom tiny_dependency import VALUE\ndef main():\n print("${version}:" + VALUE + ":" + " ".join(sys.argv[1:]))\n`),
    [`${stem}/METADATA`]: strToU8(`Metadata-Version: 2.1\nName: ${name}\nVersion: ${version}\n${dependency ? "Requires-Dist: tiny-dependency==1.0.0\n" : ""}`),
    [`${stem}/WHEEL`]: strToU8("Wheel-Version: 1.0\nGenerator: fixture\nRoot-Is-Purelib: true\nTag: py3-none-any\n"),
    [`${stem}/entry_points.txt`]: strToU8(name === "tiny_harness" && !native ? `[console_scripts]\ntiny-harness = ${name}:main\n` : ""),
    [`${stem}/RECORD`]: strToU8(""),
    ...(native ? { [`${name}-${version}.data/scripts/tiny-harness`]: strToU8(`#!/bin/sh\nprintf 'native-${version}'\n`) } : {}),
  };
  files[`${stem}/RECORD`] = strToU8(Object.entries(files).map(([path, bytes]) => path.endsWith("/RECORD")
    ? `${path},,` : `${path},sha256=${createHash("sha256").update(bytes).digest("base64url")},${bytes.byteLength}`).join("\n"));
  return zipSync(files);
}
async function pythonFixture(version = "1.0.0", native = false) {
  const root = await temp();
  const main = wheel("tiny_harness", version, true, native);
  const dep = wheel("tiny_dependency", "1.0.0");
  const mainName = `tiny_harness-${version}-py3-none-any.whl`;
  const depName = "tiny_dependency-1.0.0-py3-none-any.whl";
  const server = createServer((req, res) => {
    if (req.url === `/files/${mainName}`) { res.end(main); return; }
    if (req.url === `/files/${depName}`) { res.end(dep); return; }
    res.setHeader("Content-Type", "text/html");
    if (req.url === "/simple/tiny-harness/") { res.end(`<a href="/files/${mainName}#sha256=${sha(main)}">${mainName}</a>`); return; }
    if (req.url === "/simple/tiny-dependency/") { res.end(`<a href="/files/${depName}#sha256=${sha(dep)}">${depName}</a>`); return; }
    res.writeHead(404); res.end();
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const indexUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/simple`;
  const metadata = { info: { name: "tiny-harness", version }, urls: [{ digests: { sha256: sha(main) }, yanked: false }] };
  const release = await resolveUvxAcpRelease({ id: "python-agent", package: "tiny-harness", version, command: "tiny-harness", indexUrl }, {
    fetch: async () => Response.json(metadata),
  });
  return { root, release, metadata, indexUrl };
}

it("installs a hash-pinned uvx tool with dependencies and keeps its launcher valid after publication", async () => {
  const f = await pythonFixture();
  const [a, b] = await Promise.all([prepareUvxAcpRelease(f.release, { root: f.root }), prepareUvxAcpRelease(f.release, { root: f.root })]);
  expect(a.command).toBe(b.command);
  expect((await exec(a.command, ["acp"])).stdout.trim()).toBe("1.0.0:dependency-ready:acp");
  await new Promise<void>(resolve => servers.pop()!.close(() => resolve()));
  const cached = await prepareUvxAcpRelease(f.release, { root: f.root });
  expect((await exec(cached.command, ["offline"])).stdout.trim()).toBe("1.0.0:dependency-ready:offline");
}, 30_000);

it("supports exact Python prereleases and version coexistence", async () => {
  const a = await pythonFixture(); const b = await pythonFixture("1.1.0rc1");
  const first = await prepareUvxAcpRelease(a.release, { root: a.root });
  const second = await prepareUvxAcpRelease(b.release, { root: a.root });
  expect(first.command).not.toBe(second.command);
  expect((await exec(first.command, [])).stdout).toContain("1.0.0:");
  expect((await exec(second.command, [])).stdout).toContain("1.1.0rc1:");
}, 30_000);

it("rejects uvx archive hashes that differ from the persisted release", async () => {
  const f = await pythonFixture();
  const release = await resolveUvxAcpRelease({ id: "python-agent", package: "tiny-harness", version: "1.0.0", indexUrl: f.indexUrl }, {
    fetch: async () => Response.json({ ...f.metadata, urls: [{ digests: { sha256: "a".repeat(64) } }] }),
  });
  await expect(prepareUvxAcpRelease(release, { root: f.root })).rejects.toThrow();
}, 30_000);

it("supports executable files shipped in wheel scripts without console_scripts metadata", async () => {
  const f = await pythonFixture("1.0.0", true);
  const prepared = await prepareUvxAcpRelease(f.release, { root: f.root });
  expect((await exec(prepared.command, [])).stdout).toBe("native-1.0.0");
}, 30_000);

it("rejects tar symlinks instead of extracting through them", async () => {
  const f = await binaryFixture("tar");
  await symlink("/tmp", join(f.root, "bin/link"));
  await exec("tar", ["-cf", join(f.root, "unsafe.tar"), "-C", f.root, "bin"]);
  const bytes = await readFile(join(f.root, "unsafe.tar"));
  const release = resolveBinaryAcpRelease({ ...f.release, sha256: sha(bytes) });
  await expect(prepareBinaryAcpRelease(release, { root: join(f.root, "cache"), fetch: async () => new Response(bytes) })).rejects.toThrow(/links/);
});
