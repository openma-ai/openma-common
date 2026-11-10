import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { createConnection } from 'node:net';
import { spawn } from 'node:child_process';
import { AgentSideConnection, PROTOCOL_VERSION, ndJsonStream } from '@agentclientprotocol/sdk';
import { createManagedAgentsRuntime } from '@openma/common/local-runtime';
import { AcpRuntimeImpl } from '@openma/common/acp-runtime';

const directory = process.env.HOME;
assert.deepEqual(Object.keys(process.env).sort(), ['HOME', 'NODE_ENV', 'TMPDIR']);
assert.throws(() => fs.readFileSync(join(directory, '..', 'credentials-not-permitted')), { code: 'ERR_ACCESS_DENIED' });
assert.throws(() => spawn(process.execPath, ['-e', 'process.exit(0)']), { code: 'ERR_ACCESS_DENIED' });
assert.throws(() => fetch('https://example.invalid'), /NETWORK_DENIED/);
assert.throws(() => createConnection({ host: '127.0.0.1', port: 1 }), /NETWORK_DENIED/);

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const bounded = p => Promise.race([p, new Promise((_, reject) => { const t = setTimeout(() => reject(new Error('fixture handshake timed out')), 2500); t.unref(); })]);
const nativePath = join(directory, 'native.json');
const checkpointPath = join(directory, 'checkpoint.json');
// Common has a production store PORT, not a concrete FS store. This fixture
// implements that existing contract with synchronous local CAS, not a Work claim.
function checkpointStore() {
  const load = () => fs.existsSync(checkpointPath) ? JSON.parse(fs.readFileSync(checkpointPath, 'utf8')) : null;
  return {
    async load() { return load(); },
    async compareAndSet({ expectedGeneration, checkpoint }) {
      if ((load()?.generation ?? null) !== expectedGeneration) return false;
      fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint));
      return true;
    },
    async delete({ expectedGeneration, ownerId }) {
      const current = load();
      if (expectedGeneration !== undefined && current?.generation !== expectedGeneration) return false;
      if (ownerId !== undefined && current?.ownerId !== ownerId) return false;
      fs.rmSync(checkpointPath, { force: true }); return true;
    },
  };
}
const trace = [];
let active = deferred(), permissionSeen = deferred(), permissionDecision = deferred();
let cancellations = 0, newSessions = 0, loads = 0, spawns = 0;
const spawner = {
  async spawn(spec) {
    assert.equal(spec.command, 'in-memory-acp-fixture');
    spawns++;
    const toAgent = new TransformStream(), toClient = new TransformStream();
    const exited = deferred();
    let history = [], held, closed = false;
    new AgentSideConnection(conn => ({
      async initialize() { return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: { loadSession: true }, _meta: { steering: { supported: true } } }; },
      async newSession() { newSessions++; history = []; return { sessionId: 'native-local-session' }; },
      async loadSession({ sessionId }) {
        assert.equal(sessionId, 'native-local-session'); loads++;
        history = JSON.parse(fs.readFileSync(nativePath, 'utf8'));
        return {};
      },
      async authenticate() { throw new Error('local fixture must never require authentication'); },
      async prompt({ sessionId, prompt }) {
        assert.equal(sessionId, 'native-local-session');
        const text = prompt.map(b => b.type === 'text' ? b.text : '').join('');
        trace.push(`prompt:${text}`);
        if (text === 'hold' || text === 'cancel-me') {
          held = deferred(); active.resolve(); await held.promise;
          if (text === 'cancel-me') return { stopReason: 'cancelled' };
        }
        if (text === 'permission') {
          const result = await conn.requestPermission({ sessionId,
            toolCall: { toolCallId: 'tool-local', title: 'Write temporary note', kind: 'edit', status: 'pending' },
            options: [{ optionId: 'local-allow', name: 'Allow once', kind: 'allow_once' }, { optionId: 'local-deny', name: 'Reject once', kind: 'reject_once' }],
          });
          assert.deepEqual(result, { outcome: { outcome: 'selected', optionId: 'local-allow' } });
        }
        const response = text === 'recall' ? `history:${history.join('|')}` : `answer:${text}`;
        history.push(text); fs.writeFileSync(nativePath, JSON.stringify(history));
        await conn.sessionUpdate({ sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: response } } });
        return { stopReason: 'end_turn' };
      },
      async extMethod(method, params) {
        assert.equal(method, '_session/steering');
        assert.equal(params.sessionId, 'native-local-session');
        assert.deepEqual(params.prompt, [{ type: 'text', text: 'change direction' }]);
        trace.push('steer:change direction'); held.resolve(); return { outcome: 'injected' };
      },
      async cancel({ sessionId }) { assert.equal(sessionId, 'native-local-session'); cancellations++; held?.resolve(); },
    }), ndJsonStream(toClient.writable, toAgent.readable));
    return {
      stdin: toAgent.writable, stdout: toClient.readable,
      stderr: new ReadableStream({ start(c) { c.close(); } }), exited: exited.promise,
      async kill() { if (closed) return; closed = true; held?.resolve(); exited.resolve({ code: 0, signal: null }); },
    };
  },
};
const events = [];
function makeRuntime(owner, withCheckpoint = true) {
  const runtime = createManagedAgentsRuntime({
    acpRuntime: new AcpRuntimeImpl(spawner),
    sessionPreparation: { async prepare() { return {
      agent: { command: 'in-memory-acp-fixture', cwd: directory }, perTurnTimeoutMs: 2500,
      clientCallbacks: { async requestPermission(params) { assert.equal(params.toolCall.toolCallId, 'tool-local'); permissionSeen.resolve(); return permissionDecision.promise; } },
    }; } },
    ...(withCheckpoint ? { checkpointStore: checkpointStore(), hostInstanceId: owner } : {}),
  });
  runtime.attach({ publish(event) { events.push(event); } }); return runtime;
}
const start = runtime => runtime.dispatch({ type: 'session.start', sessionId: 'local-session', agentId: 'fixture', runtime: 'local' });
const prompt = (runtime, turnId, text) => runtime.dispatch({ type: 'session.prompt', sessionId: 'local-session', turnId, text });
const hasAnswer = text => events.some(e => e.type === 'session.event' && e.event?.content?.text === text);
const drain = runtime => runtime.drain({ deadlineMs: 0, abortGraceMs: 0 });

