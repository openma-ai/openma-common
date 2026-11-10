import { describe, expect, it } from "vitest";
import type { AcpRuntime } from "../src/acp-runtime/index.js";
import {
  createManagedAcpSupervisorHarness,
  type ManagedAcpSupervisorHarnessOptions,
  type ManagedHarnessControlMessage,
  type ManagedHarnessPublishedEvent,
} from "../src/managed-runtime/index.js";

const scope = { workspaceId: "w", environmentId: "e", sessionId: "s", workId: "work" };
const start: ManagedHarnessControlMessage = { type: "session.start", sessionId: "s", agentId: "agent", runtime: "cloud" };
const prompt = (turnId: string): ManagedHarnessControlMessage => ({ type: "session.prompt", sessionId: "s", turnId, text: turnId });
const steer: ManagedHarnessControlMessage = { type: "session.steer", sessionId: "s", eventId: "steer", text: "steer" };
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

// Only the native ACP process and external persistence are Ports. All dispatch,
// completion holding, sequencing, and publication use the real public runtime.
async function fixture(config: {
  commands?: (signal: AbortSignal) => AsyncIterable<ManagedHarnessControlMessage>;
  prompt?(text: string): Promise<void>;
  steer?(): Promise<"injected" | "promptRequired">;
  drain?(): Promise<void>;
  native?(): Promise<void>;
  checkpoint?(): Promise<void>;
  terminal?(): Promise<void>;
  post?(): Promise<void>;
  onTurnComplete?: ManagedAcpSupervisorHarnessOptions["onTurnComplete"];
  legacy?: boolean;
  missingCheckpoint?: boolean;
  receipt?(): Promise<void>;
  partialFinalization?: boolean;
  continuationOwner?: string;
  beforeDispatch?(turnId: string, kind?: "prompt" | "steer"): Promise<void>;
} = {}) {
  const log: string[] = [], events: ManagedHarnessPublishedEvent[] = [];
  const parent = new AbortController();
  const acpRuntime: AcpRuntime = {
    async start(options) {
      log.push("start");
      return {
        id: "native", acpSessionId: "native", options,
        supportsSteering: true, isAlive: () => true,
        async *prompt(text: unknown, input?: { onDispatched?(): Promise<void> }) {
          log.push(`model:${text}`);
          await input?.onDispatched?.();
          await config.prompt?.(String(text));
          yield { sessionUpdate: "agent_message_chunk", content: { type: "text", text: String(text) } };
          yield { type: "promptComplete" };
          log.push(`iterator-settled:${text}`);
        },
        async steer() { log.push("native-steer"); return config.steer?.() ?? "injected"; },
        async dispose() { log.push("dispose"); },
      } as never;
    },
  };
  const finalization = {
    async drainTurn() { log.push("activity:start"); await config.drain?.(); log.push("activity:settled"); },
    async afterTerminal() { log.push("post:start"); await config.post?.(); log.push("post:done"); },
  };
  const options: ManagedAcpSupervisorHarnessOptions = {
    connect: async () => ({
      async *commands(signal) {
        if (config.commands) yield* config.commands(signal);
        else { yield start; yield prompt("first"); }
        yield { type: "control.complete", workId: "work" };
      },
      async publish(event) {
        if (event.type === "session.complete") {
          log.push(`terminal:${event.turnId}`);
          await config.terminal?.();
        }
        events.push(event);
      },
      async close() { log.push("close"); },
      ...(config.continuationOwner ? {fallbackOwner:async()=>config.continuationOwner!,beforeDispatch:async(command, _signal, kind)=>{await config.beforeDispatch?.(command.turnId,kind);}} : {}),
      ...(config.receipt ? { async onConsumed() { await config.receipt!(); } } : {}),
    }),
    acpRuntime,
    sessionPreparation: { async prepare() { return { agent: { command: "fixture" } }; } },
    sessionState: {
      async beforeStart(command) { return { command }; },
      async onReady() {},
      async checkpoint({ turnId }) {
        log.push(`native:${turnId ?? "shutdown"}`);
        if (turnId) await config.native?.();
      },
      async release() {},
    },
    onTurnComplete: config.onTurnComplete,
    ...(!config.legacy ? { finalization: config.partialFinalization ? { drainTurn: finalization.drainTurn } as typeof finalization : finalization } : {}),
  };
  const run = await createManagedAcpSupervisorHarness(options).start({
    scope, harness: { id: "acp", version: "1" }, workspacePath: "/workspace", outputPath: null,
    signal: parent.signal,
    checkpoint: config.missingCheckpoint ? undefined as never : async ({ turnId }) => { log.push(`canonical:${turnId}`); await config.checkpoint?.(); },
  });
  // Observe rejection immediately; tests below assert the same original promise.
  void run.completed.catch(() => undefined);
  return { run, log, events, parent };
}

