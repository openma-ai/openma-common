import type * as schema from "@agentclientprotocol/sdk";

/** Inclusive-fork point selected by a client from visible assistant text. */
export interface AcpForkPoint {
  messageId: string;
  messageText: string;
  messageOccurrence: number;
}

/** Capability advertised at `initialize.agentCapabilities._meta.jetbrains.air.fork`
 * by agents that implement the inclusive `jetbrains.air.fork` v1 request meta on session/fork. */
export const ACP_INCLUSIVE_FORK_VERSION = 1 as const;
export interface AcpInclusiveForkCapability {
  version: typeof ACP_INCLUSIVE_FORK_VERSION;
  inclusive: true;
}
export const ACP_INCLUSIVE_FORK_CAPABILITY: AcpInclusiveForkCapability = Object.freeze({
  version: ACP_INCLUSIVE_FORK_VERSION,
  inclusive: true,
});
/** `{ jetbrains: { air: { fork: ACP_INCLUSIVE_FORK_CAPABILITY } } }`, to deep-merge into agentCapabilities._meta. */
export function acpInclusiveForkCapabilityMeta(): { jetbrains: { air: { fork: AcpInclusiveForkCapability } } } {
  return {
    jetbrains: {
      air: {
        fork: ACP_INCLUSIVE_FORK_CAPABILITY,
      },
    },
  };
}

export type AcpForkSupportLevel = "none" | "session" | "message";
export type AcpForkSupportReason =
  | "not-initialized"                  // none：输入为 null/undefined 或没有 agentCapabilities
  | "session-fork-not-advertised"      // none：没有 sessionCapabilities.fork
  | "message-fork-not-advertised"      // session：有 sessionCapabilities.fork，无能力 key
  | "message-fork-capability-invalid"  // session：key 存在但结构/版本不认识（version!==1 或 inclusive!==true）
  | "message-fork-advertised"          // message：能力 key 合法
  | "message-fork-verified-adapter";   // message：上游第三方适配器的已验证版本（见下），无能力 key
export interface AcpForkSupport {
  level: AcpForkSupportLevel;
  reason: AcpForkSupportReason;
  /** 英文、可直接展示给用户的说明，例如 "This agent can fork the whole session but not from a specific message." */
  message: string;
  /** level === "message" 时存在 */
  messageFork?: { version: 1; inclusive: true; source: "capability" | "verified-adapter" };
}
export interface AcpForkSupportSource {
  agentCapabilities?: schema.AgentCapabilities | null;
  agentInfo?: schema.Implementation | null;
}
/** 接受 AcpSession（有 agentCapabilities/agentInfo getter）或 InitializeResponse。 */
export function forkSupport(source: AcpForkSupportSource | null | undefined): AcpForkSupport {
  if (source == null || source.agentCapabilities == null) {
    return describeForkSupport("none", "not-initialized");
  }
  const capabilities = source.agentCapabilities;
  if (capabilities.sessionCapabilities?.fork == null) {
    return describeForkSupport("none", "session-fork-not-advertised");
  }
  const capability = inclusiveForkCapabilityPresence(capabilities);
  if (capability === "valid") {
    return describeForkSupport("message", "message-fork-advertised", "capability");
  }
  if (capability === "invalid") {
    return describeForkSupport("session", "message-fork-capability-invalid");
  }
  if (isVerifiedMessageForkAdapter(source.agentInfo)) {
    return describeForkSupport("message", "message-fork-verified-adapter", "verified-adapter");
  }
  return describeForkSupport("session", "message-fork-not-advertised");
}

/** Build fork points for top-level assistant messages already merged by message id.
 * `messageOccurrence` is the 1-based count of identical text in the prefix, including
 * the message itself. Callers collapse `<id>:segment:<n>` ids before calling this. */
export function acpForkPointsFromMessages(
  messages: ReadonlyArray<{ messageId: string; text: string }>,
): AcpForkPoint[] {
  const seen = new Map<string, number>();
  return messages.map((message) => {
    const messageOccurrence = (seen.get(message.text) ?? 0) + 1;
    seen.set(message.text, messageOccurrence);
    return {
      messageId: message.messageId,
      messageText: message.text,
      messageOccurrence,
    };
  });
}

const FORK_SUPPORT_MESSAGE: Record<AcpForkSupportReason, string> = {
  "not-initialized": "This agent has not reported whether it can fork a session.",
  "session-fork-not-advertised": "This agent does not support forking a session.",
  "message-fork-not-advertised": "This agent can fork the whole session but not from a specific message.",
  "message-fork-capability-invalid": "This agent advertised a message fork capability this client does not recognize.",
  "message-fork-advertised": "This agent can fork from a specific message.",
  "message-fork-verified-adapter": "This agent can fork from a specific message.",
};

/** Upstream adapters that implement inclusive fork but do not emit the capability key.
 * Internal. Own adapters (dsh-acp, pi-acp) must advertise the capability instead. */
const VERIFIED_MESSAGE_FORK_ADAPTERS: readonly {
  names: readonly string[];
  minimum: readonly [number, number, number];
}[] = [
  { names: ["codex-acp", "@agentclientprotocol/codex-acp"], minimum: [1, 10, 0] },
  { names: ["claude-acp", "@agentclientprotocol/claude-agent-acp"], minimum: [0, 75, 1] },
];

const STRICT_XYZ_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function describeForkSupport(
  level: AcpForkSupportLevel,
  reason: AcpForkSupportReason,
  source?: "capability" | "verified-adapter",
): AcpForkSupport {
  return {
    level,
    reason,
    message: FORK_SUPPORT_MESSAGE[reason],
    ...(source
      ? { messageFork: { version: 1 as const, inclusive: true as const, source } }
      : {}),
  };
}

type InclusiveForkPresence = "absent" | "valid" | "invalid";

function inclusiveForkCapabilityPresence(
  capabilities: schema.AgentCapabilities,
): InclusiveForkPresence {
  const meta = capabilities._meta;
  if (!isRecord(meta) || !isRecord(meta.jetbrains) || !isRecord(meta.jetbrains.air)) {
    return "absent";
  }
  if (!Object.hasOwn(meta.jetbrains.air, "fork")) return "absent";
  const fork = meta.jetbrains.air.fork;
  if (!isRecord(fork)) return "invalid";
  if (fork.version !== ACP_INCLUSIVE_FORK_VERSION || fork.inclusive !== true) return "invalid";
  return "valid";
}

function isVerifiedMessageForkAdapter(
  info: schema.Implementation | null | undefined,
): boolean {
  if (!info || typeof info.version !== "string") return false;
  const match = STRICT_XYZ_VERSION.exec(info.version);
  const major = match?.[1];
  const minor = match?.[2];
  const patch = match?.[3];
  if (major === undefined || minor === undefined || patch === undefined) return false;
  const version: [number, number, number] = [Number(major), Number(minor), Number(patch)];
  return VERIFIED_MESSAGE_FORK_ADAPTERS.some((adapter) =>
    adapter.names.includes(info.name) && compareVersion(version, adapter.minimum) >= 0,
  );
}

function compareVersion(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number {
  for (let index = 0; index < 3; index += 1) {
    const difference = left[index]! - right[index]!;
    if (difference !== 0) return difference;
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