const restarting = process.argv[2] === 'restart';
if (restarting) {
  // Separate OS process: no old runtime, SDK connection, store object or heap.
  const runtime = makeRuntime('local-process-two');
  try {
    assert.equal((await checkpointStore().load()).lastCompletedTurnId, 'durable-turn');
    await start(runtime); assert.equal(runtime.hasSession('local-session'), true);
    assert.equal(loads, 1);
    assert.equal((await checkpointStore().load()).generation, 2);
    const beforeReplay = trace.length;
    await prompt(runtime, 'durable-turn', 'must-not-replay'); assert.equal(trace.length, beforeReplay);
    assert.ok(events.some(e => e.type === 'session.complete' && e.turnId === 'durable-turn'));
    await prompt(runtime, 'recall-turn', 'recall');
    assert.ok(hasAnswer('history:hello|hold|permission|remember'));
    assert.equal(newSessions, 0); assert.equal(spawns, 1);
    assert.deepEqual(events.filter(e => e.type === 'session.error'), []);
    process.stdout.write(JSON.stringify({ ok: true, phase: 'restart', spawns, newSessions, loads, trace }) + '\n');
  } finally { await drain(runtime); }
} else {
// Minimal use must not require even a generic checkpoint owner/generation.
let runtime = makeRuntime(undefined, false);
await start(runtime);
assert.equal(runtime.hasSession('local-session'), true);
await prompt(runtime, 'plain', 'plain'); assert.ok(hasAnswer('answer:plain'));
await drain(runtime);

runtime = makeRuntime('local-process-one');
try {
  await start(runtime); assert.equal(runtime.sessionCount(), 1);
  await prompt(runtime, 'first', 'hello'); assert.ok(hasAnswer('answer:hello'));
  const running = prompt(runtime, 'steering-turn', 'hold'); await bounded(active.promise);
  assert.equal(runtime.activeTurnCount(), 1);
  await runtime.dispatch({ type: 'session.steer', sessionId: 'local-session', eventId: 'steering-input', text: 'change direction' });
  await bounded(running);
  assert.ok(hasAnswer('answer:hold'));
  assert.equal(trace.filter(s => s === 'steer:change direction').length, 1);
  assert.ok(!trace.includes('prompt:change direction')); assert.equal(cancellations, 0);

  const permission = prompt(runtime, 'permission-turn', 'permission'); await bounded(permissionSeen.promise);
  assert.equal(runtime.activeTurnCount(), 1);
  assert.ok(!events.some(e => e.type === 'session.complete' && e.turnId === 'permission-turn'));
  permissionDecision.resolve({ outcome: { outcome: 'selected', optionId: 'local-allow' } });
  await bounded(permission); assert.ok(hasAnswer('answer:permission'));

  active = deferred(); const cancelling = prompt(runtime, 'cancel-turn', 'cancel-me'); await bounded(active.promise);
  await runtime.dispatch({ type: 'session.cancel', sessionId: 'local-session', turnId: 'cancel-turn' });
  await bounded(cancelling);
  // Notification processing can finish on the following microtasks.
  for (let i = 0; i < 30 && cancellations === 0; i++) await new Promise(r => setImmediate(r));
  assert.equal(cancellations, 1); assert.equal(runtime.activeTurnCount(), 0);
  assert.ok(!hasAnswer('answer:cancel-me'));
  await prompt(runtime, 'durable-turn', 'remember');
  assert.equal((await checkpointStore().load()).lastCompletedTurnId, 'durable-turn');
  assert.deepEqual(JSON.parse(fs.readFileSync(nativePath, 'utf8')), ['hello', 'hold', 'permission', 'remember']);
  await drain(runtime);

  assert.deepEqual(events.filter(e => e.type === 'session.error'), []);
  process.stdout.write(JSON.stringify({ ok: true, phase: 'initial', spawns, newSessions, loads, cancellations, trace,
    checks: ['no-credentials', 'fs-permission', 'no-child-process', 'no-network', 'minimal-no-checkpoint', 'prompt', 'steer', 'permission', 'cancel', 'checkpoint'] }) + '\n');
} finally { permissionDecision.resolve({ outcome: { outcome: 'cancelled' } }); await drain(runtime); }
}
