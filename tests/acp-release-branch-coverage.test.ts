import {
  AgentSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
  type Agent,
  type SessionConfigOption,
} from "@agentclientprotocol/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AcpSessionImpl,
  applyAcpPermissionMode,
  type AcpSession,
  type SessionOptions,
} from "../src/acp-runtime/index.js";
import { acpSessionFixture } from "./acp-fixtures.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const sessions: AcpSessionImpl[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map(session => session.dispose()));
});

function mode(currentValue = "default"): SessionConfigOption {
  return {
    id: "mode", name: "Mode", category: "mode", type: "select", currentValue,
    options: [{ value: "default", name: "Default" }, { value: "auto", name: "Auto" }],
  };
}

async function wire(
  agent: (connection: AgentSideConnection) => Partial<Agent> = () => ({}),
  options: Partial<SessionOptions> = {},
) {
  const outgoing = new TransformStream<Uint8Array, Uint8Array>();
  const incoming = new TransformStream<Uint8Array, Uint8Array>();
  const exited = deferred<{ code: number | null; signal: string | null }>();
  const calls: string[] = [];
  const writes: Array<{ configId: string; value: string | boolean }> = [];
  let cancellations = 0;
  new AgentSideConnection(connection => ({
    async initialize() {
      return { protocolVersion: PROTOCOL_VERSION, agentInfo: {
        name: "@agentclientprotocol/claude-agent-acp", version: "0.94.0",
      } };
    },
    async newSession() { return { sessionId: "release-branches", configOptions: [mode()] }; },
    async authenticate() { return {}; },
    async cancel() { cancellations++; },
    async prompt(params) {
      calls.push(params.prompt.map(block => block.type === "text" ? block.text : "non-text").join(""));
      return { stopReason: "end_turn" };
    },
    async setSessionConfigOption(params) {
      writes.push({ configId: params.configId, value: params.value });
      return { configOptions: [mode(String(params.value))] };
    },
    ...agent(connection),
  }), ndJsonStream(incoming.writable, outgoing.readable));
  const session = new AcpSessionImpl({
    id: "release-branches", options: { agent: { command: "sdk-fixture" }, ...options },
    child: {
      stdin: outgoing.writable, stdout: incoming.readable,
      stderr: new ReadableStream({ start(controller) { controller.close(); } }),
      exited: exited.promise,
      async kill() {
        exited.resolve({ code: 0, signal: "SIGTERM" });
        await Promise.allSettled([outgoing.writable.close(), incoming.writable.close()]);
      },
    },
  });
  sessions.push(session);
  await session.init();
  return { session, calls, writes, cancellations: () => cancellations };
}

