import type { AcpSession } from "./types.js";
/** Native permission policy, not a per-tool override or CMA auxiliary review. */
export type AcpPermissionMode = "always_ask" | "auto" | "always_allow";
export interface ApplyAcpPermissionModeOptions {
    /** Canonical known-agent id; must agree with initialize.agentInfo. */
    harnessId: string;
    /** Omit to preserve all existing runtime behavior (no RPC or checks). */
    mode?: AcpPermissionMode;
    abortSignal?: AbortSignal;
    /** Bounded local wait, default 10 seconds. Does not cancel the remote RPC. */
    timeoutMs?: number;
}
export type AcpPermissionModeResult = {
    status: "not-configured";
} | {
    status: "applied";
    mode: AcpPermissionMode;
    nativeModeId: string;
    harnessId: string;
    version: string;
    verification: "session/set_config_option";
};
export type AcpPermissionModeErrorCode = "unsupported" | "mode-mismatch" | "apply-failed" | "aborted" | "timeout" | "busy";
/** Every error is a dispatch barrier for the caller; none permits a prompt. */
export declare class AcpPermissionModeError extends Error {
    readonly code: AcpPermissionModeErrorCode;
    readonly outcome: "not-dispatched" | "unknown";
    readonly effectiveModeId?: string | undefined;
    readonly name = "AcpPermissionModeError";
    /** Unknown outcome means the remote may have changed mode; never auto-retry. */
    constructor(code: AcpPermissionModeErrorCode, message: string, outcome: "not-dispatched" | "unknown", effectiveModeId?: string | undefined, options?: ErrorOptions);
}
/**
 * Opt-in, one-shot native mode application with authoritative ACP config
 * response verification. Never uses setMode(), legacy currentModeId, labels,
 * arbitrary _meta, or an empty set_mode ACK as proof. The supervisor MUST
 * await success before dispatch, serialize model/mode changes, and stop on
 * any failure or later native mode drift. This is not a lifetime policy lock.
 */
export declare function applyAcpPermissionMode(session: AcpSession, options: ApplyAcpPermissionModeOptions): Promise<AcpPermissionModeResult>;
//# sourceMappingURL=permission-mapping.d.ts.map