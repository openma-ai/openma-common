/** Explicit opt-in adapter protocol check, NOT a live model/engine test.
 * Usage: node --permission --allow-fs-read=... --experimental-transform-types
 * native-claude.mjs /absolute/installed/claude-agent-acp
 * Installed files are only imported, never patched. Session creation and the
 * Claude engine control are doubles; native initialize/catalog/setter/v1 wire
 * and common runtime/helper run unmodified. No prompt is ever sent.
 */
import assert from 'node:assert/strict';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
const deny = () => { throw new Error('Native permission test forbids network'); };
net.Socket.prototype.connect = deny;
net.connect = net.createConnection = tls.connect = http.request = http.get = https.request = https.get = deny;
globalThis.fetch = deny;
syncBuiltinESMExports();
const root = new URL('../../../', import.meta.url);
const src = new URL('src/', root).href;
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && context.parentURL?.startsWith(src) && specifier.endsWith('.js')) {
    const ts = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL);
    if (existsSync(fileURLToPath(ts))) return next(ts.href, context);
  }
  return next(specifier, context);
} });
const installed = pathToFileURL(process.argv[2].replace(/\/$/, '') + '/');
const pkg = JSON.parse(readFileSync(new URL('package.json', installed), 'utf8'));
assert.equal(pkg.name, '@agentclientprotocol/claude-agent-acp');
assert.equal(pkg.version, '0.94.0');
const { v1AgentApp } = await import(new URL('dist/acp-agent.js', installed).href);
const { SessionModeManager } = await import(new URL('dist/session-mode.js', installed).href);
const { AcpSessionImpl, applyAcpPermissionMode } = await import(new URL('src/acp-runtime/index.ts', root).href);
const { ndJsonStream } = await import('@agentclientprotocol/sdk');
const outcomes = [];
for (const scenario of ['three-modes', 'auto-fallback', 'bypass-disabled', 'engine-rejection', 'abort', 'timeout']) {
  const requests = [];
  let sessionState;
  let release;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const deferred = new Promise(resolve => { release = resolve; });
  const c2a = new TransformStream(), a2c = new TransformStream();
  const app = v1AgentApp({ log() {}, error() {}, warn() {} }, agent => {
    // No auth probe child process, user settings, session transcript or SDK
    // model call. Both replacements exist only on this test instance.
    agent.probeCliAuthStatus = async () => {};
    agent.newSession = async () => {
      const query = { async setPermissionMode(mode) {
        requests.push(mode);
        if (scenario === 'abort' || scenario === 'timeout') { entered(); await deferred; }
        if (scenario === 'engine-rejection') throw new Error('test engine rejected mode');
      } };
      const model = { value: 'test-model', supportsAutoMode: scenario !== 'auto-fallback' };
      const initial = await agent.sessionModes.initialize({ query, requestedMode: 'default',
        currentModelInfo: model, currentModelId: 'test-model', allowBypass: scenario !== 'bypass-disabled' });
      sessionState = { query, modes: initial.modes, models: { currentModelId: 'test-model' },
        modelInfos: [model], configOptions: [SessionModeManager.configOption(initial.modes)] };
      agent.sessions['native-permissions'] = sessionState;
      return { sessionId: 'native-permissions', modes: sessionState.modes, configOptions: sessionState.configOptions };
    };
    agent.prompt = async () => { throw new Error('No model requests allowed'); };
    agent.closeSession = async () => {}; // Session lifecycle is outside this mode-only harness.
  });
  app.connect(ndJsonStream(a2c.writable, c2a.readable));
  const session = new AcpSessionImpl({ id: scenario, options: { agent: { command: 'installed-adapter-test' } }, child: {
    stdin: c2a.writable, stdout: a2c.readable,
    stderr: new ReadableStream({ start(c) { c.close(); } }), exited: new Promise(() => {}), async kill() {},
  } });
  try {
    await session.init();
    assert.equal(session.agentInfo.version, '0.94.0');
    const apply = mode => applyAcpPermissionMode(session, { harnessId: 'claude-acp', mode });
    if (scenario === 'three-modes') {
      for (const [mode, nativeModeId] of [['always_ask','default'], ['auto','auto'], ['always_allow','bypassPermissions']]) {
        assert.equal((await apply(mode)).nativeModeId, nativeModeId);
        assert.equal(sessionState.modes.currentModeId, nativeModeId);
        assert.equal(session.configOptions[0].currentValue, nativeModeId);
      }
      assert.deepEqual(requests, ['default', 'auto', 'bypassPermissions']);
    } else if (scenario === 'auto-fallback') {
      await assert.rejects(apply('auto'), { code: 'mode-mismatch', effectiveModeId: 'acceptEdits', outcome: 'unknown' });
      assert.deepEqual(requests, ['acceptEdits']);
    } else if (scenario === 'bypass-disabled') {
      await assert.rejects(apply('always_allow'), { code: 'unsupported', outcome: 'not-dispatched' });
      assert.deepEqual(requests, []);
    } else if (scenario === 'engine-rejection') {
      await assert.rejects(apply('auto'), { code: 'apply-failed', outcome: 'unknown' });
      assert.deepEqual(requests, ['auto']);
      assert.equal(sessionState.modes.currentModeId, 'default');
    } else {
      const controller = new AbortController();
      const attempt = applyAcpPermissionMode(session, { harnessId: 'claude-acp', mode: 'auto',
        abortSignal: controller.signal, timeoutMs: scenario === 'timeout' ? 30 : 1000 });
      const rejected = assert.rejects(attempt, { code: scenario === 'abort' ? 'aborted' : 'timeout', outcome: 'unknown' });
      await started;
      if (scenario === 'abort') controller.abort();
      await rejected;
      await assert.rejects(apply('always_allow'), { code: 'busy', outcome: 'not-dispatched' });
      release();
      // Let the real adapter send its late notification + config response.
      await new Promise(resolve => setTimeout(resolve, 20));
      assert.deepEqual(requests, ['auto']);
      assert.equal(sessionState.modes.currentModeId, 'auto');
    }
    outcomes.push({ scenario, requests, advertised: session.configOptions[0].options.map(o => o.value), pass: true });
  } finally { await session.dispose(); }
}
console.log(JSON.stringify({ adapter: pkg.version, evidence: 'installed native v1 adapter and mode code; stub session creation/engine; no model requests', outcomes }, null, 2));
