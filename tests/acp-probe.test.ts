import {
  AgentSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Agent,
} from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";
import { probeAcpSession } from "../src/acp-runtime/probe.js";
import type { ChildHandle, Spawner } from "../src/acp-runtime/types.js";

describe("shared ACP capability probe", () => {
  it("collects session capabilities from one disposable ACP child", async () => {
    let spawnCount = 0;
    let killCount = 0;
    const child = createChild(() => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION, authMethods: [] };
      },
      async newSession() {
        return {
          sessionId: "probe-session",
          configOptions: [{
            id: "model",
            name: "Model",
            category: "model",
            type: "select",
            currentValue: "fast",
            options: [{ name: "Fast", value: "fast" }],
          }],
          modes: {
            currentModeId: "default",
            availableModes: [{ id: "default", name: "Default" }],
          },
        };
      },
    } as unknown as Agent));
    const spawner: Spawner = {
      async spawn() {
        spawnCount += 1;
        return {
          ...child,
          async kill() {
            killCount += 1;
            await child.kill();
          },
        };
      },
    };

    const result = await probeAcpSession({
      agent: { command: "fake-agent" },
      cwd: "/tmp/openma-probe",
      spawner,
    });

    expect(spawnCount).toBe(1);
    expect(killCount).toBe(1);
    expect(result.sessionId).toBe("probe-session");
    expect(result.configOptions[0]?.id).toBe("model");
    expect(result.modes?.currentModeId).toBe("default");
  });

  it("cleans up the child when the probe fails", async () => {
    let killCount = 0;
    const child = createChild(() => ({
      async initialize() {
        throw new Error("probe failed");
      },
    } as unknown as Agent));
    const spawner: Spawner = {
      async spawn() {
        return {
          ...child,
          async kill() {
            killCount += 1;
            await child.kill();
          },
        };
      },
    };

    await expect(probeAcpSession({
      agent: { command: "broken-agent" },
      spawner,
      timeoutMs: 100,
    })).rejects.toThrow();
    expect(killCount).toBe(1);
  });
});

function createChild(toAgent: (connection: AgentSideConnection) => Agent): ChildHandle {
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
