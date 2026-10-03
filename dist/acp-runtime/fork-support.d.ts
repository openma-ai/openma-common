import type * as schema from "@agentclientprotocol/sdk";
/** Inclusive-fork point selected by a client from visible assistant text. */
export interface AcpForkPoint {
    messageId: string;
    messageText: string;
    messageOccurrence: number;
}
/** Capability advertised at `initialize.agentCapabilities._meta.jetbrains.air.fork`
 * by agents that implement the inclusive `jetbrains.air.fork` v1 request meta on session/fork. */
export declare const ACP_INCLUSIVE_FORK_VERSION: 1;
export interface AcpInclusiveForkCapability {
    version: typeof ACP_INCLUSIVE_FORK_VERSION;
    inclusive: true;
}
export declare const ACP_INCLUSIVE_FORK_CAPABILITY: AcpInclusiveForkCapability;
/** `{ jetbrains: { air: { fork: ACP_INCLUSIVE_FORK_CAPABILITY } } }`, to deep-merge into agentCapabilities._meta. */
export declare function acpInclusiveForkCapabilityMeta(): {
    jetbrains: {
        air: {
            fork: AcpInclusiveForkCapability;
        };
    };
};
export type AcpForkSupportLevel = "none" | "session" | "message";
export type AcpForkSupportReason = "not-initialized" | "session-fork-not-advertised" | "message-fork-not-advertised" | "message-fork-capability-invalid" | "message-fork-advertised" | "message-fork-verified-adapter";
export interface AcpForkSupport {
    level: AcpForkSupportLevel;
    reason: AcpForkSupportReason;
    /** 英文、可直接展示给用户的说明，例如 "This agent can fork the whole session but not from a specific message." */
    message: string;
    /** level === "message" 时存在 */
    messageFork?: {
        version: 1;
        inclusive: true;
        source: "capability" | "verified-adapter";
    };
}
export interface AcpForkSupportSource {
    agentCapabilities?: schema.AgentCapabilities | null;
    agentInfo?: schema.Implementation | null;
}
/** 接受 AcpSession（有 agentCapabilities/agentInfo getter）或 InitializeResponse。 */
export declare function forkSupport(source: AcpForkSupportSource | null | undefined): AcpForkSupport;
/** Inclusive-fork `_meta` carried by `SessionOptions.sessionRequestMeta`.
 * The fingerprint is `sha256:` plus the SHA-256 of the message text's UTF-8 bytes. */
export declare function acpForkRequestMeta(point: AcpForkPoint): Record<string, unknown>;
/** Build fork points for top-level assistant messages already merged by message id.
 * `messageOccurrence` is the 1-based count of identical text in the prefix, including
 * the message itself. Callers collapse `<id>:segment:<n>` ids before calling this. */
export declare function acpForkPointsFromMessages(messages: ReadonlyArray<{
    messageId: string;
    text: string;
}>): AcpForkPoint[];
//# sourceMappingURL=fork-support.d.ts.map