export type SessionRestartMode = "now" | "after-turn";
export type SessionRestartDisposition = "ready" | "pending";
export interface QueuedSessionTurn<T> {
    readonly turnId: string;
    value: T;
    readonly createdAt: number;
}
export interface SessionOrchestratorOptions {
    sessionId: string;
    now?: () => number;
}
/**
 * Host-neutral session scheduling state.
 *
 * ACP owns prompt completion; this class owns the client-side policy around
 * which prompt may start next. It deliberately contains no transport,
 * persistence, workspace provisioning, or UI behavior.
 */
export declare class SessionOrchestrator<T> {
    #private;
    readonly sessionId: string;
    constructor(options: SessionOrchestratorOptions);
    get activeTurnId(): string | null;
    get queued(): readonly QueuedSessionTurn<T>[];
    get steeringTurnIds(): readonly string[];
    get restartPending(): boolean;
    get disposed(): boolean;
    isBusy(): boolean;
    tryStartTurn(turnId: string): boolean;
    finishTurn(turnId: string): boolean;
    enqueue(turnId: string, value: T): QueuedSessionTurn<T>;
    claimNext(): QueuedSessionTurn<T> | null;
    clearQueue(): QueuedSessionTurn<T>[];
    removeQueued(turnId: string): QueuedSessionTurn<T> | null;
    updateQueued(turnId: string, update: (value: T) => T): boolean;
    reorderQueue(turnIds: readonly string[]): void;
    beginSteering(turnId: string): boolean;
    finishSteering(turnId: string): boolean;
    requestRestart(mode: SessionRestartMode): SessionRestartDisposition;
    clearRestart(): void;
    dispose(): QueuedSessionTurn<T>[];
}
export interface SessionForkSource {
    acpSessionId: string;
    sessionId?: string;
}
export interface SessionInheritanceInput {
    cwd: string;
    additionalDirectories?: readonly string[];
    resumeAcpSessionId?: string;
    forkFrom?: SessionForkSource;
}
export type SessionInheritance = {
    kind: "new";
    cwd: string;
    additionalDirectories: string[];
} | {
    kind: "resume";
    cwd: string;
    additionalDirectories: string[];
    resumeAcpSessionId: string;
} | {
    kind: "fork";
    cwd: string;
    additionalDirectories: string[];
    parentSessionId?: string;
    forkFromAcpSessionId: string;
};
/** Normalize session inheritance once before a host opens an ACP session. */
export declare function sessionInheritance(input: SessionInheritanceInput): SessionInheritance;
//# sourceMappingURL=index.d.ts.map