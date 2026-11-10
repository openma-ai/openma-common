import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AgentSideConnection, PROTOCOL_VERSION, ndJsonStream } from "@agentclientprotocol/sdk";
import { expect, it } from "vitest";
import { AcpSessionImpl } from "../src/acp-runtime/session.js";
import { createManagedAgentsRuntime } from "../src/local-runtime/index.js";
import { createManagedAcpSupervisorHarness, type ManagedHarnessControlMessage } from "../src/managed-runtime/index.js";
import { acpSessionFixture } from "./acp-fixtures.js";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
};
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const scope = { workspaceId: "w", environmentId: "e", sessionId: "s", workId: "work" };
const start: ManagedHarnessControlMessage = { type: "session.start", sessionId: "s", agentId: "acp", runtime: "cloud" };
const prompt = (turnId: string) => ({ type: "session.prompt" as const, sessionId: "s", turnId, text: turnId });

// A strict child process is required: a late catch cannot save Node from an
// unobserved publication rejection, even when run.completed is already awaited.
it.each([401, 409])("propagates HTTP %i publication rejection without strict process exit", async code => {
  const { stdout } = await promisify(execFile)(process.execPath,
    ["--unhandled-rejections=strict", "tests/fixtures/managed-publication-rejection.mjs", String(code)],
    { cwd: process.cwd(), timeout: 5000 });
  expect(stdout).toContain(`HANDLED ${code}`);
  expect(stdout).toContain("POSTS 1");
  expect(stdout).toContain("SENDS 1");
});

it.each(["timeout", "abort", "dispose"] as const)("bounds a pending receipt by %s after the ACP RPC has completed", async mode => {
  const a = new TransformStream(), b = new TransformStream(), receipt = deferred(), rpcEnded = deferred();
  let calls = 0;
  new AgentSideConnection(conn => ({
    async initialize() { return { protocolVersion: PROTOCOL_VERSION }; },
    async newSession() { return { sessionId: "s" }; },
    async authenticate() { return {}; }, async cancel() {},
    async prompt() {
      calls++;
      await conn.sessionUpdate({ sessionId: "s", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: calls === 1 ? "OLD" : "NEW" } } });
      rpcEnded.resolve();
      return { stopReason: "end_turn" };
    },
  }), ndJsonStream(b.writable, a.readable));
  const session = new AcpSessionImpl({ id: "s", options: { agent: { command: "fake" }, perTurnTimeoutMs: mode === "timeout" ? 40 : 1000 },
    child: { stdin: a.writable, stdout: b.readable, stderr: new ReadableStream({ start(c) { c.close(); } }), exited: new Promise(() => {}), async kill() {} } });
  const abort = new AbortController();
  let settled = false, error: unknown;
  let run: Promise<void> | undefined;
  const events: unknown[] = [];
  try {
    await session.init();
    run = (async () => { for await (const event of session.prompt("old", { abortSignal: abort.signal, onDispatched: () => receipt.promise })) events.push(event); })()
      .catch(e => { error = e; }).finally(() => { settled = true; });
    await rpcEnded.promise; await sleep(10);
    if (mode === "abort") abort.abort(new Error("caller cancelled"));
    if (mode === "dispose") await session.dispose();
    await sleep(70);
    expect(settled).toBe(true);
    expect(error).toBeInstanceOf(Error);
    expect(events).toEqual([]);
    expect(calls).toBe(1);
    if (mode !== "dispose") {
      const next: unknown[] = [];
      for await (const event of session.prompt("new")) next.push(event);
      receipt.resolve(); await sleep(5);
      expect(next).toContainEqual(expect.objectContaining({ content: { type: "text", text: "NEW" } }));
      expect(next).not.toContainEqual(expect.objectContaining({ content: { type: "text", text: "OLD" } }));
      expect(session.drainPendingEvents()).toEqual([]);
      expect(calls).toBe(2);
    }
  } finally { receipt.resolve(); await run; await session.dispose(); }
});

it.each(["dispose", "drain"] as const)("host %s revokes a stalled steer gate without caller signal or adapter cooperation", async mode => {
  const active = deferred(), gate = deferred(), entered = deferred(), running = deferred();
  const log: string[] = [];
  const runtime = createManagedAgentsRuntime({
    acpRuntime: { start: async () => acpSessionFixture({ acpSessionId: "a", isAlive: () => true,
      async dispose() { log.push("dispose"); active.resolve(); },
      async *prompt(_, options) { await options?.onDispatched?.(); running.resolve(); await active.promise; },
      async steer() { log.push("steer"); return "injected"; },
    }) }, sessionPreparation: { prepare: async () => ({ agent: { command: "fake" } }) },
  });
  runtime.attach({ publish() {} }); await runtime.dispatch(start);
  const first = runtime.dispatch(prompt("first")); await running.promise;
  let settled = false;
  const steer = runtime.dispatch({ type: "session.steer", sessionId: "s", eventId: "steer", text: "x" }, {
    beforeDispatch: async () => { entered.resolve(); await gate.promise; }, onConsumed: async () => { log.push("receipt"); },
  }).catch(() => {}).finally(() => { settled = true; });
  try {
    await entered.promise;
    if (mode === "dispose") await runtime.dispatch({ type: "session.dispose", sessionId: "s" });
    else await runtime.drain({ deadlineMs: 0, abortGraceMs: 0 });
    await sleep(10);
    expect(settled).toBe(true);
    gate.resolve(); await steer; await first;
    expect(log).toEqual(["dispose"]);
  } finally { gate.resolve(); active.resolve(); await steer; await first; }
});

