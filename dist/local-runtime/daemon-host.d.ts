export interface DaemonDrainSummary {
    initialTurns: number;
    abortedTurns: number;
    sessions: number;
}
export type DaemonStopResult = {
    kind: "drained";
    summary: DaemonDrainSummary;
} | {
    kind: "forced";
};
export interface DaemonHostOptions {
    connection: {
        start(): void;
        stop(): void;
    };
    sessions: {
        /** Must close admission synchronously, then drain and dispose owned sessions. */
        drain(deadlineMs: number, options?: {
            onProgress?: (active: number, msLeft: number) => void;
        }): Promise<DaemonDrainSummary>;
        disposeAll(): Promise<void>;
    };
    drainDeadlineMs: number;
    onProgress?: (active: number, msLeft: number) => void;
}
/** Lifecycle of an execution host owned by this caller, never an external daemon.
 * Session admission/execution remain with the supplied session manager. Process
 * signals, PID files, IPC, discovery and process exit belong to outer adapters.
 */
export declare class DaemonHost {
    #private;
    constructor(options: DaemonHostOptions);
    start(): void;
    stop(options?: {
        force?: boolean;
    }): Promise<DaemonStopResult>;
}
//# sourceMappingURL=daemon-host.d.ts.map