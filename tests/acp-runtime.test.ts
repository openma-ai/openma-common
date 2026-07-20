import {
  AgentSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
  type Agent,
  type ContentBlock,
} from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";
import { AcpSessionImpl } from "../src/acp-runtime/session.js";
import type { ChildHandle } from "../src/acp-runtime/types.js";

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