it("drain revokes pending steer admission before its nonzero grace window ends", async () => {
  const active = deferred(), running = deferred(), gate = deferred(), entered = deferred();
  const waiting = deferred(), release = deferred();
  const log: string[] = [];
  let clock = 0;
  const runtime = createManagedAgentsRuntime({
    scheduler: { now: () => clock, async sleep() { waiting.resolve(); await release.promise; clock = 100; } },
    acpRuntime: { start: async () => acpSessionFixture({ acpSessionId: "a", isAlive: () => true,
      async dispose() { log.push("dispose"); active.resolve(); },
      async *prompt() { running.resolve(); await active.promise; },
      async steer() { log.push("steer"); return "injected"; },
    }) }, sessionPreparation: { prepare: async () => ({ agent: { command: "fake" } }) },
  });
  runtime.attach({ publish() {} }); await runtime.dispatch(start);
  const first = runtime.dispatch(prompt("first")); await running.promise;
  const pending = runtime.dispatch({ type: "session.steer", sessionId: "s", eventId: "steer", text: "x" }, {
    beforeDispatch: async () => { entered.resolve(); await gate.promise; },
    onConsumed: async () => { log.push("receipt"); },
  }).catch(() => {});
  await entered.promise;
  const drain = runtime.drain({ deadlineMs: 100, pollIntervalMs: 10, abortGraceMs: 0 });
  await waiting.promise;
  try {
    gate.resolve(); await pending;
    expect(log).toEqual([]);
  } finally { release.resolve(); gate.resolve(); await drain; await first; }
});

it("drain preserves an accepted fallback prompt until its grace deadline", async () => {
  const active = deferred(), accepted = deferred(), waiting = deferred(), release = deferred();
  let clock = 0;
  let executionSignal: AbortSignal | undefined;
  const runtime = createManagedAgentsRuntime({
    scheduler: { now: () => clock, async sleep() { waiting.resolve(); await release.promise; clock = 100; } },
    acpRuntime: { start: async () => acpSessionFixture({ acpSessionId: "a", isAlive: () => true,
      async dispose() { active.resolve(); },
      async *prompt(_, options) {
        executionSignal = options?.abortSignal;
        await options?.onDispatched?.(); await active.promise;
      },
    }) }, sessionPreparation: { prepare: async () => ({ agent: { command: "fake" } }) },
  });
  runtime.attach({ publish() {} }); await runtime.dispatch(start);
  const fallback = runtime.dispatch({ type: "session.steer", sessionId: "s", eventId: "fallback", text: "x" }, {
    beforeDispatch: async () => {}, onConsumed: async () => { accepted.resolve(); },
  });
  await accepted.promise;
  const drain = runtime.drain({ deadlineMs: 100, pollIntervalMs: 10, abortGraceMs: 0 });
  await waiting.promise;
  try {
    expect(executionSignal).toBeDefined();
    expect(executionSignal!.aborted).toBe(false);
    active.resolve(); await fallback;
  } finally { active.resolve(); release.resolve(); await fallback; await drain; }
});

it.each([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])("checks admission at the final prompt dispatch boundary (microtask %i)", async depth => {
  const active = deferred(), gate = deferred(), entered = deferred(), release = deferred();
  let clock = 0, draining = false, lateInvocations = 0;
  let drain: Promise<unknown> | undefined;
  const runtime = createManagedAgentsRuntime({
    scheduler: { now: () => clock, async sleep() { await release.promise; clock = 100; } },
    acpRuntime: { start: async () => acpSessionFixture({ acpSessionId: "a", isAlive: () => true,
      async dispose() { active.resolve(); },
      prompt(_, options) {
        if (draining) lateInvocations++;
        return (async function* () { await options?.onDispatched?.(); await active.promise; })();
      },
    }) }, sessionPreparation: { prepare: async () => ({ agent: { command: "fake" } }) },
  });
  runtime.attach({ publish() {} }); await runtime.dispatch(start);
  const pending = runtime.dispatch({ type: "session.steer", sessionId: "s", eventId: "handoff", text: "x" }, {
    beforeDispatch() { entered.resolve(); return gate.promise; }, onConsumed: async () => {},
  }).catch(() => {});
  await entered.promise;
  gate.resolve();
  const beginDrain = (remaining: number) => {
    if (remaining > 0) queueMicrotask(() => beginDrain(remaining - 1));
    else { draining = true; drain = runtime.drain({ deadlineMs: 100, pollIntervalMs: 10, abortGraceMs: 0 }); }
  };
  beginDrain(depth);
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(draining).toBe(true);
    expect(lateInvocations).toBe(0);
  } finally { active.resolve(); release.resolve(); await pending; await drain; }
});

