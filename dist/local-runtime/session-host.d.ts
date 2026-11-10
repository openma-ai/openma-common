import type { AcpRuntime, SessionOptions } from "../acp-runtime/index.js";
import type { SessionHostEvent } from "../session-kernel/index.js";
import type { ManagedAgentsSessionCheckpointStore } from "./checkpoint.js";
export type ManagedAgentsInputAcceptance = "prompt-dispatched" | "injected" | "startedNewTurn";
/** Per-dispatch control-plane hooks. Neither hook creates a reservation ledger.
 * A dispatched prompt is not proof of remote acceptance or exactly-once execution. */
export interface ManagedAgentsInputDispatchHooks {
    signal?: AbortSignal;
    beforeDispatch(kind?: "prompt" | "steer"): Promise<void>;
    onConsumed(acceptance: ManagedAgentsInputAcceptance): Promise<void>;
    /** Wrap only a confirmed prompt fallback, after permission has settled.
     * The supplied dispatch retains the original gate and receipt hooks. */
    runPromptFallback?(input: ManagedAgentsSessionPromptInput, dispatch: () => Promise<void>): Promise<void>;
}
/** Lifecycle controls do not opt into fenced consumption semantics. */
export interface ManagedAgentsDispatchLifecycle {
    signal?: AbortSignal;
    runPromptFallback?(input: ManagedAgentsSessionPromptInput, dispatch: () => Promise<void>): Promise<void>;
}
export declare class ManagedAgentsInputDispatchError extends Error {
    readonly inputId: string;
    readonly phase: "dispatch" | "receipt";
    readonly name = "ManagedAgentsInputDispatchError";
    readonly outcome = "unknown";
    constructor(inputId: string, phase: "dispatch" | "receipt", cause: unknown);
}
export interface ManagedAgentsSessionHostDependencies {
    runtime: AcpRuntime;
    emit(event: SessionHostEvent): void;
    scheduler?: ManagedAgentsRuntimeScheduler;
    /** Grace after ACP session/cancel before a stuck child is disposed. When
     * omitted the host preserves the legacy abort-only behavior. */
    cancelGraceMs?: number;
    checkpointStore?: ManagedAgentsSessionCheckpointStore;
    /** Unique per running host process/isolate. Required with a checkpoint
     * store so generations can fence stale restored copies. */
    hostInstanceId?: string;
}
export interface ManagedAgentsRuntimeScheduler {
    now(): number;
    sleep(ms: number): Promise<void>;
}
export interface ManagedAgentsDrainOptions {
    deadlineMs: number;
    pollIntervalMs?: number;
    abortGraceMs?: number;
    onProgress?(activeTurns: number, msLeft: number): void;
}
export interface ManagedAgentsDrainReport {
    initialTurns: number;
    abortedTurns: number;
    sessions: number;
}
export declare const systemRuntimeScheduler: ManagedAgentsRuntimeScheduler;
export interface ManagedAgentsSessionStartInput {
    sessionId: string;
    options: SessionOptions;
}
export interface ManagedAgentsSessionPromptInput {
    sessionId: string;
    turnId: string;
    text: string;
}
export interface ManagedAgentsSessionSteerInput {
    sessionId: string;
    eventId: string;
    text: string;
}
export declare class ManagedAgentsSessionHost {
    #private;
    constructor(dependencies: ManagedAgentsSessionHostDependencies);
    has(sessionId: string): boolean;
    sessionCount(): number;
    announce(sessionId: string): boolean;
    announceAll(): void;
    activeTurnCount(): number;
    start(input: ManagedAgentsSessionStartInput): Promise<void>;
    prompt(input: ManagedAgentsSessionPromptInput, hooks?: ManagedAgentsInputDispatchHooks, lifecycle?: ManagedAgentsDispatchLifecycle): Promise<void>;
    steer(input: ManagedAgentsSessionSteerInput, hooks?: ManagedAgentsInputDispatchHooks, lifecycle?: ManagedAgentsDispatchLifecycle): Promise<void>;
    dispose(sessionId: string): Promise<void>;
    disposeAll(): Promise<void>;
    drain(options: ManagedAgentsDrainOptions): Promise<ManagedAgentsDrainReport>;
    cancel(sessionId: string, turnId: string): Promise<void>;
}
//# sourceMappingURL=session-host.d.ts.map