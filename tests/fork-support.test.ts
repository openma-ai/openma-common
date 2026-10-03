import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  acpForkRequestMeta as acpForkRequestMetaFromSession,
} from "../src/acp-runtime/session.js";
import {
  ACP_INCLUSIVE_FORK_CAPABILITY,
  ACP_INCLUSIVE_FORK_VERSION,
  acpForkPointsFromMessages,
  acpForkRequestMeta,
  acpInclusiveForkCapabilityMeta,
  forkSupport,
  type AcpForkSupportLevel,
  type AcpForkSupportReason,
  type AcpForkSupportSource,
} from "../src/acp-runtime/fork-support.js";
import {
  ACP_INCLUSIVE_FORK_VERSION as versionFromIndex,
  acpForkRequestMeta as acpForkRequestMetaFromIndex,
  forkSupport as forkSupportFromIndex,
} from "../src/acp-runtime/index.js";

const SESSION_FORK = { sessionCapabilities: { fork: {} } };
const VALID_FORK = { version: 1, inclusive: true as const };

describe("forkSupport", () => {
  it.each<{
    name: string;
    source: AcpForkSupportSource | null | undefined;
    level: AcpForkSupportLevel;
    reason: AcpForkSupportReason;
    messageFork?: "capability" | "verified-adapter";
  }>([
    {
      name: "null input",
      source: null,
      level: "none",
      reason: "not-initialized",
    },
    {
      name: "undefined input",
      source: undefined,
      level: "none",
      reason: "not-initialized",
    },
    {
      name: "missing agentCapabilities",
      source: {},
      level: "none",
      reason: "not-initialized",
    },
    {
      name: "null agentCapabilities",
      source: { agentCapabilities: null },
      level: "none",
      reason: "not-initialized",
    },
    {
      name: "empty agentCapabilities",
      source: { agentCapabilities: {} },
      level: "none",
      reason: "session-fork-not-advertised",
    },
    {
      name: "capability key without sessionCapabilities.fork",
      source: {
        agentCapabilities: {
          _meta: { jetbrains: { air: { fork: VALID_FORK } } },
        },
        agentInfo: { name: "codex-acp", version: "1.10.0" },
      },
      level: "none",
      reason: "session-fork-not-advertised",
    },
    {
      name: "session fork without a capability key",
      source: { agentCapabilities: SESSION_FORK },
      level: "session",
      reason: "message-fork-not-advertised",
    },
    {
      name: "flat dotted key is not the capability",
      source: {
        agentCapabilities: {
          ...SESSION_FORK,
          _meta: { "jetbrains.air.fork": VALID_FORK },
        },
      },
      level: "session",
      reason: "message-fork-not-advertised",
    },
    {
      name: "version 2",
      source: {
        agentCapabilities: {
          ...SESSION_FORK,
          _meta: { jetbrains: { air: { fork: { version: 2, inclusive: true } } } },
        },
      },
      level: "session",
      reason: "message-fork-capability-invalid",
    },
    {
      name: "inclusive false",
      source: {
        agentCapabilities: {
          ...SESSION_FORK,
          _meta: { jetbrains: { air: { fork: { version: 1, inclusive: false } } } },
        },
      },
      level: "session",
      reason: "message-fork-capability-invalid",
    },
    {
      name: "non-object capability",
      source: {
        agentCapabilities: {
          ...SESSION_FORK,
          _meta: { jetbrains: { air: { fork: true } } },
        },
      },
      level: "session",
      reason: "message-fork-capability-invalid",
    },
    {
      name: "invalid capability does not fall through to a verified adapter",
      source: {
        agentCapabilities: {
          ...SESSION_FORK,
          _meta: { jetbrains: { air: { fork: { version: 2, inclusive: true } } } },
        },
        agentInfo: { name: "codex-acp", version: "1.10.0" },
      },
      level: "session",
      reason: "message-fork-capability-invalid",
    },
    {
      name: "legal capability key",
      source: {
        agentCapabilities: {
          ...SESSION_FORK,
          _meta: {
            "dsh.cordis": { ok: true },
            jetbrains: { air: { fork: { version: 1, inclusive: true, extra: "kept" } } },
          },
        },
      },
      level: "message",
      reason: "message-fork-advertised",
      messageFork: "capability",
    },
    {
      name: "codex-acp 1.10.0",
      source: {
        agentCapabilities: SESSION_FORK,
        agentInfo: { name: "codex-acp", version: "1.10.0" },
      },
      level: "message",
      reason: "message-fork-verified-adapter",
      messageFork: "verified-adapter",
    },
    {
      name: "@agentclientprotocol/codex-acp 1.10.0",
      source: {
        agentCapabilities: SESSION_FORK,
        agentInfo: { name: "@agentclientprotocol/codex-acp", version: "1.10.0" },
      },
      level: "message",
      reason: "message-fork-verified-adapter",
      messageFork: "verified-adapter",
    },
    {
      name: "codex-acp 1.9.9",
      source: {
        agentCapabilities: SESSION_FORK,
        agentInfo: { name: "codex-acp", version: "1.9.9" },
      },
      level: "session",
      reason: "message-fork-not-advertised",
    },
    {
      name: "codex-acp non x.y.z",
      source: {
        agentCapabilities: SESSION_FORK,
        agentInfo: { name: "codex-acp", version: "1.10.0-rc.1" },
      },
      level: "session",
      reason: "message-fork-not-advertised",
    },
    {
      name: "codex-acp incomplete version",
      source: {
        agentCapabilities: SESSION_FORK,
        agentInfo: { name: "codex-acp", version: "1.10" },
      },
      level: "session",
      reason: "message-fork-not-advertised",
    },
    {
      name: "claude-acp 0.75.1",
      source: {
        agentCapabilities: SESSION_FORK,
        agentInfo: { name: "claude-acp", version: "0.75.1" },
      },
      level: "message",
      reason: "message-fork-verified-adapter",
      messageFork: "verified-adapter",
    },
    {
      name: "@agentclientprotocol/claude-agent-acp 0.75.1",
      source: {
        agentCapabilities: SESSION_FORK,
        agentInfo: { name: "@agentclientprotocol/claude-agent-acp", version: "0.75.1" },
      },
      level: "message",
      reason: "message-fork-verified-adapter",
      messageFork: "verified-adapter",
    },
    {
      name: "claude-acp 0.75.0",
      source: {
        agentCapabilities: SESSION_FORK,
        agentInfo: { name: "claude-acp", version: "0.75.0" },
      },
      level: "session",
      reason: "message-fork-not-advertised",
    },
  ])("$name → $level / $reason", ({ source, level, reason, messageFork }) => {
    const support = forkSupport(source);
    expect(support.level).toBe(level);
    expect(support.reason).toBe(reason);
    expect(support.message.length).toBeGreaterThan(0);
    if (reason === "message-fork-not-advertised") {
      expect(support.message).toBe(
        "This agent can fork the whole session but not from a specific message.",
      );
    }
    if (messageFork) {
      expect(support.messageFork).toEqual({ version: 1, inclusive: true, source: messageFork });
    } else {
      expect(support.messageFork).toBeUndefined();
    }
  });

  it("exports the frozen inclusive capability and a nested meta wrapper", () => {
    expect(ACP_INCLUSIVE_FORK_VERSION).toBe(1);
    expect(versionFromIndex).toBe(1);
    expect(ACP_INCLUSIVE_FORK_CAPABILITY).toEqual({ version: 1, inclusive: true });
    expect(Object.isFrozen(ACP_INCLUSIVE_FORK_CAPABILITY)).toBe(true);
    expect(acpInclusiveForkCapabilityMeta()).toEqual({
      jetbrains: { air: { fork: ACP_INCLUSIVE_FORK_CAPABILITY } },
    });
    expect(forkSupportFromIndex).toBe(forkSupport);
  });
});

