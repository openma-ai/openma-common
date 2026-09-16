/** Stable identity of one Managed Agents work item and its Session. */
export interface RuntimeResourceScope {
    workspaceId: string;
    environmentId: string;
    sessionId: string;
    workId: string;
}
export interface HarnessSupervisorRun {
    completed: Promise<{
        exitCode: number;
    }>;
    drain(): Promise<void>;
    stop(reason: "aborted" | "failed"): Promise<void>;
}
export interface HarnessSupervisorHarness {
    start(input: {
        scope: RuntimeResourceScope;
        harness: {
            id: string;
            version: string;
        };
        workspacePath: "/workspace";
        outputPath: "/mnt/session/outputs" | null;
        checkpoint(input: {
            sessionId: string;
            turnId?: string;
        }): Promise<void>;
        signal: AbortSignal;
    }): Promise<HarnessSupervisorRun>;
}
//# sourceMappingURL=contracts.d.ts.map