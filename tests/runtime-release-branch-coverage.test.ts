import { describe, expect, it } from "vitest";
import {
  createManagedAcpSupervisorHarness,
  type ManagedAcpSupervisorHarnessOptions,
  type ManagedHarnessControlChannel,
  type ManagedHarnessControlMessage,
  type ManagedHarnessPublishedEvent,
  type ManagedHarnessTurnCompletion,
} from "../src/managed-runtime/index.js";
import { createManagedAgentsRuntime, ManagedAgentsSessionHost } from "../src/local-runtime/index.js";
import { acpSessionFixture } from "./acp-fixtures.js";

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
const start = { type: "session.start", sessionId: "s", agentId: "fixture", runtime: "cloud" } as const;
const prompt = (turnId: string) => ({ type: "session.prompt", sessionId: "s", turnId, text: turnId }) as const;
const steer = { type: "session.steer", sessionId: "s", eventId: "steer", text: "steer" } as const;
const cancel = { type: "session.cancel", sessionId: "s", turnId: "root" } as const;
type Native = Parameters<typeof acpSessionFixture>[0];

// External ACP and persistence are the only doubles. Dispatch, holding of
// completions, continuation/revision sequencing and event publication are real.
async function harness(config: {
  native?: Partial<Native>;
  commands?(): AsyncIterable<ManagedHarnessControlMessage>;
  channel?: Partial<ManagedHarnessControlChannel>;
  onTurnComplete?: ManagedAcpSupervisorHarnessOptions["onTurnComplete"];
  finalization?: ManagedAcpSupervisorHarnessOptions["finalization"];
  strict?: boolean;
} = {}) {
  const events: ManagedHarnessPublishedEvent[] = [];
  const effects: string[] = [];
  const sends: string[] = [];
  const parent = new AbortController();
  const native = acpSessionFixture({
    acpSessionId: "native",
    async *prompt(text, options) {
      sends.push(text);
      await options?.onDispatched?.();
      if (config.native?.prompt) yield* config.native.prompt(text, options);
      else yield { type: "promptComplete", response: {} };
    },
    isAlive: config.native?.isAlive,
    steer: config.native?.steer,
    dispose: config.native?.dispose,
  });
  const run = await createManagedAcpSupervisorHarness({
    connect: async () => ({
      async *commands() {
        if (config.commands) yield* config.commands();
        else { yield start; yield prompt("root"); }
        yield { type: "control.complete", workId: "work" };
      },
      async publish(event) { events.push(event); },
      async close() { effects.push("close"); },
      ...config.channel,
    }),
    acpRuntime: { async start() { return native; } },
    sessionPreparation: { async prepare() { return { agent: { command: "fixture" } }; } },
    sessionState: {
      async beforeStart(command) { return { command }; },
      async onReady() {},
      async checkpoint({ turnId }) { effects.push(`native:${turnId ?? "shutdown"}`); },
      async release() {},
    },
    onTurnComplete: config.onTurnComplete,
    ...(config.strict === false ? {} : { finalization: config.finalization ?? {
      async drainTurn() { effects.push("drain"); },
      async afterTerminal() { effects.push("after-terminal"); },
    } }),
    drainDeadlineMs: 0,
    abortGraceMs: 0,
  }).start({
    scope: { workspaceId: "w", environmentId: "e", sessionId: "s", workId: "work" },
    harness: { id: "fixture", version: "1" }, workspacePath: "/workspace", outputPath: null,
    signal: parent.signal,
    async checkpoint({ turnId }) { effects.push(`canonical:${turnId}`); },
  });
  void run.completed.catch(() => undefined);
  return { run, events, effects, sends, parent };
}
const terminals = (events: ManagedHarnessPublishedEvent[]) => events.filter(e => e.type === "session.complete");