it.each(["stop", "abort"] as const)("supervisor %s settles a noncooperative initial gate and never sends queued or late prompts", async mode => {
  const gate = deferred(), entered = deferred(); const log: string[] = []; const abort = new AbortController();
  const harness = createManagedAcpSupervisorHarness({
    connect: async () => ({
      async *commands() { yield start; yield prompt("first"); yield prompt("second"); yield { type: "control.complete", workId: "work" }; },
      async publish() {}, async close() {}, beforeDispatch: async () => { entered.resolve(); await gate.promise; },
    }),
    acpRuntime: { start: async () => acpSessionFixture({ acpSessionId: "a", async *prompt() { log.push("sent"); } }) },
    sessionPreparation: { prepare: async () => ({ agent: { command: "fake" } }) },
    sessionState: { beforeStart: async command => ({ command }), onReady: async () => {}, checkpoint: async () => {}, release: async () => {} },
    drainDeadlineMs: 0, abortGraceMs: 0,
  });
  const run = await harness.start({ scope, harness: { id: "a", version: "1" }, workspacePath: "/workspace", outputPath: null, checkpoint: async () => {}, signal: abort.signal });
  let settled = false;
  const done = run.completed.finally(() => { settled = true; });
  try {
    await entered.promise; await sleep(5);
    if (mode === "stop") await run.stop("aborted"); else abort.abort();
    await sleep(25); expect(settled).toBe(true);
    gate.resolve(); await done; expect(log).toEqual([]);
  } finally { gate.resolve(); await done; await run.stop("aborted"); }
});

it.each(["timeout", "abort"] as const)("pending receipt %s preserves unknown/no-replay while a late receipt cannot finish a successor", async mode => {
  const a = new TransformStream(), b = new TransformStream(), receipt = deferred(), firstRpc = deferred(), secondRpc = deferred(), finishSecond = deferred();
  let calls = 0, cancels = 0;
  new AgentSideConnection(() => ({
    async initialize() { return { protocolVersion: PROTOCOL_VERSION }; },
    async newSession() { return { sessionId: "s" }; },
    async authenticate() { return {}; }, async cancel() { cancels++; },
    async prompt() {
      if (++calls === 1) firstRpc.resolve();
      else { secondRpc.resolve(); await finishSecond.promise; }
      return { stopReason: "end_turn" };
    },
  }), ndJsonStream(b.writable, a.readable));
  const session = new AcpSessionImpl({ id: "s", options: { agent: { command: "fake" }, perTurnTimeoutMs: mode === "timeout" ? 100 : 1000 },
    child: { stdin: a.writable, stdout: b.readable, stderr: new ReadableStream({ start(c) { c.close(); } }), exited: new Promise(() => {}), async kill() {} } });
  const runtime = createManagedAgentsRuntime({ acpRuntime: { start: async () => session }, sessionPreparation: { prepare: async () => session.options } });
  const events: unknown[] = []; runtime.attach({ publish(event) { events.push(event); } });
  const abort = new AbortController();
  let error: unknown, next: Promise<void> | undefined, nextDone = false;
  try {
    await session.init(); await runtime.dispatch(start);
    const hooks = { signal: abort.signal, beforeDispatch: async () => {}, onConsumed: () => receipt.promise };
    const old = runtime.dispatch(prompt("old"), hooks).catch(e => { error = e; });
    await firstRpc.promise; await sleep(10);
    if (mode === "abort") abort.abort(new Error("caller cancelled"));
    await Promise.race([old, sleep(200)]);
    expect(error).toMatchObject({ name: "ManagedAgentsInputDispatchError", outcome: "unknown", inputId: "old" });
    expect(calls).toBe(1); expect(cancels).toBe(0);
    await expect(runtime.dispatch(prompt("old"), hooks)).rejects.toBe(error);
    expect(calls).toBe(1);
    next = runtime.dispatch(prompt("new")).finally(() => { nextDone = true; });
    await secondRpc.promise;
    receipt.resolve(); await sleep(5);
    expect(nextDone).toBe(false);
    expect(events).not.toContainEqual(expect.objectContaining({ type: "session.complete", turnId: "old" }));
    finishSecond.resolve(); await next;
    expect(events).toContainEqual(expect.objectContaining({ type: "session.complete", turnId: "new" }));
    await expect(runtime.dispatch(prompt("old"), hooks)).rejects.toBe(error);
    expect(calls).toBe(2);
  } finally { receipt.resolve(); finishSecond.resolve(); await next; await session.dispose(); }
});
