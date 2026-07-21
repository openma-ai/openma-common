import {
  AgentSideConnection,
  PROTOCOL_VERSION,
  RequestError,
  ndJsonStream,
  type Agent,
  type ContentBlock,
} from "@agentclientprotocol/sdk";
import { describe, expect, it, vi } from "vitest";
import { AcpRuntimeImpl } from "../src/acp-runtime/runtime.js";
import { AcpSessionImpl } from "../src/acp-runtime/session.js";
import type { ChildHandle, Spawner } from "../src/acp-runtime/types.js";

describe("shared ACP session runtime", () => {
  it("uses the ACP session lifecycle and streams only the active prompt", async () => {
    const harness = createHarness((conn) => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: { loadSession: true } };
      },
      async loadSession(params) {
        await conn.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "replayed history" },
          },
        });
        return {};
      },
      async newSession() {
        throw new Error("newSession must not be used when loading is supported");
      },
      async prompt(params) {
        await conn.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "fresh answer" },
          },
        });
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));

    const session = new AcpSessionImpl({
      child: harness.child,
      id: "shared-acp-session",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/openma" },
        resumeAcpSessionId: "existing-session",
        mcpServers: [],
      },
    });

    await session.init();
    const events: unknown[] = [];
    for await (const event of session.prompt("continue")) events.push(event);
    await session.dispose();

    expect(session.acpSessionId).toBe("existing-session");
    expect(events).toContainEqual(
      expect.objectContaining({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "fresh answer" },
      }),
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({ content: { type: "text", text: "replayed history" } }),
    );
  });

  it("prefers session/resume and keeps its returned configuration", async () => {
    const calls: string[] = [];
    const harness = createHarness(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: {
            loadSession: true,
            sessionCapabilities: { resume: {} },
          },
        };
      },
      async resumeSession() {
        calls.push("resume");
        return {
          configOptions: [{
            id: "model",
            name: "Model",
            type: "select",
            options: [{ value: "gpt-5", name: "GPT-5" }],
            currentValue: "gpt-5",
          }],
          modes: {
            currentModeId: "review",
            availableModes: [{ id: "review", name: "Review" }],
          },
        };
      },
      async loadSession() {
        calls.push("load");
        return {};
      },
      async newSession() {
        calls.push("new");
        return { sessionId: "new-session" };
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "shared-resume-session",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/openma" },
        resumeAcpSessionId: "existing-session",
      },
    });

    await session.init();

    expect(calls).toEqual(["resume"]);
    expect(session.acpSessionId).toBe("existing-session");
    expect(session.configOptions).toHaveLength(1);
    expect(session.modes).toEqual({
      currentModeId: "review",
      availableModes: [{ id: "review", name: "Review" }],
    });
    await session.dispose();
  });

  it("authenticates and retries an agent-handled session open challenge", async () => {
    const calls: string[] = [];
    let authenticated = false;
    const harness = createHarness(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          authMethods: [{ id: "login", name: "Login" }],
        };
      },
      async newSession() {
        calls.push("new");
        if (!authenticated) throw RequestError.authRequired();
        return { sessionId: "authenticated-session" };
      },
      async authenticate(params) {
        calls.push(`authenticate:${params.methodId}`);
        authenticated = true;
        return {};
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "shared-auth-session",
      options: { agent: { command: "fake-agent" } },
    });

    await session.init();

    expect(calls).toEqual(["new", "authenticate:login", "new"]);
    await session.dispose();
  });

  it("captures session/load replay without leaking it into the next prompt", async () => {
    const harness = createHarness((conn) => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: { loadSession: true } };
      },
      async loadSession(params) {
        await conn.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "persisted replay" },
          },
        });
        return {};
      },
      async newSession() {
        throw new Error("newSession must not be used when loading is supported");
      },
      async prompt(params) {
        await conn.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "live answer" },
          },
        });
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "shared-replay-session",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/openma" },
        resumeAcpSessionId: "existing-session",
      },
    });

    await session.init();
    const events: unknown[] = [];
    for await (const event of session.prompt("continue")) events.push(event);

    expect(session.loadedReplayEvents).toEqual([
      expect.objectContaining({ content: { type: "text", text: "persisted replay" } }),
    ]);
    expect(JSON.stringify(events)).not.toContain("persisted replay");
    expect(JSON.stringify(events)).toContain("live answer");
    await session.dispose();
  });

  it("closes an advertised ACP session before killing the child", async () => {
    const order: string[] = [];
    const harness = createHarness(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: { sessionCapabilities: { close: {} } },
        };
      },
      async newSession() {
        return { sessionId: "close-me" };
      },
      async closeSession(params) {
        order.push(`close:${params.sessionId}`);
        return {};
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    harness.child.kill = async () => {
      order.push("kill");
    };
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "shared-close-session",
      options: { agent: { command: "fake-agent" } },
    });

    await session.init();
    await session.dispose();

    expect(order).toEqual(["close:close-me", "kill"]);
  });

  it("makes concurrent dispose calls await the same cleanup", async () => {
    let releaseKill!: () => void;
    const killGate = new Promise<void>((resolve) => {
      releaseKill = resolve;
    });
    const harness = createHarness(() => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "dispose-once" };
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const kill = vi.fn(async () => killGate);
    harness.child.kill = kill;
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "shared-dispose-session",
      options: { agent: { command: "fake-agent" } },
    });
    await session.init();

    const first = session.dispose();
    await vi.waitFor(() => expect(kill).toHaveBeenCalledOnce());
    let secondSettled = false;
    const second = session.dispose().then(() => {
      secondSettled = true;
    });
    await Promise.resolve();
    expect(secondSettled).toBe(false);
    releaseKill();
    await Promise.all([first, second]);
  });

  it("times out initialization and reaps the child", async () => {
    const harness = createHarness(() => ({
      async initialize() {
        return new Promise<never>(() => undefined);
      },
      async newSession() {
        return { sessionId: "unreachable" };
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const kill = vi.fn(async () => undefined);
    harness.child.kill = kill;
    const spawner: Spawner = { spawn: async () => harness.child };
    const runtime = new AcpRuntimeImpl(spawner);

    await expect(Promise.race([
      runtime.start({
        agent: { command: "fake-agent" },
        initTimeoutMs: 10,
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("external timeout")), 100)),
    ])).rejects.toThrow("ACP session init timed out after 10ms");
    expect(kill).toHaveBeenCalledOnce();
  });

  it("sends structured content and returns a cancelled stop reason", async () => {
    let received: ContentBlock[] | undefined;
    let cancelled = false;
    const harness = createHarness((conn) => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "session-1" };
      },
      async prompt(params) {
        received = params.prompt;
        await new Promise<void>((resolve) => {
          const timer = setInterval(() => {
            if (cancelled) {
              clearInterval(timer);
              resolve();
            }
          }, 1);
        });
        return { stopReason: "cancelled" };
      },
      async cancel() {
        cancelled = true;
      },
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "shared-acp-session",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
    });
    await session.init();
    const abort = new AbortController();
    const blocks: ContentBlock[] = [
      { type: "text", text: "hello" },
      { type: "resource_link", uri: "file:///tmp/readme.md", name: "readme" },
    ];
    const events: unknown[] = [];
    const draining = (async () => {
      for await (const event of session.prompt(blocks, { abortSignal: abort.signal })) {
        events.push(event);
      }
    })();
    await new Promise((resolve) => setTimeout(resolve, 5));
    abort.abort();
    await draining;
    await session.dispose();

    expect(received).toEqual(blocks);
    expect(events).toContainEqual(expect.objectContaining({ type: "promptComplete" }));
  });
});

function createHarness(toAgent: (conn: AgentSideConnection) => Agent): { child: ChildHandle } {
  const clientToAgent = new TransformStream<Uint8Array, Uint8Array>();
  const agentToClient = new TransformStream<Uint8Array, Uint8Array>();
  new AgentSideConnection(
    toAgent,
    ndJsonStream(agentToClient.writable, clientToAgent.readable),
  );
  return {
    child: {
      stdin: clientToAgent.writable,
      stdout: agentToClient.readable,
      stderr: new ReadableStream({ start(controller) { controller.close(); } }),
      exited: Promise.resolve({ code: 0, signal: null }),
      async kill() {
        await Promise.allSettled([
          clientToAgent.writable.close(),
          agentToClient.writable.close(),
        ]);
      },
    },
  };
}
