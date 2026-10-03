import type { ProjectAgentEvent, ProjectSessionFact, ProjectWorkView, ThreadGoal } from "./client.js";
type Session = ProjectSessionFact;
export interface ProjectThread {
    workThreadId: string;
    role: "coordinator" | "worker";
    workerId?: string;
    runId?: string;
    session: Session;
    turns: ProjectWorkView["facts"]["turns"][number][];
    goal?: ThreadGoal;
}
export interface ProjectChatTurn {
    id: string;
    sessionId: string;
    status: "queued" | "running" | "complete" | "error" | "cancelled";
    promptText: string;
    assistantText: string;
    thoughtText: string;
    events: readonly ProjectAgentEvent[];
    startedAt: number;
    endedAt?: number;
    errorMessage?: string;
}
/** Canonical full messages supersede streamed chunks with the same message id. */
export declare function projectResponseText(events: readonly {
    type: string;
    data?: unknown;
}[]): string;
/** Adapt durable project facts to the conversation column. */
export declare function projectCoordinatorTurns(view: ProjectWorkView, runId?: string): ProjectChatTurn[];
/** Project one work thread, independent of replacement sessions. */
export declare function projectThreads(view: ProjectWorkView, runId?: string): ProjectThread[];
export declare function projectGoalPresentation(goal: ThreadGoal): {
    readonly actions: {
        readonly pause: boolean;
        readonly resume: boolean;
        readonly dismiss: false;
    };
    readonly budgetLabel?: string | undefined;
    readonly title: string;
    readonly status: import("./client.js").ThreadGoalStatus;
    readonly tone: "success" | "danger" | "neutral";
    readonly elapsedSeconds: number;
    readonly elapsedSince: undefined;
};
export declare function projectOutcomeLabel(status: ThreadGoal["status"]): string;
export {};
//# sourceMappingURL=project-goals.d.ts.map