const terminals = (events: ManagedHarnessPublishedEvent[]) => events.filter(e => e.type === "session.complete");

describe("opt-in pre-terminal finalization through public runtime", () => {
  it("waits real external activity before native/canonical persistence and terminal, without disposing the session", async () => {
    const entered = gate(), activity = gate();
    const f = await fixture({ drain: async () => { entered.resolve(); await activity.promise; } });
    try {
      // Existing runtime ignores the new port; race completion so RED never hangs.
      await Promise.race([entered.promise, f.run.completed]);
      expect(f.log).toContain("activity:start");
      expect(terminals(f.events)).toEqual([]);
      expect(f.log).not.toContain("native:first");
      activity.resolve();
      await f.run.completed;
      expect(f.log).toEqual(["start", "model:first", "iterator-settled:first", "activity:start", "activity:settled", "native:first", "canonical:first", "terminal:first", "post:start", "post:done"]);
    } finally { activity.resolve(); await f.run.stop("aborted"); }
  });

  it.each(["drain", "native", "checkpoint"] as const)("%s failure prevents successful terminal and post publication", async phase => {
    const f = await fixture({ [phase]: async () => { throw new Error(`failed ${phase}`); } });
    try {
      await expect(f.run.completed).rejects.toThrow(`failed ${phase}`);
      expect(terminals(f.events)).toEqual([]);
      expect(f.log).not.toContain("post:start");
    } finally { await f.run.stop("failed"); }
  });

  it("reports acknowledged terminal on post failure and never starts the queued next model", async () => {
    const f = await fixture({
      async *commands() { yield start; yield prompt("first"); yield prompt("second"); },
      async post() { throw new Error("artifact upload failed"); },
    });
    try {
      await expect(f.run.completed).rejects.toMatchObject({ name: "ManagedHarnessFinalizationError", phase: "after-terminal", terminalState: "published" });
      expect(terminals(f.events)).toHaveLength(1);
      expect(f.log.filter(x => x.startsWith("model:"))).toEqual(["model:first"]);
    } finally { await f.run.stop("failed"); }
  });

  it("treats rejected terminal transport as unknown, not permission to replay or run post", async () => {
    const f = await fixture({ async terminal() { throw new Error("lost acknowledgement"); } });
    try {
      await expect(f.run.completed).rejects.toMatchObject({ phase: "terminal", terminalState: "unknown" });
      expect(f.log).not.toContain("post:start");
      expect(f.log.filter(x => x.startsWith("model:"))).toEqual(["model:first"]);
    } finally { await f.run.stop("failed"); }
  });

  it("applies the barrier for every turn while preserving one live native session", async () => {
    const f = await fixture({ async *commands() { yield start; yield prompt("first"); yield prompt("second"); } });
    try {
      await f.run.completed;
      expect(f.log.filter(x => x === "activity:settled")).toHaveLength(2);
      expect(f.log.filter(x => x === "start")).toHaveLength(1);
      expect(f.log).not.toContain("dispose");
      expect(f.log.indexOf("canonical:first")).toBeLessThan(f.log.indexOf("terminal:first"));
      expect(f.log.indexOf("canonical:second")).toBeLessThan(f.log.indexOf("terminal:second"));
      expect(f.log.indexOf("post:done")).toBeLessThan(f.log.indexOf("model:second"));
    } finally { await f.run.stop("aborted"); }
  });

  it("holds outcome revisions under one canonical terminal barrier", async () => {
    const f = await fixture({ async onTurnComplete(turn) {
      await turn.runRevision({ turnId: "r1", text: "r1" });
      // Also await a revision that the callback forgot to await itself.
      void turn.runRevision({ turnId: "r2", text: "r2" });
    } });
    try {
      await f.run.completed;
      expect(f.log.filter(x => x.startsWith("model:"))).toEqual(["model:first", "model:r1", "model:r2"]);
      expect(f.log.indexOf("iterator-settled:r2")).toBeLessThan(f.log.indexOf("activity:start"));
      expect(f.log.indexOf("canonical:first")).toBeLessThan(f.log.indexOf("terminal:first"));
      expect(terminals(f.events).map(e => "turnId" in e ? e.turnId : undefined)).toEqual(["first"]);
    } finally { await f.run.stop("aborted"); }
  });

  it("routes idle steer fallback through the same pre/post barrier even without input hooks", async () => {
    const f = await fixture({ async *commands() { yield start; yield steer; } });
    try {
      await f.run.completed;
      expect(f.log).toContain("activity:settled");
      expect(f.log.indexOf("canonical:steer")).toBeLessThan(f.log.indexOf("terminal:steer"));
      expect(f.log).toContain("post:done");
    } finally { await f.run.stop("aborted"); }
  });

  it.each(["drain", "native", "checkpoint"] as const)("revokes success when aborted during %s, even if that IO ignores cancellation", async phase => {
    const entered = gate(), io = gate();
    const f = await fixture({ [phase]: async () => { entered.resolve(); await io.promise; } });
    try {
      await Promise.race([entered.promise, f.run.completed]);
      expect(f.log).toContain("activity:start");
      f.parent.abort(new Error("claim lost"));
      io.resolve();
      await Promise.allSettled([f.run.completed]);
      expect(terminals(f.events)).toEqual([]);
      expect(f.log).not.toContain("post:start");
    } finally { io.resolve(); await f.run.stop("aborted"); }
  });

  it("waits admitted native steer receipts before opening the safe point", async () => {
    const model = gate(), modelStarted = gate(), steerStarted = gate(), receipt = gate();
    const f = await fixture({
      async *commands() { yield start; yield prompt("first"); await modelStarted.promise; yield steer; },
      async prompt() { modelStarted.resolve(); await model.promise; },
      async steer() { steerStarted.resolve(); await receipt.promise; return "injected"; },
    });
    try {
      await steerStarted.promise;
      model.resolve();
      // Let the native prompt finish, while steer remains outstanding.
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(f.log).not.toContain("activity:start");
      expect(terminals(f.events)).toEqual([]);
      receipt.resolve();
      await f.run.completed;
      expect(f.log).toContain("activity:settled");
    } finally { model.resolve(); receipt.resolve(); await f.run.stop("aborted"); }
  });

  it("serializes a promptRequired fallback behind the active terminal without self-deadlock", async () => {
    const model = gate(), modelStarted = gate(), steerStarted = gate();
    const f = await fixture({
      async *commands() { yield start; yield prompt("first"); await modelStarted.promise; yield steer; },
      async prompt(text) { if (text === "first") { modelStarted.resolve(); await model.promise; } },
      async steer() { steerStarted.resolve(); return "promptRequired"; },
    });
    try {
      await steerStarted.promise; model.resolve(); await f.run.completed;
      expect(f.log.indexOf("terminal:first")).toBeLessThan(f.log.indexOf("model:steer"));
      expect(f.log.indexOf("canonical:steer")).toBeLessThan(f.log.indexOf("terminal:steer"));
      expect(f.log.filter(x => x === "activity:settled")).toHaveLength(2);
    } finally { model.resolve(); await f.run.stop("aborted"); }
  });

  it("queues a steer arriving during canonical persistence until after post publication", async () => {
    const entered = gate(), io = gate(), steerSent = gate();
    const f = await fixture({
      async *commands() { yield start; yield prompt("first"); await entered.promise; yield steer; steerSent.resolve(); },
      async checkpoint() { entered.resolve(); await io.promise; },
    });
    try {
      await steerSent.promise;
      expect(f.log).not.toContain("native-steer");
      expect(f.log).not.toContain("model:steer");
      io.resolve(); await f.run.completed;
      expect(f.log.indexOf("post:done")).toBeLessThan(f.log.indexOf("model:steer"));
      expect(terminals(f.events)).toHaveLength(2);
    } finally { io.resolve(); await f.run.stop("aborted"); }
  });

  it("does not report clean completion when abort races an acknowledged terminal and failed artifact publication", async () => {
    const entered = gate(), io = gate();
    const f = await fixture({ async post() { entered.resolve(); await io.promise; throw new Error("post failed after abort"); } });
    try {
      await entered.promise;
      f.parent.abort(new Error("lost claim"));
      io.resolve();
      await expect(f.run.completed).rejects.toMatchObject({ phase: "after-terminal", terminalState: "published" });
      expect(terminals(f.events)).toHaveLength(1);
      expect(f.log.filter(x => x.startsWith("model:"))).toEqual(["model:first"]);
    } finally { io.resolve(); await f.run.stop("aborted"); }
  });

  it("skips unstarted finalization for an interrupted turn and runs its followup", async () => {
    const entered = gate(), release = gate();
    const f = await fixture({
      async prompt(text) { if (text === "first") { entered.resolve(); await release.promise; } },
      async *commands() {
        yield start; yield prompt("first"); await entered.promise;
        yield { type: "session.cancel", sessionId: "s", turnId: "first" };
        release.resolve(); yield prompt("second");
      },
    });
    try {
      await expect(f.run.completed).resolves.toMatchObject({ exitCode: 0 });
      expect(f.log).toContain("model:second");
      expect(f.log).not.toContain("canonical:first");
      expect(f.log).not.toContain("terminal:first");
      expect(f.log).toContain("terminal:second");
    } finally { release.resolve(); await f.run.stop("aborted"); }
  });

  it("does not turn a cancelled outcome evaluation into success", async () => {
    const f = await fixture({ async onTurnComplete(turn) { await turn.cancel(); } });
    try {
      await expect(f.run.completed).rejects.toMatchObject({ terminalState: "not-published" });
      expect(terminals(f.events)).toEqual([]);
      expect(f.log).not.toContain("canonical:first");
    } finally { await f.run.stop("aborted"); }
  });

  it("rejects missing canonical persistence before connecting/starting native execution", async () => {
    await expect(fixture({ missingCheckpoint: true })).rejects.toThrow("finalization requires input.checkpoint");
  });

  it("stop joins the revoked safe point before destroying resident native state", async () => {
    const entered = gate(), io = gate();
    const f = await fixture({ async checkpoint() { entered.resolve(); await io.promise; } });
    try {
      await entered.promise;
      const stopped = f.run.stop("aborted");
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(f.log).not.toContain("dispose");
      expect(f.log).not.toContain("native:shutdown");
      io.resolve(); await stopped;
      expect(terminals(f.events)).toEqual([]);
      expect(f.log).toContain("dispose");
    } finally { io.resolve(); await f.run.stop("aborted"); }
  });

  it("rejects a partial finalization configuration instead of installing a noop publisher", async () => {
    await expect(fixture({ partialFinalization: true })).rejects.toThrow("finalization requires drainTurn and afterTerminal");
  });

  it("does not publish until a submitted native steer acceptance receipt settles", async () => {
    const model = gate(), modelStarted = gate(), accepted = gate(), receipt = gate();
    let receipts = 0;
    const f = await fixture({
      async *commands() { yield start; yield prompt("first"); await modelStarted.promise; yield steer; },
      async prompt() { modelStarted.resolve(); await model.promise; },
      async receipt() { if (++receipts === 2) { accepted.resolve(); await receipt.promise; } },
    });
    try {
      await accepted.promise; model.resolve();
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(f.log).not.toContain("activity:start");
      expect(terminals(f.events)).toEqual([]);
      receipt.resolve(); await f.run.completed;
      expect(f.log).toContain("post:done");
    } finally { model.resolve(); receipt.resolve(); await f.run.stop("aborted"); }
  });

  it("preserves published state when abort arrives during terminal acknowledgement", async () => {
    const entered = gate(), ack = gate();
    const f = await fixture({ async terminal() { entered.resolve(); await ack.promise; } });
    try {
      await entered.promise; f.parent.abort(new Error("claim lost during ACK"));
      ack.resolve();
      await expect(f.run.completed).rejects.toMatchObject({ phase: "after-terminal", terminalState: "published" });
      expect(terminals(f.events)).toHaveLength(1);
      expect(f.log).not.toContain("post:start");
    } finally { ack.resolve(); await f.run.stop("aborted"); }
  });

  it("rejects failed outcome revision without checkpointing or publishing success", async () => {
    const f = await fixture({
      async prompt(text) { if (text === "r1") throw new Error("revision failed"); },
      async onTurnComplete(turn) { await turn.runRevision({ turnId: "r1", text: "r1" }); },
    });
    try {
      await expect(f.run.completed).rejects.toThrow("revision failed");
      expect(terminals(f.events)).toEqual([]);
      expect(f.log).not.toContain("canonical:first");
    } finally { await f.run.stop("failed"); }
  });

  it("does not report a clean work result when the native prompt fails before the safe point", async () => {
    const f = await fixture({ async prompt() { throw new Error("native turn failed"); } });
    try {
      await expect(f.run.completed).rejects.toThrow("native turn failed");
      expect(terminals(f.events)).toEqual([]);
      expect(f.log).not.toContain("canonical:first");
      expect(f.log).not.toContain("post:start");
    } finally { await f.run.stop("failed"); }
  });

  it("retains legacy callback order when not opted in", async () => {
    const f = await fixture({ legacy: true });
    try {
      await f.run.completed;
      expect(f.log.indexOf("terminal:first")).toBeLessThan(f.log.indexOf("canonical:first"));
      expect(f.log).not.toContain("activity:start");
    } finally { await f.run.stop("aborted"); }
  });
});


