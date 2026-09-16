import type { AcpRuntime, SessionOptions } from "../acp-runtime/index.js";
import type { SessionHostEvent } from "../session-kernel/index.js";
import type { ManagedAgentsSessionCheckpointStore } from "./checkpoint.js";
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
    prompt(input: ManagedAgentsSessionPromptInput): Promise<void>;
    steer(input: ManagedAgentsSessionSteerInput): Promise<void>;
    dispose(sessionId: string): Promise<void>;
    disposeAll(): Promise<void>;
    drain(options: ManagedAgentsDrainOptions): Promise<ManagedAgentsDrainReport>;
    cancel(sessionId: string, turnId: string): Promise<void>;
}
//# sourceMappingURL=session-host.d.ts.map