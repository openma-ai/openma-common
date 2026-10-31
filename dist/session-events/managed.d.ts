import { type TurnRender } from "./acp.js";
export interface WireSessionEvent {
    type: string;
    [key: string]: unknown;
}
export type ToolFamily = "builtin" | "custom" | "mcp";
export interface CanonicalTool {
    id: string;
    family: ToolFamily;
    name: string;
    input?: unknown;
    output?: unknown;
    status: "pending" | "running" | "completed" | "failed";
    isError?: boolean;
    rawUse?: WireSessionEvent;
    rawResult?: WireSessionEvent;
}
export type NormalizedSessionEvent = {
    kind: "user_message";
    id: string;
    text: string;
    raw: WireSessionEvent;
} | {
    kind: "assistant_delta";
    id: string;
    text: string;
    raw: WireSessionEvent;
} | {
    kind: "assistant_message";
    id: string;
    text: string;
    raw: WireSessionEvent;
} | {
    kind: "assistant_stream_end";
    id?: string;
    raw: WireSessionEvent;
} | {
    kind: "thinking_delta";
    id: string;
    text: string;
    raw: WireSessionEvent;
} | {
    kind: "thinking";
    id: string;
    text: string;
    raw: WireSessionEvent;
} | {
    kind: "thinking_stream_end";
    id?: string;
    raw: WireSessionEvent;
} | {
    kind: "tool_input_start";
    toolId: string;
    name: string;
    raw: WireSessionEvent;
} | {
    kind: "tool_use";
    tool: CanonicalTool;
    raw: WireSessionEvent;
} | {
    kind: "tool_result";
    toolId: string;
    output: unknown;
    isError: boolean;
    raw: WireSessionEvent;
} | {
    kind: "notice";
    tone: "warning" | "error";
    message: string;
    source?: string;
    raw: WireSessionEvent;
} | {
    kind: "turn_running";
    raw: WireSessionEvent;
} | {
    kind: "turn_complete";
    /** Official `stop_reason.type` of `session.status_idle` (`end_turn`,
     * `requires_action`, `retries_exhausted`, ...). Undefined when absent. */
    stopReason?: string;
    /** `stop_reason.event_ids` for `requires_action`: the tool calls the
     * session is parked on. */
    awaitingEventIds?: string[];
    raw: WireSessionEvent;
} | {
    kind: "turn_terminated";
    raw: WireSessionEvent;
} | {
    kind: "ignore";
    raw: WireSessionEvent;
};
export type ConversationItem = {
    kind: "message";
    id: string;
    role: "user" | "assistant";
    text: string;
    /** A queued user message steered into this running turn. */
    steered?: true;
    raw: WireSessionEvent;
} | {
    kind: "thinking";
    id: string;
    text: string;
    raw: WireSessionEvent;
} | {
    kind: "tool";
    id: string;
    tool: CanonicalTool;
    raw: WireSessionEvent;
} | {
    kind: "notice";
    id: string;
    tone: "warning" | "error";
    message: string;
    source?: string;
    cause?: {
        error: string;
        model?: string;
    };
    raw: WireSessionEvent;
};
/** Turn lifecycle derived client-side from official Managed Agents events.
 * - `running`: the agent is working on it.
 * - `awaiting`: parked on `session.status_idle{stop_reason:requires_action}`;
 *   the same turn continues once the tool results / confirmations arrive.
 * - `completed`: ended with `end_turn`.
 * - `interrupted`: contained `user.interrupt` and then went idle.
 * - `errored` / `terminated`: error notice / terminal status. */
