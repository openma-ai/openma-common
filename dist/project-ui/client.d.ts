/**
 * Projects host boundary.
 *
 * `@openma/common/project-ui` renders against this interface and nothing else.
 * Backchat implements it on top of its desktop bridge. The OMA console
 * implements it over HTTP. Neither implementation is imported here: there is
 * no Node, Electron, or network code in this entry.
 */
export interface ProjectInfo {
    id: string;
    name: string;
    /** Ordered workspace roots. The primary folder is first when one is set. */
    source_folders: string[];
    /** Default cwd for new work, Git, and project instruction discovery. */
    primary_folder: string;
    created_at: number;
    updated_at: number;
}
export interface ProjectSaveParams {
    project_id: string;
    name: string;
    source_folders: string[];
    primary_folder?: string;
}
export interface ProjectResource {
    id: string;
    name: string;
    text: string;
}
export interface ProjectRepository {
    url: string;
    baseRef?: string;
}
export type ProjectExecution = {
    kind: "local";
} | {
    kind: "cloud";
    baseUrl?: string;
    userId?: string;
    workspaceId?: string;
};
export type ProjectControl = "delegate" | "steer" | "cancel" | "complete";
export type ProjectContinuity = "per-scope" | "per-run";
/** Coordinator configuration persisted beside the project record. */
export interface ProjectWorkConfig {
    projectId: string;
    /** New threads start here; existing workspaces retain their original base. */
    baseRef?: string;
    /** Cloud repository resources. Credentials stay on the host. */
    repositories?: ProjectRepository[];
    description: string;
    instructions: string;
    context: string;
    resources: ProjectResource[];
    coordinatorAgent: string;
    coordinatorEnvironment?: string;
    workerEnvironment?: string;
    workerAgent: string;
    continuity: ProjectContinuity;
    controls: ProjectControl[];
    execution?: ProjectExecution;
}
export interface ProjectAttachment {
    id: string;
    name: string;
    kind: "image" | "file";
    mimeType: string;
    data: string;
}
export interface ProjectWorkCommand {
    projectId: string;
    commandId: string;
    runId?: string;
    type: "message" | "delegate" | "steer" | "cancel" | "complete";
    text: string;
    attachments?: readonly ProjectAttachment[];
    workerId?: string;
}
export type ThreadGoalStatus = "active" | "paused" | "blocked" | "usage_limited" | "budget_limited" | "complete";
/** Host-controlled outcome for one stable work thread. */
export interface ThreadGoal {
    id: string;
    scopeId: string;
    workThreadId: string;
    objective: string;
    status: ThreadGoalStatus;
    tokenBudget?: number;
    tokensUsed: number;
    timeUsedSeconds: number;
    createdAt: string;
    updatedAt: string;
    revision: number;
    reason?: string;
}
export interface ProjectGoalInput {
    projectId: string;
    workThreadId: string;
    objective?: string;
    status?: "active" | "paused";
    tokenBudget?: number | null;
    clear?: boolean;
}
export interface ProjectAgentEvent {
    type: string;
    session_id?: string;
    turn_id?: string;
    occurred_at?: string;
    ingested_at?: string;
    data?: unknown;
}
export interface ProjectSessionFact {
    id: string;
    scopeId: string;
    workThreadId: string;
    agentId: string;
    generation?: number;
    lastUsedAt?: string;
    state?: string;
}
export interface ProjectTurnFact {
    id: string;
    sessionId: string;
    triggerEventId?: string;
    state: "queued" | "running" | "completed" | "failed" | "cancelled";
    createdAt: string;
    completedAt?: string;
}
export interface ProjectWorkEventFact {
    id: string;
    type: string;
    occurredAt: string;
    payload?: unknown;
}
export interface ProjectContextFact {
    scopeId?: string;
    workThreadId: string;
    createdAt: string;
    items: readonly {
        kind: string;
        value?: unknown;
    }[];
}
export interface ProjectReactionFact {
    eventId: string;
    status?: string;
    reason?: string;
}
/** Durable facts the Projects screens read. Hosts project their store into this shape. */
export interface ProjectFacts {
    sessions: readonly ProjectSessionFact[];
    turns: readonly ProjectTurnFact[];
    events: readonly ProjectWorkEventFact[];
    agentEvents: readonly ProjectAgentEvent[];
    contexts: readonly ProjectContextFact[];
    goals: readonly ThreadGoal[];
    reactions: readonly ProjectReactionFact[];
}
export interface ProjectWorkspaceBinding {
    id: string;
    projectId: string;
    workThreadId: string;
    branch?: string | null;
    location?: {
        cwd?: string;
        branch?: string | null;
        remoteSessionId?: string;
    } | null;
}
export interface ProjectExternalTask {
    id: string;
    text: string;
    status?: string;
    coordinator_name?: string;
}
export interface ProjectWorkView {
    project: ProjectInfo;
    config: ProjectWorkConfig | null;
    facts: ProjectFacts;
    workspaces?: readonly ProjectWorkspaceBinding[];
    pending: number;
    error: string | null;
    external_tasks?: readonly ProjectExternalTask[];
}
/** A checkout the host created or adopted for one project. */
export interface ProjectWorktree {
    id: string;
    projectId: string;
    name: string;
    branch: string | null;
    paths: readonly string[];
}
export interface ProjectWorktreeCreate {
    projectId: string;
    name: string;
    baseRef?: string;
}
/**
 * Operations the Projects screens use.
 *
 * `pickFolders` and the worktree methods are optional. A host without a local
 * filesystem dialog, or without git worktrees, omits them and the UI hides
 * those actions.
 */
export interface ProjectClient {
    list(): Promise<readonly ProjectInfo[]>;
    view(projectId: string): Promise<ProjectWorkView>;
    /** Create or update the project record (name and source folders). */
    save(input: ProjectSaveParams): Promise<ProjectInfo>;
    /** Persist coordinator configuration, instructions, context, and resources. */
    saveWork(config: ProjectWorkConfig): Promise<ProjectWorkConfig>;
    submit(command: ProjectWorkCommand): Promise<void>;
    goal(input: ProjectGoalInput): Promise<ThreadGoal | null>;
    delete(projectId: string): Promise<void>;
    /**
     * Local folder picker. Omit when the host has no desktop filesystem dialog.
     * Resolves to the directories the user confirmed, or an empty list on cancel.
     */
    pickFolders?(options?: {
        defaultPath?: string;
    }): Promise<readonly string[]>;
    /** Git worktrees for one project. Omit when the host does not manage them. */
    listWorktrees?(projectId: string): Promise<readonly ProjectWorktree[]>;
    createWorktree?(input: ProjectWorktreeCreate): Promise<ProjectWorktree>;
    deleteWorktree?(worktreeId: string): Promise<void>;
    /** Optional push when the host's project list changes outside this UI. */
    subscribe?(onStoreChange: () => void): () => void;
}
export declare function emptyProjectFacts(): ProjectFacts;
/** Puts the primary folder first and drops blanks and duplicates. */
export declare function normalizeProjectFolders(input: {
    source_folders: readonly string[];
    primary_folder?: string | null;
}): Pick<ProjectInfo, "source_folders" | "primary_folder">;
//# sourceMappingURL=client.d.ts.map