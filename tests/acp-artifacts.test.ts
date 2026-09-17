import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { resolveNpmAcpRelease, prepareNpmAcpRelease } from '../src/acp-artifacts/index.js';

const exec = promisify(execFile);
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
async function fixture(version = '1.8.0', scripts?: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'acp-artifact-')); roots.push(root);
  await mkdir(join(root, 'package'));
  await writeFile(join(root, 'package/package.json'), JSON.stringify({ name: '@test/harness', version, bin: { 'codex-acp': 'cli.cjs' }, scripts }));
  await writeFile(join(root, 'package/cli.cjs'), '#!/usr/bin/env node\nconsole.log(require("./package.json").version)\n', { mode: 0o755 });
  await exec('tar', ['-czf', join(root, 'package.tgz'), '-C', root, 'package']);
  const archive = await readFile(join(root, 'package.tgz'));
  const metadata = { name: '@test/harness', version, bin: { 'codex-acp': 'cli.cjs' }, dist: { tarball: 'https://registry.npmjs.org/test.tgz', integrity: `sha512-${createHash('sha512').update(archive).digest('base64')}` } };
  const fetcher: typeof fetch = async input => {
    const url = String(input);
    if (url === 'https://registry.npmjs.org/test.tgz') return new Response(archive);
    if (url === `https://registry.npmjs.org/%40test%2Fharness/${version}`) return Response.json(metadata);
    throw new Error(`unexpected URL ${url}`);
  };
  const selection = { id: 'codex-acp', version, package: '@test/harness' };
  return { root, metadata, archive, fetcher, selection };
}

it('installs the exact release into its own directory and reuses it offline', async () => {
  const f = await fixture();
  const release = await resolveNpmAcpRelease(f.selection, { fetch: f.fetcher });
  expect(release).toMatchObject({ id: 'codex-acp', version: '1.8.0', package: '@test/harness', integrity: f.metadata.dist.integrity });
  const options = { root: join(f.root, 'installed'), fetch: f.fetcher };
  const [a, b] = await Promise.all([prepareNpmAcpRelease(release, options), prepareNpmAcpRelease(release, options)]);
  expect(a.command).toBe(b.command);
  expect((await exec(a.command, [])).stdout.trim()).toBe('1.8.0');
  const offline: typeof fetch = async () => { throw new Error('offline'); };
  const cached = await prepareNpmAcpRelease(release, { ...options, fetch: offline });
  expect((await exec(cached.command, [])).stdout.trim()).toBe('1.8.0');
}, 30_000);

it('keeps two harness releases executable without replacing the first', async () => {
  const a = await fixture('1.8.0'); const b = await fixture('1.9.0');
  const root = join(a.root, 'installed');
  const first = await prepareNpmAcpRelease(await resolveNpmAcpRelease(a.selection, { fetch: a.fetcher }), { root, fetch: a.fetcher });
  const second = await prepareNpmAcpRelease(await resolveNpmAcpRelease(b.selection, { fetch: b.fetcher }), { root, fetch: b.fetcher });
  expect(first.command).not.toBe(second.command);
  expect((await exec(first.command, [])).stdout.trim()).toBe('1.8.0');
  expect((await exec(second.command, [])).stdout.trim()).toBe('1.9.0');
}, 30_000);

it.each(['latest', '^1.8.0', '1', '../1.8.0'])('rejects a floating or invalid release %s before fetching', async version => {
  await expect(resolveNpmAcpRelease({ id: 'codex-acp', package: '@test/harness', version })).rejects.toThrow(/exact version/);
});

it('rejects registry metadata for another version instead of falling back', async () => {
  const f = await fixture();
  await expect(resolveNpmAcpRelease(f.selection, { fetch: async () => Response.json({ ...f.metadata, version: '1.9.0' }) })).rejects.toThrow(/identity/);
});

it('rejects modified archives and allows a clean retry after installation failure', async () => {
  const f = await fixture();
  const release = await resolveNpmAcpRelease(f.selection, { fetch: f.fetcher });
  const root = join(f.root, 'installed');
  await expect(prepareNpmAcpRelease(release, { root, fetch: async () => new Response('wrong archive') })).rejects.toThrow(/integrity/);
  const installed = await prepareNpmAcpRelease(release, { root, fetch: f.fetcher });
  expect((await exec(installed.command, [])).stdout.trim()).toBe('1.8.0');
}, 30_000);

it('verifies the installed package identity, not only registry metadata', async () => {
  const f = await fixture('1.9.0');
  const release = await resolveNpmAcpRelease({ ...f.selection, version: '1.8.0' }, { fetch: async () => Response.json({ ...f.metadata, version: '1.8.0' }) });
  await expect(prepareNpmAcpRelease(release, { root: join(f.root, 'installed'), fetch: f.fetcher })).rejects.toThrow(/installed package identity/);
}, 30_000);

it('rejects a cancelled preparation before downloading or spawning npm', async () => {
  const f = await fixture();
  const release = await resolveNpmAcpRelease(f.selection, { fetch: f.fetcher });
  await expect(prepareNpmAcpRelease(release, { root: join(f.root, 'installed'), signal: AbortSignal.abort() })).rejects.toThrow();
});

it('does not pass host Work or model credentials to npm lifecycle scripts', async () => {
  const f = await fixture('1.8.0', { postinstall: `node -e "require('fs').writeFileSync('env.json', JSON.stringify({work:process.env.ANTHROPIC_WORK_SECRET,model:process.env.OPENAI_API_KEY}))"` });
  const previousWork = process.env.ANTHROPIC_WORK_SECRET;
  const previousModel = process.env.OPENAI_API_KEY;
  process.env.ANTHROPIC_WORK_SECRET = 'test-work-secret';
  process.env.OPENAI_API_KEY = 'test-model-secret';
  try {
    const release = await resolveNpmAcpRelease(f.selection, { fetch: f.fetcher });
    const root = join(f.root, 'installed');
    const prepared = await prepareNpmAcpRelease(release, { root, fetch: f.fetcher });
    expect(JSON.parse(await readFile(join(dirname(dirname(prepared.command)), '@test/harness/env.json'), 'utf8'))).toEqual({});
  } finally {
    if (previousWork === undefined) delete process.env.ANTHROPIC_WORK_SECRET; else process.env.ANTHROPIC_WORK_SECRET = previousWork;
    if (previousModel === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousModel;
  }
}, 30_000);

it('rejects a changed persisted manifest instead of trusting its old digest', async () => {
  const f = await fixture();
  const release = await resolveNpmAcpRelease(f.selection, { fetch: f.fetcher });
  await expect(prepareNpmAcpRelease({ ...release, tarball: 'https://example.test/other.tgz' }, { root: f.root })).rejects.toThrow(/digest/);
});
