import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AcpRuntimeImpl } from "../src/acp-runtime/runtime.js";
import { NodeSpawner } from "../src/acp-runtime/spawners/node.js";

const agentPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "inclusive-fork-agent.mjs",
);

describe("spawned inclusive fork agent", () => {
  it("sends sha256 UTF-8 jetbrains.air.fork meta on session/fork", async () => {
    const root = await mkdtemp(join(tmpdir(), "openma-inclusive-fork-"));
    const logPath = join(root, "fork.json");
    const diagnostics: string[] = [];
    const text = "你好，fork";
    const runtime = new AcpRuntimeImpl(new NodeSpawner());
    try {
      const session = await runtime.start({
        agent: {
          command: process.execPath,
          args: [agentPath],
          cwd: root,
          env: { FORK_LOG: logPath },
          onDiagnosticLine: (line) => diagnostics.push(line),
        },
        forkFromAcpSessionId: "parent-session",
        forkPoint: {
          messageId: "msg-1",
          messageText: text,
          messageOccurrence: 2,
        },
        sessionRequestMeta: {
          claudeCode: { parentToolUseId: "task-1" },
        },
      });
      try {
        expect(session.acpSessionId).toBe("forked-from-fake-agent");
        expect(session.forkSupport).toMatchObject({
          level: "message",
          reason: "message-fork-advertised",
          messageFork: { version: 1, inclusive: true, source: "capability" },
        });
        expect(session.supportsSessionFork).toBe(true);
        const recorded = JSON.parse(await readFile(logPath, "utf8")) as {
          sessionId?: string;
          _meta?: {
            claudeCode?: { parentToolUseId?: string };
            jetbrains?: { air?: { fork?: Record<string, unknown> } };
          };
        };
        expect(recorded.sessionId).toBe("parent-session");
        expect(recorded._meta?.claudeCode).toEqual({ parentToolUseId: "task-1" });
        expect(recorded._meta?.jetbrains?.air?.fork).toEqual({
          version: 1,
          messageId: "msg-1",
          messageOccurrence: 2,
          messageFingerprint: `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`,
        });
        expect(recorded._meta?.jetbrains?.air?.fork?.messageFingerprint).toBe(
          "sha256:8b9c575c494de1fe8ecb75c2a94cf1d757355519a62ee4d20fdf1c4a42a99703",
        );
      } finally {
        await session.dispose();
      }
    } catch (error) {
      const detail = diagnostics.length > 0 ? `\n${diagnostics.join("\n")}` : "";
      throw new Error(`${error instanceof Error ? error.message : String(error)}${detail}`, {
        cause: error,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);
});
