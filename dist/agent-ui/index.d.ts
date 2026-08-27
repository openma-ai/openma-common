import type { OpenMAEvent, CanonicalPlanEntry, CallbackCategory, PlanRepresentation, ToolOutputData, ToolStatus, WorkItemKind, WorkItemStatus } from "../session-events/openma.js";
export declare const AGENT_UI_STATE_VERSION: "oma.agent-ui.v1";
export type AgentUISessionStatus = "unknown" | "running" | "rescheduled" | "idle" | "terminated" | "error";
export type AgentUITurnStatus = "unknown" | "queued" | "running" | "completed" | "failed" | "cancelled";
export interface AgentUIMessageItem {
    id: string;
    /** Present when a tool split one protocol message into multiple UI segments. */
    messageId?: string;
    kind: "message" | "thinking" | "notice";
    role: "user" | "assistant" | "system";
    text: string;
    status: "streaming" | "complete";
    content?: unknown;
    phase?: "commentary" | "final_answer";
}
export interface AgentUIToolItem {
    id: string;
    kind: "tool";
    name?: string;
    title?: string;
    toolKind?: string;
    status: ToolStatus;
    rawInput?: unknown;
    rawOutput?: unknown;
    content?: unknown[];
    locations?: Array<{
        path?: string;
        line?: number;
    }>;
    adapterMeta?: Record<string, unknown>;
    outputs: ToolOutputData[];
    error?: string;
    reason?: string;
}
export interface AgentUIRawItem {
    id: string;
    kind: "raw";
    event: OpenMAEvent;
}
export type AgentUITimelineItem = AgentUIMessageItem | AgentUIToolItem | AgentUIRawItem;
export interface AgentUIWorkItemState {
    id: string;
    kind: WorkItemKind;
    status: WorkItemStatus;
    title?: string;
    progress?: number;
    output: unknown[];
    result?: unknown;
    error?: string;
    reason?: string;
    startedAt?: string;
    endedAt?: string;
    missingStart?: boolean;
    missingTerminal?: boolean;
}
export interface AgentUIPlanState {
    id: string;
    representation: PlanRepresentation;
    status: "active" | "completed";
    entries: CanonicalPlanEntry[];
}
export interface AgentUICallbackState {
    id: string;
    category: CallbackCategory;
    method: string;
    status: "pending" | "completed" | "failed" | "notification";
    params?: unknown;
    result?: unknown;
    error?: unknown;
}
export interface AgentUIUsageState {
    snapshot: unknown;
    budget?: unknown;
    updatedAt: string;
}
export interface AgentUIOutcomeState {
    id: string;
    status: string;
    description?: string;
    rubric?: unknown;
    maxIterations?: number | null;
    iteration?: number;
    explanation?: string;
    usage?: unknown;
    updatedAt: string;
}
export interface AgentUISessionInfoState {
    title?: string | null;
    updatedAt?: string | null;
}
export interface AgentUITurnState {
    id: string;
    status: AgentUITurnStatus;
    items: AgentUITimelineItem[];
    error?: string;
    reason?: string;
    startedAt?: string;
    endedAt?: string;
}
export interface AgentUIState {
    version: typeof AGENT_UI_STATE_VERSION;
    sessionId: string;
    status: AgentUISessionStatus;
    sessionInfo: AgentUISessionInfoState;
    commands: unknown[];
    capabilities: Record<string, unknown>;
    activeTurnId?: string;
    turnOrder: string[];
    turns: Record<string, AgentUITurnState>;
    workItemOrder: string[];
    workItems: Record<string, AgentUIWorkItemState>;
    planOrder: string[];
    plans: Record<string, AgentUIPlanState>;
    callbackOrder: string[];
    callbacks: Record<string, AgentUICallbackState>;
    usage?: AgentUIUsageState;
    outcomeOrder: string[];
    outcomes: Record<string, AgentUIOutcomeState>;
    seenEventIds: Record<string, true>;
    lastError?: string;
}
export declare function createAgentUIState(sessionId: string): AgentUIState;
export declare function mergeAgentUIStreamingText(accumulated: string, incoming: string): string;
export declare function reduceAgentUIEvent(state: AgentUIState, event: OpenMAEvent): AgentUIState;
export declare function replayAgentUIEvents(sessionId: string, events: readonly OpenMAEvent[]): AgentUIState;
export interface AgentUIStore {
    getState(): AgentUIState;
    getSnapshot(): AgentUIState;
    dispatch(event: OpenMAEvent): AgentUIState;
    subscribe(listener: (state: AgentUIState) => void): () => void;
    subscribeTurnStream(turnId: string, listener: AgentUIStreamSubscriber): () => void;
}
/** Append-only host event row used by Backchat-compatible session stores.
 * The host owns persistence; common owns deterministic replay into Agent UI. */
export interface PersistedAgentUIEvent {
    seq: number;
    type: string;
    data: unknown;
    ts: number;
}
export type PersistedAgentUIEventDecoder = (row: PersistedAgentUIEvent) => OpenMAEvent | readonly OpenMAEvent[] | null | undefined;
/** Rebuild a live Agent UI store from persisted host events. Stable seq
 * ordering and the store's event-id dedupe make repeated hydration safe. */
export declare function replayAgentUIEventLog(store: AgentUIStore, rows: readonly PersistedAgentUIEvent[], decode: PersistedAgentUIEventDecoder): AgentUIState;
/**
 * In-memory transcript authority keyed by product session id. A host may swap
 * or reconnect transports, but selecting a session must resolve back to the
 * same store until the host explicitly removes it.
 */
export interface AgentUISessionRegistry {
    get(sessionId: string): AgentUIStore;
    has(sessionId: string): boolean;
    remove(sessionId: string): boolean;
    clear(): void;
}
export declare function createAgentUISessionRegistry(): AgentUISessionRegistry;
export type AgentUIStreamDelta = {
    kind: "assistant";
    text: string;
} | {
    kind: "thought";
    text: string;
};
export type AgentUIStreamSubscriber = (delta: AgentUIStreamDelta) => void;
export declare function createAgentUIStore(sessionId: string): AgentUIStore;
export * from "./presentation.js";
//# sourceMappingURL=index.d.ts.map