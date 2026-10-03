import { createHash } from "node:crypto";
/** Capability advertised at `initialize.agentCapabilities._meta.jetbrains.air.fork`
 * by agents that implement the inclusive `jetbrains.air.fork` v1 request meta on session/fork. */
export const ACP_INCLUSIVE_FORK_VERSION = 1;
export const ACP_INCLUSIVE_FORK_CAPABILITY = Object.freeze({
    version: ACP_INCLUSIVE_FORK_VERSION,
    inclusive: true,
});
/** `{ jetbrains: { air: { fork: ACP_INCLUSIVE_FORK_CAPABILITY } } }`, to deep-merge into agentCapabilities._meta. */
export function acpInclusiveForkCapabilityMeta() {
    return {
        jetbrains: {
            air: {
                fork: ACP_INCLUSIVE_FORK_CAPABILITY,
            },
        },
    };
}
/** 接受 AcpSession（有 agentCapabilities/agentInfo getter）或 InitializeResponse。 */
export function forkSupport(source) {
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
/** Inclusive-fork `_meta` carried by `SessionOptions.sessionRequestMeta`.
 * The fingerprint is `sha256:` plus the SHA-256 of the message text's UTF-8 bytes. */
export function acpForkRequestMeta(point) {
    return {
        jetbrains: {
            air: {
                fork: {
                    version: 1,
                    messageId: point.messageId,
                    messageFingerprint: `sha256:${createHash("sha256").update(point.messageText, "utf8").digest("hex")}`,
                    messageOccurrence: point.messageOccurrence,
                },
            },
        },
    };
}
/** Build fork points for top-level assistant messages already merged by message id.
 * `messageOccurrence` is the 1-based count of identical text in the prefix, including
 * the message itself. Callers collapse `<id>:segment:<n>` ids before calling this. */
export function acpForkPointsFromMessages(messages) {
    const seen = new Map();
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
const FORK_SUPPORT_MESSAGE = {
    "not-initialized": "This agent has not reported whether it can fork a session.",
    "session-fork-not-advertised": "This agent does not support forking a session.",
    "message-fork-not-advertised": "This agent can fork the whole session but not from a specific message.",
    "message-fork-capability-invalid": "This agent advertised a message fork capability this client does not recognize.",
    "message-fork-advertised": "This agent can fork from a specific message.",
    "message-fork-verified-adapter": "This agent can fork from a specific message.",
};
/** Upstream adapters that implement inclusive fork but do not emit the capability key.
 * Internal. Own adapters (dsh-acp, pi-acp) must advertise the capability instead. */
const VERIFIED_MESSAGE_FORK_ADAPTERS = [
    { names: ["codex-acp", "@agentclientprotocol/codex-acp"], minimum: [1, 10, 0] },
    { names: ["claude-acp", "@agentclientprotocol/claude-agent-acp"], minimum: [0, 75, 1] },
];
const STRICT_XYZ_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
function describeForkSupport(level, reason, source) {
    return {
        level,
        reason,
        message: FORK_SUPPORT_MESSAGE[reason],
        ...(source
            ? { messageFork: { version: 1, inclusive: true, source } }
            : {}),
    };
}
function inclusiveForkCapabilityPresence(capabilities) {
    const meta = capabilities._meta;
    if (!isRecord(meta) || !isRecord(meta.jetbrains) || !isRecord(meta.jetbrains.air)) {
        return "absent";
    }
    if (!Object.hasOwn(meta.jetbrains.air, "fork"))
        return "absent";
    const fork = meta.jetbrains.air.fork;
    if (!isRecord(fork))
        return "invalid";
    if (fork.version !== ACP_INCLUSIVE_FORK_VERSION || fork.inclusive !== true)
        return "invalid";
    return "valid";
}
function isVerifiedMessageForkAdapter(info) {
    if (!info || typeof info.version !== "string")
        return false;
    const match = STRICT_XYZ_VERSION.exec(info.version);
    const major = match?.[1];
    const minor = match?.[2];
    const patch = match?.[3];
    if (major === undefined || minor === undefined || patch === undefined)
        return false;
    const version = [Number(major), Number(minor), Number(patch)];
    return VERIFIED_MESSAGE_FORK_ADAPTERS.some((adapter) => adapter.names.includes(info.name) && compareVersion(version, adapter.minimum) >= 0);
}
function compareVersion(left, right) {
    for (let index = 0; index < 3; index += 1) {
        const difference = left[index] - right[index];
        if (difference !== 0)
            return difference;
    }
    return 0;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=fork-support.js.map