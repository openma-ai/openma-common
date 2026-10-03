import { writeFile } from "node:fs/promises";
import { Readable, Writable } from "node:stream";
import { AgentSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";

const logPath = process.env.FORK_LOG;
if (!logPath) {
  console.error("FORK_LOG is required");
  process.exit(1);
}

// Local fake ACP agent. It advertises the inclusive fork capability and records
// the session/fork params. It does not call a model or any network service.
new AgentSideConnection(
  () => ({
    async initialize() {
      return {
        protocolVersion: 1,
        agentInfo: { name: "fake-inclusive-fork", version: "0.0.1" },
        agentCapabilities: {
          sessionCapabilities: { fork: {} },
          _meta: {
            jetbrains: {
              air: {
                fork: { version: 1, inclusive: true },
              },
            },
          },
        },
      };
    },
    async unstable_forkSession(params) {
      await writeFile(logPath, JSON.stringify(params), "utf8");
      return { sessionId: "forked-from-fake-agent" };
    },
  }),
  ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)),
);