export type ConversationTurnStatus = "running" | "awaiting" | "completed" | "interrupted" | "errored" | "terminated";
export interface ConversationTurn {
    id: string;
    status: ConversationTurnStatus;
    /** Tool-call ids the turn is parked on while `status === "awaiting"`. */
    awaitingToolCallIds?: string[];
    /** Last `stop_reason.type` seen for this turn. */
    stopReason?: string;
    items: ConversationItem[];
    rawEvents: WireSessionEvent[];
}
export interface CanonicalChatTurn {
    id: string;
    status: ConversationTurn["status"];
    awaitingToolCallIds?: string[];
    stopReason?: string;
    /** Timestamp of the turn's first event (processed_at / occurred_at). */
    startedAt?: string;
    /** Timestamp of the turn's last event; absent while running. */
    endedAt?: string;
    userText: string;
    render: TurnRender;
    rawEvents: WireSessionEvent[];
}
export declare function eventText(content: unknown): string;
export declare function eventThreadId(event: WireSessionEvent): string;
export declare function eventStableId(event: WireSessionEvent, fallback: string): string;
/** Causal order for projection.
 *
 * When every event carries a numeric `seq` (OpenMA event log order), sort by
 * it. Otherwise keep list order but, within a run of adjacent events sharing
 * the same millisecond timestamp, move idle/terminated status events after
 * the other events of that millisecond: the server writes the closing tool
 * result / message / interrupt and the idle in the same ms, and a
 * `(processed_at, id)` list order can put the idle first. */
export declare function orderSessionEventsCausally(events: readonly WireSessionEvent[]): WireSessionEvent[];
export declare function normalizeSessionEvent(event: WireSessionEvent): NormalizedSessionEvent;
/** A `user.message` the server has accepted but not processed yet.
 *
 * Official Managed Agents semantics: `processed_at` is `null` while a
 * `user.message` waits behind the running turn; the same event id is
 * re-emitted with a timestamp once processing finishes. Queued messages are
 * kept out of `turns` so they never split the running turn. */
export interface QueuedUserMessage {
    id: string;
    text: string;
    /** `pending`: server reported `processed_at: null`. `deferred`: the
     * server stamped it (legacy accept-time stamping) but it arrived while the
     * current turn was still running, so it waits for that turn to end. */
    reason: "pending" | "deferred";
    raw: WireSessionEvent;
}
export interface ConversationProjectionOptions {
    threadId?: string;
    /** Treat a timestamped `user.message` that arrives while the current turn
     * has not reached idle/terminated as queued until that turn ends. This is
     * the fallback for servers that stamp `processed_at` at accept time.
     * Default: true. */
    deferMidTurnUserMessages?: boolean;
    /** Authoritative session status from the host (e.g. the session row).
     * When `idle`/`terminated`, no turn is left `running`. */
    sessionStatus?: "running" | "idle" | "terminated" | "rescheduling" | string;
}
/** Session-level state derived from the last status event. */
export type ProjectedSessionState = "running" | "requires_action" | "idle" | "terminated" | "unknown";
export interface ConversationProjection {
    turns: ConversationTurn[];
    queued: QueuedUserMessage[];
    /** Id of the turn that is still `running` or `awaiting`, if any. */
    activeTurnId?: string;
    /** Tool-call ids the session is parked on (`requires_action`). */
    awaitingToolCallIds: string[];
    sessionState: ProjectedSessionState;
}
export interface CanonicalChatProjection {
    turns: CanonicalChatTurn[];
    queued: QueuedUserMessage[];
    activeTurnId?: string;
    awaitingToolCallIds: string[];
    sessionState: ProjectedSessionState;
}
/** message_id of an OpenMA queue-lifecycle fact (`turn.cancelled` /
 * `turn.steered` about one queued user message), else undefined. */
export declare function queueLifecycleMessageId(event: WireSessionEvent): string | undefined;
export declare function projectConversationTurns(events: readonly WireSessionEvent[], options?: ConversationProjectionOptions): ConversationTurn[];
/** Project turns plus the queue of accepted-but-unprocessed user messages. */
export declare function projectConversation(events: readonly WireSessionEvent[], options?: ConversationProjectionOptions): ConversationProjection;
/** Adapt Managed's event vocabulary to the richer ACP/Backchat render model.
 * The renderer can therefore consume one `TurnRender` whether events came
 * from a local ACP child or OpenManaged's cloud/local runtime. */
export declare function projectCanonicalChatTurns(events: readonly WireSessionEvent[], options?: ConversationProjectionOptions): CanonicalChatTurn[];
/** Canonical chat turns plus queued user messages (see `QueuedUserMessage`). */
export declare function projectCanonicalChat(events: readonly WireSessionEvent[], options?: ConversationProjectionOptions): CanonicalChatProjection;
/** @deprecated Use @openma/common/protocol/managed for the v2 SDK codec. */
export * from "../protocol/managed/index.js";
//# sourceMappingURL=managed.d.ts.map