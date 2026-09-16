export interface ClaimedEnvironmentWorkHeartbeat {
    last_heartbeat: string;
    lease_extended: boolean;
    state: string;
    ttl_seconds: number;
}
export interface ClaimedEnvironmentWorkLifecycleClient {
    ack(workId: string, params: {
        environment_id: string;
    }, options?: {
        signal?: AbortSignal;
    }): PromiseLike<unknown>;
    heartbeat(workId: string, params: {
        environment_id: string;
        desired_ttl_seconds?: number;
        expected_last_heartbeat?: string;
    }, options?: {
        signal?: AbortSignal;
    }): PromiseLike<ClaimedEnvironmentWorkHeartbeat>;
    stop(workId: string, params: {
        environment_id: string;
        force?: boolean;
    }, options?: {
        signal?: AbortSignal;
    }): PromiseLike<unknown>;
}
export interface ClaimedEnvironmentWorkScheduler {
    sleep(milliseconds: number, signal: AbortSignal): Promise<void>;
}
export interface ClaimedEnvironmentWorkRunnerOptions {
    client: ClaimedEnvironmentWorkLifecycleClient;
    heartbeatIntervalMs?: number;
    heartbeatTtlSeconds?: number;
    scheduler?: ClaimedEnvironmentWorkScheduler;
    now?: () => number;
    onError?(error: unknown): void | Promise<void>;
}
export interface ClaimedEnvironmentWorkRunInput<T> {
    environmentId: string;
    sessionId: string;
    workId: string;
    signal?: AbortSignal;
    execute(signal: AbortSignal): Promise<T>;
}
export interface ClaimedEnvironmentWorkRunner {
    run<T>(input: ClaimedEnvironmentWorkRunInput<T>): Promise<T>;
}
export declare class ClaimedEnvironmentWorkLeaseLostError extends Error {
    readonly name = "ClaimedEnvironmentWorkLeaseLostError";
}
/**
 * Own one already-reserved Managed Agents Work item from inside its sandbox.
 *
 * The dispatcher deliberately leaves the item unacknowledged. This runner is
 * therefore the single owner of ACK, the optimistic-concurrency heartbeat,
 * execution cancellation, and terminal stop. A 412 fences the local process
 * immediately and suppresses stop because the Work may already belong to a
 * replacement.
 */
export declare function createClaimedEnvironmentWorkRunner(options: ClaimedEnvironmentWorkRunnerOptions): ClaimedEnvironmentWorkRunner;
//# sourceMappingURL=claimed-environment-work.d.ts.map