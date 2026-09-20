import {
  AgentSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
  type Agent,
} from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";
import { isAuthRequired } from "../src/acp-runtime/errors.js";
import { AcpRuntimeImpl } from "../src/acp-runtime/runtime.js";
import { NodeSpawner } from "../src/acp-runtime/spawners/node.js";
import type { ChildHandle, Spawner } from "../src/acp-runtime/types.js";

describe("shared ACP runtime factory", () => {
  it("owns session startup and cleanup", async () => {
    const child = createChild(() => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "factory-session" };
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const spawner: Spawner = { async spawn() { return child; } };

    const session = await new AcpRuntimeImpl(spawner).start({
      agent: { command: "fake-agent", cwd: "/tmp/openma" },
    });

    expect(session.acpSessionId).toBe("factory-session");
    await session.dispose();
    expect(session.isAlive()).toBe(false);
  });

  it("reports a session dead when its ACP child process exits", async () => {
    const child = createChild(() => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "exited-session" };
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    let reportExit!: (result: { code: number | null; signal: string | null }) => void;
    child.exited = new Promise((resolve) => {
      reportExit = resolve;
    });
    const session = await new AcpRuntimeImpl({
      async spawn() {
        return child;
      },
    }).start({
      agent: { command: "fake-agent", cwd: "/tmp/openma" },
    });

    expect(session.isAlive()).toBe(true);
    reportExit({ code: 9, signal: null });
    await child.exited;
    expect(session.isAlive()).toBe(false);
  });

  it("turns a prompt failure after child exit into a process lifecycle error", async () => {
    let reportExit!: (result: { code: number | null; signal: string | null }) => void;
    const child = createChild(() => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "prompt-exit-session" };
      },
      async prompt() {
        reportExit({ code: 17, signal: null });
        throw new Error("transport closed");
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    child.exited = new Promise((resolve) => {
      reportExit = resolve;
    });
    const session = await new AcpRuntimeImpl({
      async spawn() {
        return child;
      },
    }).start({
      agent: { command: "fake-agent", cwd: "/tmp/openma" },
    });

    const consumePrompt = async () => {
      for await (const _event of session.prompt("fail")) {
        // Consume the runtime stream so the prompt response boundary is read.
      }
    };
    await expect(consumePrompt()).rejects.toThrow(
      "The agent process exited before it could accept the prompt (fake-agent, exit code 17)",
    );
  });

  it("provides the common node spawner and ACP error classifier", () => {
    expect(new NodeSpawner()).toBeInstanceOf(NodeSpawner);
    expect(isAuthRequired({ code: -32000 })).toBe(true);
    expect(isAuthRequired({ code: -32001 })).toBe(false);
  });
});

function createChild(toAgent: (conn: AgentSideConnection) => Agent): ChildHandle {
  const clientToAgent = new TransformStream<Uint8Array, Uint8Array>();
  const agentToClient = new TransformStream<Uint8Array, Uint8Array>();
  new AgentSideConnection(
    toAgent,
    ndJsonStream(agentToClient.writable, clientToAgent.readable),
  );
  return {
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
  };
}
