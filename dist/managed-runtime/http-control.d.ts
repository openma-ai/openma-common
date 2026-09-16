import type { RuntimeResourceScope } from "./contracts.js";
import type { ManagedHarnessControlChannel } from "./index.js";
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