describe("release branch boundaries through public runtime entry points", () => {
  it("does not acknowledge or replay a prompt whose adapter never acknowledged dispatch", async () => {
    let sends = 0;
    const events: unknown[] = [];
    const runtime = createManagedAgentsRuntime({
      acpRuntime: { async start() { return acpSessionFixture({ acpSessionId: "a", async *prompt() { sends++; } }); } },
      sessionPreparation: { async prepare() { return { agent: { command: "fixture" } }; } },
    });
    runtime.attach({ publish(event) { events.push(event); } });
    await runtime.dispatch(start);
    const hooks = { async beforeDispatch() {}, async onConsumed() { throw new Error("must not consume"); } };
    try {
      const failure = await runtime.dispatch(prompt("missing-ack"), hooks).catch(error => error);
      expect(failure).toMatchObject({ name: "ManagedAgentsInputDispatchError", phase: "dispatch", outcome: "unknown" });
      expect(failure.cause).toBeInstanceOf(Error);
      expect(failure.cause.message).toBe("ACP adapter did not report prompt dispatch");
      await expect(runtime.dispatch(prompt("missing-ack"), hooks)).rejects.toBe(failure);
      expect(sends).toBe(1);
      expect(events).not.toContainEqual(expect.objectContaining({ type: "session.complete" }));
    } finally { await runtime.drain({ deadlineMs: 0, abortGraceMs: 0 }); }
  });

  it("turns an acknowledged promptError into an unknown fenced failure, not a successful receipt-only completion", async () => {
    let sends = 0, receipts = 0;
    const runtime = createManagedAgentsRuntime({
      acpRuntime: { async start() { return acpSessionFixture({ acpSessionId: "a", async *prompt(_, options) {
        sends++; await options?.onDispatched?.(); yield { type: "promptError", error: "backend rejected turn" };
      } }); } },
      sessionPreparation: { async prepare() { return { agent: { command: "fixture" } }; } },
    });
    const events: unknown[] = [];
    runtime.attach({ publish(event) { events.push(event); } });
    await runtime.dispatch(start);
    const hooks = { async beforeDispatch() {}, async onConsumed() { receipts++; } };
    try {
      const failure = await runtime.dispatch(prompt("failed"), hooks).catch(error => error);
      expect(failure).toMatchObject({ phase: "dispatch", outcome: "unknown", cause: "backend rejected turn" });
      await expect(runtime.dispatch(prompt("failed"), hooks)).rejects.toBe(failure);
      expect([sends, receipts]).toEqual([1, 1]);
      expect(events).not.toContainEqual(expect.objectContaining({ type: "session.complete" }));
    } finally { await runtime.drain({ deadlineMs: 0, abortGraceMs: 0 }); }
  });

  it.each(["dispose", "disposeAll"] as const)("%s of an old native session cannot erase its replacement after an async disposal", async method => {
    const entered = gate(), release = gate();
    let alive = true, starts = 0;
    const events: unknown[] = [];
    const host = new ManagedAgentsSessionHost({
      runtime: { async start() {
        starts++;
        return starts === 1 ? acpSessionFixture({ acpSessionId: "old", isAlive: () => alive,
          async dispose() { alive = false; entered.resolve(); await release.promise; },
        }) : acpSessionFixture({ acpSessionId: "replacement" });
      } }, emit(event) { events.push(event); },
    });
    const input = { sessionId: "s", options: { agent: { command: "fixture" } } };
    await host.start(input);
    const disposing = method === "dispose" ? host.dispose("s") : host.disposeAll();
    try {
      await entered.promise;
      await host.start(input);
      release.resolve(); await disposing;
      expect(host.has("s")).toBe(true);
      await host.prompt({ sessionId: "s", turnId: "replacement-turn", text: "hello" });
      expect(events).toContainEqual({ type: "session.ready", sessionId: "s", acpSessionId: "replacement" });
      expect(events).toContainEqual({ type: "session.complete", sessionId: "s", turnId: "replacement-turn" });
      expect(starts).toBe(2);
    } finally { release.resolve(); await disposing; await host.disposeAll(); }
  });

  it("preserves a non-Error persistence rejection and forbids terminal publication", async () => {
    const f = await harness({ finalization: {
      async drainTurn() { throw "storage offline"; },
      async afterTerminal() { throw new Error("must not publish artifacts"); },
    } });
    try {
      await expect(f.run.completed).rejects.toMatchObject({
        name: "ManagedHarnessFinalizationError", phase: "drain-turn", terminalState: "not-published",
        cause: "storage offline", message: "Managed turn finalization failed (drain-turn): storage offline",
      });
      expect(terminals(f.events)).toEqual([]);
      expect(f.effects).toEqual([]);
    } finally { await f.run.stop("failed"); }
  });

  it("rejects revisions submitted after the completion boundary without another model call", async () => {
    let boundary: ManagedHarnessTurnCompletion | undefined;
    const f = await harness({ async onTurnComplete(turn) { boundary = turn; } });
    try {
      await expect(f.run.completed).resolves.toEqual({ exitCode: 0 });
      expect(boundary).toBeDefined();
      await expect(boundary!.runRevision({ turnId: "late", text: "late" })).rejects.toThrow("Turn completion boundary is closed");
      expect(f.sends).toEqual(["root"]);
      expect(terminals(f.events)).toEqual([{ type: "session.complete", sessionId: "s", turnId: "root" }]);
    } finally { await f.run.stop("aborted"); }
  });

  it("rejects reuse of the canonical turn id by a revision before native dispatch or terminal publication", async () => {
    const f = await harness({ async onTurnComplete(turn) { await turn.runRevision({ turnId: "root", text: "invalid revision" }); } });
    try {
      await expect(f.run.completed).rejects.toThrow("Revision requires a distinct turnId");
      expect(f.sends).toEqual(["root"]);
      expect(terminals(f.events)).toEqual([]);
      expect(f.effects).toEqual([]);
    } finally { await f.run.stop("failed"); }
  });

  it("reports a dead continuation session instead of finalizing the successful root", async () => {
    const active = gate(), release = gate();
    let alive = true;
    const f = await harness({
      native: {
        isAlive: () => alive,
        async *prompt() { active.resolve(); await release.promise; yield { type: "promptComplete", response: {} }; },
        async steer() { return "promptRequired"; },
      },
      channel: {
        async beforeDispatch() {},
        async fallbackOwner() { alive = false; release.resolve(); return "root"; },
      },
      async *commands() { yield start; yield prompt("root"); await active.promise; yield steer; },
    });
    try {
      await expect(f.run.completed).rejects.toThrow("no such session");
      expect(f.sends).toEqual(["root"]);
      expect(f.events).toContainEqual({ type: "session.error", sessionId: "s", turnId: "steer", message: "no such session" });
      expect(terminals(f.events)).toEqual([]);
      expect(f.effects).toEqual([]);
    } finally { release.resolve(); await f.run.stop("failed"); }
  });
  it("cancellation after a dispatch gate ACK still prevents the native send", async () => {
    const entered = gate(), release = gate();
    const f = await harness({ channel: {
      async beforeDispatch() { entered.resolve(); await release.promise; },
    } });
    try {
      await entered.promise;
      release.resolve();
      // The gate resolves first; cancellation runs before its awaiter resumes.
      queueMicrotask(() => queueMicrotask(() => f.parent.abort(new Error("revoked after gate ACK"))));
      await expect(f.run.completed).resolves.toEqual({ exitCode: 0 });
      expect(f.sends).toEqual([]);
      expect(terminals(f.events)).toEqual([]);
      expect(f.effects).toEqual([]);
    } finally { release.resolve(); await f.run.stop("aborted"); }
  });

  it("rejects a confirmed continuation whose canonical owner is absent", async () => {
    const active = gate(), release = gate();
    const f = await harness({
      native: {
        async *prompt() { active.resolve(); await release.promise; },
        async steer() { return "promptRequired"; },
      },
      channel: { async beforeDispatch() {}, async fallbackOwner() { release.resolve(); return "unknown-root"; } },
      async *commands() { yield start; yield prompt("root"); await active.promise; yield steer; },
    });
    try {
      await expect(f.run.completed).rejects.toThrow("Continuation root is unavailable");
      expect(f.sends).toEqual(["root"]);
      expect(terminals(f.events)).toEqual([]);
    } finally { release.resolve(); await f.run.stop("failed"); }
  });

  it("does not mistake an already-running legacy fallback for a completed revision", async () => {
    const active = gate(), releaseRoot = gate(), fallbackActive = gate(), releaseFallback = gate();
    const f = await harness({
      strict: false,
      native: {
        async *prompt(text, options) {
          if (text === "root") { active.resolve(); await releaseRoot.promise; }
          else {
            options?.abortSignal?.addEventListener("abort", releaseFallback.resolve, { once: true });
            fallbackActive.resolve(); await releaseFallback.promise;
          }
        },
        async steer() { return "promptRequired"; },
      },
      async *commands() { yield start; yield prompt("root"); await active.promise; yield steer; await fallbackActive.promise; releaseRoot.resolve(); },
      async onTurnComplete(turn) {
        if (turn.command.turnId === "root") await turn.runRevision({ turnId: "steer", text: "revision" });
      },
    });
    try {
      await expect(f.run.completed).rejects.toThrow("Revision did not complete");
      expect(f.sends).toEqual(["root", "steer"]);
      expect(terminals(f.events).filter(event => event.turnId === "root")).toEqual([]);
    } finally { releaseRoot.resolve(); releaseFallback.resolve(); await f.run.stop("failed"); }
  });

  it.each([0, 1, 2, 3])("post-evaluation cancellation (handoff %i) skips persistence and allows the next root", async handoff => {
    const evaluated = gate();
    const f = await harness({
      async onTurnComplete(turn) { if (turn.command.turnId === "root") evaluated.resolve(); },
      async *commands() {
        yield start; yield prompt("root"); await evaluated.promise;
        for (let i = 0; i < handoff; i++) await Promise.resolve();
        yield cancel; yield prompt("followup");
      },
    });
    try {
      await expect(f.run.completed).resolves.toEqual({ exitCode: 0 });
      expect(f.sends).toEqual(["root", "followup"]);
      expect(terminals(f.events)).toEqual([{ type: "session.complete", sessionId: "s", turnId: "followup" }]);
      expect(f.effects).toEqual(["drain", "native:followup", "canonical:followup", "after-terminal"]);
    } finally { await f.run.stop("aborted"); }
  });

});