async function collect(stream: AsyncIterable<unknown>) {
  const events: unknown[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

const apply = (session: AcpSession) => applyAcpPermissionMode(session, {
  harnessId: "claude-acp", mode: "auto",
});

// These deliberately malformed catalogs belong to the public structural port,
// not the SDK wire (which rejects malformed JSON before the runtime sees it).
// Removing any fail-closed catalog guard must permit a write and fail this test.
describe("release permission catalog boundaries", () => {
  it.each([
    { name: "non-array catalog", catalog: {} },
    { name: "null choice", catalog: [{ ...mode(), options: [null] }] },
    { name: "primitive choice", catalog: [{ ...mode(), options: ["auto"] }] },
    { name: "non-array group", catalog: [{ ...mode(), options: [{ group: "native", options: {} }] }] },
    { name: "null grouped choice", catalog: [{ ...mode(), options: [{ group: "native", options: [null] }] }] },
    { name: "non-string value", catalog: [{ ...mode(), options: [{ value: 42, name: "Auto" }] }] },
    { name: "duplicate choices", catalog: [{ ...mode(), options: [{ value: "auto" }, { value: "auto" }] }] },
  ])("rejects $name before dispatch", async ({ catalog }) => {
    const f = await wire();
    const port: AcpSession = {
      ...acpSessionFixture({ acpSessionId: f.session.acpSessionId }),
      agentInfo: f.session.agentInfo,
      configOptions: catalog as readonly SessionConfigOption[],
      setConfigOption: f.session.setConfigOption.bind(f.session),
    };
    await expect(apply(port)).rejects.toMatchObject({ code: "unsupported", outcome: "not-dispatched" });
    expect(f.writes).toEqual([]);
    expect(f.session.configOptions).toEqual([mode()]);
  });

  // A verified RPC response is insufficient if a custom session has already
  // observed contradictory state. Ignoring current state would falsely succeed.
  it.each([
    { name: "different current mode", current: [mode("default")], error: {
      code: "mode-mismatch", outcome: "unknown", effectiveModeId: "default",
    } },
    { name: "withdrawn requested choice", current: [{ ...mode("auto"), options: [{ value: "default", name: "Default" }] }], error: {
      code: "unsupported", outcome: "unknown",
    } },
  ])("rejects matching readback with $name", async ({ current, error }) => {
    const f = await wire();
    let observed: readonly SessionConfigOption[] = [mode()];
    const port: AcpSession = {
      ...acpSessionFixture({ acpSessionId: f.session.acpSessionId }),
      agentInfo: f.session.agentInfo,
      get configOptions() { return observed; },
      async setConfigOption(id, value) {
        const response = await f.session.setConfigOption(id, value);
        observed = current;
        return response;
      },
    };
    await expect(apply(port)).rejects.toMatchObject(error);
    expect(f.writes).toEqual([{ configId: "mode", value: "auto" }]);
    expect(f.session.configOptions).toEqual([mode("auto")]);
  });
});

describe("release dispatch receipt boundaries over the SDK wire", () => {
  // A pre-aborted admission must not send or remove the old RPC isolation fence.
  it("rejects an already aborted drain waiter and still isolates the next turn", async () => {
    const old = deferred<void>();
    const entered = deferred<void>();
    const calls: string[] = [];
    const f = await wire(connection => ({
      async prompt(params) {
        const text = params.prompt[0];
        if (text?.type !== "text") throw new Error("expected text prompt");
        calls.push(text.text);
        if (text.text === "old") { entered.resolve(); await old.promise; }
        await connection.sessionUpdate({ sessionId: params.sessionId, update: {
          sessionUpdate: "agent_message_chunk", content: { type: "text", text: text.text },
        } });
        return { stopReason: "end_turn" };
      },
    }));
    try {
      const failure = new Error("receipt storage unavailable");
      await expect(collect(f.session.prompt("old", {
        // Synchronous callback failure must retain the original error as well.
        onDispatched: () => { throw failure; },
      }))).rejects.toBe(failure);
      await entered.promise;
      const aborted = new Error("admission withdrawn");
      await expect(collect(f.session.prompt("never sent", {
        abortSignal: AbortSignal.abort(aborted),
      }))).rejects.toBe(aborted);
      expect(calls).toEqual(["old"]);
      const next = collect(f.session.prompt("new"));
      expect(calls).toEqual(["old"]);
      old.resolve();
      expect(await next).toEqual([
        expect.objectContaining({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "new" } }),
        { type: "promptComplete", response: { stopReason: "end_turn" } },
      ]);
      expect(calls).toEqual(["old", "new"]);
    } finally { old.resolve(); }
  });

  // Aborting inside the receipt callback precedes receipt listener registration.
  it("observes synchronous receipt cancellation without exposing old completion", async () => {
    const rpc = deferred<void>();
    const entered = deferred<void>();
    const f = await wire(() => ({ async prompt() {
      entered.resolve(); await rpc.promise; return { stopReason: "end_turn" };
    } }));
    const controller = new AbortController();
    const reason = new Error("receipt cancelled synchronously");
    try {
      await expect(collect(f.session.prompt("old", {
        abortSignal: controller.signal,
        onDispatched: () => { controller.abort(reason); return new Promise<void>(() => {}); },
      }))).rejects.toBe(reason);
      await entered.promise;
      await vi.waitFor(() => expect(f.cancellations()).toBe(1));
      rpc.resolve();
      expect(f.session.drainPendingEvents()).toEqual([]);
    } finally { rpc.resolve(); }
  });

  // Early receipt success must not finish the still-running RPC or reroute its
  // updates into the out-of-band callback.
  it("keeps the turn active when its receipt completes before its RPC", async () => {
    const release = deferred<void>();
    const entered = deferred<void>();
    const outOfBand: unknown[] = [];
    const f = await wire(connection => ({ async prompt(params) {
      entered.resolve(); await release.promise;
      await connection.sessionUpdate({ sessionId: params.sessionId, update: {
        sessionUpdate: "agent_message_chunk", content: { type: "text", text: "still this turn" },
      } });
      return { stopReason: "end_turn" };
    } }), { onOutOfBandSessionUpdate: event => { outOfBand.push(event); } });
    try {
      const result = collect(f.session.prompt("run", { onDispatched: async () => {} }));
      await entered.promise;
      release.resolve();
      expect(await result).toEqual([
        expect.objectContaining({ content: { type: "text", text: "still this turn" } }),
        { type: "promptComplete", response: { stopReason: "end_turn" } },
      ]);
      expect(outOfBand).toEqual([]);
      expect(f.cancellations()).toBe(0);
    } finally { release.resolve(); }
  });

  // The receipt deadline still applies after RPC completion, but must not send
  // session/cancel for that already completed remote turn.
  it("times out a pending receipt after the remote prompt has completed", async () => {
    const f = await wire(() => ({}), { perTurnTimeoutMs: 100 });
    await expect(collect(f.session.prompt("run", {
      onDispatched: () => new Promise<void>(() => {}),
    }))).rejects.toThrow("ACP prompt timed out after 100ms");
    expect(f.calls).toEqual(["run"]);
    expect(f.cancellations()).toBe(0);
    expect(f.session.drainPendingEvents()).toEqual([]);
    expect(await collect(f.session.prompt("after timeout"))).toEqual([
      { type: "promptComplete", response: { stopReason: "end_turn" } },
    ]);
    expect(f.calls).toEqual(["run", "after timeout"]);
  });

  // An asynchronous client permission failure can outlive receipt failure.
  // It must return cancelled to the agent, not leak requestPermissionError into
  // the next prompt. This reaches the event sink via a real SDK client request.
  it("discards late permission callback errors from a receipt-failed turn", async () => {
    const permission = deferred<never>();
    const permissionEntered = deferred<void>();
    const receipt = deferred<void>();
    const calls: string[] = [];
    const responses: unknown[] = [];
    const f = await wire(connection => ({ async prompt(params) {
      const text = params.prompt[0];
      if (text?.type !== "text") throw new Error("expected text prompt");
      calls.push(text.text);
      if (text.text === "old") {
        responses.push(await connection.requestPermission({ sessionId: params.sessionId,
          toolCall: { toolCallId: "write-file", title: "Write a file", kind: "edit", status: "pending" },
          options: [{ optionId: "once", name: "Allow once", kind: "allow_once" }],
        }));
      }
      return { stopReason: "end_turn" };
    } }), { clientCallbacks: { requestPermission: () => {
      permissionEntered.resolve(); return permission.promise;
    } } });
    try {
      const failure = new Error("receipt persistence failed");
      const result = collect(f.session.prompt("old", { onDispatched: () => receipt.promise }));
      const rejected = expect(result).rejects.toBe(failure);
      await permissionEntered.promise;
      expect(f.session.openPermissionRequests).toBe(1);
      receipt.reject(failure);
      await rejected;
      const next = collect(f.session.prompt("new"));
      expect(calls).toEqual(["old"]);
      permission.reject(new Error("permission UI closed"));
      expect(await next).toEqual([{ type: "promptComplete", response: { stopReason: "end_turn" } }]);
      expect(responses).toEqual([{ outcome: { outcome: "cancelled" } }]);
      expect(calls).toEqual(["old", "new"]);
      expect(f.session.openPermissionRequests).toBe(0);
      expect(f.session.drainPendingEvents()).toEqual([]);
    } finally { permission.reject(new Error("fixture cleanup")); receipt.resolve(); }
  });
});