it("joins confirmed continuations FIFO before outcome, drain and one root terminal",async()=>{
 const started=gate(), original=gate(), both=gate();let steers=0;
 const f=await fixture({continuationOwner:"first",receipt:async()=>{},
  prompt:async text=>{if(text==="first"){started.resolve();await original.promise;}},
  steer:async()=>{if(++steers===2)both.resolve();await both.promise;original.resolve();return "promptRequired";},
  commands:async function*(){yield start;yield prompt("first");await started.promise;yield {...steer,eventId:"a",text:"a"};yield {...steer,eventId:"b",text:"b"};await both.promise;},
  onTurnComplete:async context=>{expect(context.command.turnId).toBe("first");},
 });
 await f.run.completed;expect(f.log.filter(x=>x.startsWith("model:"))).toEqual(["model:first","model:a","model:b"]);
 expect(terminals(f.events).map(e=>e.turnId)).toEqual(["first"]);
 expect(f.log.indexOf("iterator-settled:b")).toBeLessThan(f.log.indexOf("activity:start"));await f.run.drain();
});
it("cancels confirmed continuation before dispatch without publishing held completions",async()=>{
 const started=gate(), original=gate(), steering=gate(), cancelSent=gate();
 const f=await fixture({continuationOwner:"first",receipt:async()=>{},
  prompt:async()=>{started.resolve();await original.promise;},
  steer:async()=>{steering.resolve();await cancelSent.promise;original.resolve();return "promptRequired";},
  commands:async function*(){yield start;yield prompt("first");await started.promise;yield steer;await steering.promise;yield {type:"session.cancel",sessionId:"s",turnId:"first"};cancelSent.resolve();},
 });
 await f.run.completed.catch(()=>undefined);expect(f.log.filter(x=>x.startsWith("model:"))).toEqual(["model:first"]);expect(terminals(f.events)).toEqual([]);await f.run.stop("aborted");
});
it("steer arriving after continuation admission closes queues a new root",async()=>{
 const first=gate(), releaseFirst=gate(), continuing=gate(), releaseContinuation=gate();
 const f=await fixture({continuationOwner:"first",receipt:async()=>{},
  prompt:async text=>{if(text==="first"){first.resolve();await releaseFirst.promise;}if(text==="steer"){continuing.resolve();await releaseContinuation.promise;}},
  steer:async()=>{releaseFirst.resolve();return "promptRequired";},
  commands:async function*(){yield start;yield prompt("first");await first.promise;yield steer;await continuing.promise;yield {...steer,eventId:"later",text:"later"};releaseContinuation.resolve();},
 });
 await f.run.completed;expect(f.log.filter(x=>x.startsWith("model:"))).toEqual(["model:first","model:steer","model:later"]);
 expect(terminals(f.events).map(e=>e.turnId)).toEqual(["first","later"]);await f.run.drain();
});
it("late native completion after root cancellation cannot publish a continuation terminal",async()=>{
 const first=gate(), releaseFirst=gate(), continuing=gate(), releaseContinuation=gate();
 const f=await fixture({continuationOwner:"first",receipt:async()=>{},
  prompt:async text=>{if(text==="first"){first.resolve();await releaseFirst.promise;}if(text==="steer"){continuing.resolve();await releaseContinuation.promise;}},
  steer:async()=>{releaseFirst.resolve();return "promptRequired";},
  commands:async function*(){yield start;yield prompt("first");await first.promise;yield steer;await continuing.promise;yield {type:"session.cancel",sessionId:"s",turnId:"first"};releaseContinuation.resolve();},
 });
 await f.run.completed.catch(()=>undefined);expect(terminals(f.events)).toEqual([]);await f.run.stop("aborted");
});
it("native steer failure never schedules same-root continuation",async()=>{
 const first=gate(),release=gate();let owners=0;
 const f=await fixture({continuationOwner:"first",receipt:async()=>{},
  prompt:async()=>{first.resolve();await release.promise;},
  steer:async()=>{release.resolve();throw new Error("response lost");},
  commands:async function*(){yield start;yield prompt("first");await first.promise;yield steer;},
 });
 await expect(f.run.completed).rejects.toThrow();expect(f.log.filter(x=>x.startsWith("model:"))).toEqual(["model:first"]);
 expect(terminals(f.events)).toEqual([]);await f.run.stop("failed");
});