describe("acpForkPointsFromMessages", () => {
  it("counts identical assistant text in the prefix", () => {
    expect(acpForkPointsFromMessages([
      { messageId: "a", text: "hello" },
      { messageId: "b", text: "world" },
      { messageId: "c", text: "hello" },
      { messageId: "d", text: "hello" },
    ])).toEqual([
      { messageId: "a", messageText: "hello", messageOccurrence: 1 },
      { messageId: "b", messageText: "world", messageOccurrence: 1 },
      { messageId: "c", messageText: "hello", messageOccurrence: 2 },
      { messageId: "d", messageText: "hello", messageOccurrence: 3 },
    ]);
  });

  it("keeps the moved acpForkRequestMeta output and index export", () => {
    const point = {
      messageId: "answer-old",
      messageText: "abc",
      messageOccurrence: 2,
    };
    const meta = {
      jetbrains: {
        air: {
          fork: {
            version: 1,
            messageId: "answer-old",
            messageOccurrence: 2,
            messageFingerprint: "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
          },
        },
      },
    };
    expect(acpForkRequestMeta(point)).toEqual(meta);
    expect(acpForkRequestMetaFromSession(point)).toEqual(meta);
    expect(acpForkRequestMetaFromIndex).toBe(acpForkRequestMeta);
    const utf8 = "你好，fork";
    expect(acpForkRequestMeta({
      messageId: "zh",
      messageText: utf8,
      messageOccurrence: 1,
    })).toMatchObject({
      jetbrains: {
        air: {
          fork: {
            messageFingerprint: `sha256:${createHash("sha256").update(utf8, "utf8").digest("hex")}`,
          },
        },
      },
    });
  });
});
