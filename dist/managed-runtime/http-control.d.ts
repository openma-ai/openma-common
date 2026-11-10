import type { RuntimeResourceScope } from "./contracts.js";
import type { ManagedHarnessControlChannel, ManagedHarnessInputContext, ManagedHarnessPromptCommand } from "./index.js";
import type { ManagedHarnessRecoveryHistoryPort } from "./semantic-recovery.js";
export interface ManagedHarnessHttpScheduler {
    sleep(milliseconds: number, signal: AbortSignal): Promise<void>;
}
/** The official Session response is intentionally kept in its wire shape.
 * The control channel validates ownership; the sandbox composition root may
 * then decode the Agent snapshot it needs before ACP is allowed to start. */
export type ManagedHarnessWireSession = Readonly<Record<string, unknown>> & {
    readonly id: string;
    readonly environment_id: string;
};
/** Native append-order feed. A cursor denotes an exclusive, immutable source
 * position, NOT processed_at or a consumed receipt. Even an empty tail page
 * returns the reusable cursor. The host owns auth and durable restart policy. */
export interface ManagedHarnessEventReader {
    read(input: {
        scope: RuntimeResourceScope;
        cursor: string | null;
        limit: number;
        signal: AbortSignal;
    }): Promise<{
        events: ManagedHarnessWireEvent[];
        cursor: string | null;
        hasMore: boolean;
    }>;
}
export interface ManagedHarnessHttpControlOptions {
    scope: RuntimeResourceScope;
    harness: {
        id: string;
        version: string;
    };
    workspacePath: string;
    apiBaseUrl: string;
    sessionsToken: string;
    fetch?: typeof globalThis.fetch;
    pollIntervalMs?: number;
    scheduler?: ManagedHarnessHttpScheduler;
    retry?: {
        maxAttempts?: number;
    };
    eventIds?: {
        next(): string;
    };
    clock?: {
        now(): Date;
    };
    onSessionLoaded?(session: ManagedHarnessWireSession): void | Promise<void>;
    eventReader?: ManagedHarnessEventReader;
    /** Persist the managed start after the input gate and before native dispatch.
     * Prevents first-event projection from reopening a later permission pause. */
    publishTurnStartBeforeDispatch?: boolean;
    /** Runs in the reader lane, never behind the pending ACP prompt. The event
     * is the exact eventReader object (including any host-owned raw document).
     * Both answered and rejected are terminal routing decisions: no text fallback.
     * The bridge owns consume CAS and resolving the original callback. */
    onToolConfirmation?(input: {
        scope: RuntimeResourceScope;
        event: ManagedHarnessWireEvent;
        activeTurnId: string | null;
        signal: AbortSignal;
    }): Promise<"answered" | "rejected">;
    /** Consume no-model inputs (partial/closed custom answers) in the reader lane.
     * Throw on a lost/failed receipt; nothing is automatically retried. */
    onInputSettled?(input: {
        scope: RuntimeResourceScope;
        input: ManagedHarnessInputContext;
        turnId: string;
        reason: "partial" | "closed";
        signal: AbortSignal;
    }): Promise<void>;
    onBeforeDispatch?(input: {
        scope: RuntimeResourceScope;
        command: ManagedHarnessPromptCommand;
        input: ManagedHarnessInputContext;
        signal: AbortSignal;
        kind: "prompt" | "steer";
    }): Promise<void>;
    onFallbackOwner?(input: {
        command: ManagedHarnessPromptCommand;
        signal: AbortSignal;
    }): Promise<string | null>;
    onConsumed?(input: {
        scope: RuntimeResourceScope;
        command: ManagedHarnessPromptCommand;
        input: ManagedHarnessInputContext;
        acceptance: import("../local-runtime/index.js").ManagedAgentsInputAcceptance;
    }): Promise<void>;
}
export interface ManagedHarnessHttpRecoveryHistoryOptions {
    apiBaseUrl: string;
    sessionsToken: string;
    fetch?: typeof globalThis.fetch;
    retry?: {
        maxAttempts?: number;
    };
    scheduler?: ManagedHarnessHttpScheduler;
    signal?: AbortSignal;
}
export interface ManagedHarnessHttpSkillSource {
    download(input: {
        skillId: string;
        version: string;
    }): Promise<Uint8Array>;
}
export interface ManagedHarnessWireEvent {
    id: string;
    type: string;
    processed_at: string | null;
    [key: string]: unknown;
}
export declare class ManagedHarnessHttpError extends Error {
    readonly status: number | null;
    readonly name = "ManagedHarnessHttpError";
    constructor(message: string, status: number | null);
}
/** Canonical Managed Events are the only semantic fallback when a native ACP
 * checkpoint is unavailable. The reader is paginated and deliberately drops
 * lifecycle/telemetry events rather than synthesizing an agent-native log. */
export declare function createManagedHarnessHttpRecoveryHistory(options: ManagedHarnessHttpRecoveryHistoryOptions): ManagedHarnessRecoveryHistoryPort;
/** Downloads a concrete Session-attached skill version with the same scoped
 * Work bearer used by the official Environment Worker. Archive extraction is
 * intentionally owned by the sandbox runner, not this transport adapter. */
export declare function createManagedHarnessHttpSkillSource(options: ManagedHarnessHttpRecoveryHistoryOptions): ManagedHarnessHttpSkillSource;
export declare function createManagedHarnessHttpControlChannel(options: ManagedHarnessHttpControlOptions): ManagedHarnessControlChannel;
//# sourceMappingURL=http-control.d.ts.map