it("local fallback cannot overtake a root waiting in its dispatch gate", async () => {
  const entered = gate(), release = gate();
  const f = await fixture({ legacy: true, continuationOwner: "first", receipt: async () => {},
    beforeDispatch: async id => { if (id === "first") { entered.resolve(); await release.promise; } },
    commands: async function* () {
      yield start; yield prompt("first"); await entered.promise; yield steer;
      await new Promise(resolve => setTimeout(resolve, 0)); release.resolve();
    },
  });
  try {
    await f.run.completed;
    expect(f.log.filter(entry => entry.startsWith("model:"))).toEqual(["model:first", "model:steer"]);
  } finally { release.resolve(); await f.run.stop("aborted"); }
});

it("local cancellation while joining a steer cannot publish an already-held completion", async () => {
  const started = gate(), original = gate(), steering = gate(), receipt = gate();
  const f = await fixture({ legacy: true, continuationOwner: "first", receipt: async () => {},
    prompt: async () => { started.resolve(); await original.promise; },
    steer: async () => { steering.resolve(); await receipt.promise; return "injected"; },
    commands: async function* () {
      yield start; yield prompt("first"); await started.promise; yield steer;
      await steering.promise; original.resolve(); await new Promise(resolve => setTimeout(resolve, 0));
      yield { type: "session.cancel", sessionId: "s", turnId: "first" }; receipt.resolve();
    },
  });
  try {
    await f.run.completed;
    expect(terminals(f.events)).toEqual([]);
    expect(f.log).not.toContain("canonical:first");
  } finally { original.resolve(); receipt.resolve(); await f.run.stop("aborted"); }
});
