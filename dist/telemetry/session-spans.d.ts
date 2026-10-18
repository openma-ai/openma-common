import { type Attributes, type Context, type Tracer } from "@opentelemetry/api";
/**
 * Span bookkeeping for one ACP session: `create_agent` while the agent
 * starts, one `invoke_agent` per turn, one `execute_tool` child per tool
 * call. Every span opened here is closed here.
 *
 * Attributes are metadata only — ids, names, kinds, counts, durations. No
 * prompt text, tool titles (they carry paths), arguments, output or error
 * messages; hosts keep those in their local logs.
 */
export type SpanOutcome = {
    status: "ok";
}
/** `errorType` is a short closed code (e.g. `auth_required`), not a message. */
 | {
    status: "error";
    errorType: string;
}
/** Ended without success or failure, e.g. cancelled or disposed. */
 | {
    status: "unset";
    reason: string;
};
export interface SessionIdentity {
    agentName: string;
    attributes?: Attributes;
}
export interface ToolCallInfo {
    toolCallId: string;
    name?: string;
    kind?: string;
}
export interface ContextUsage {
    used?: number;
    size?: number;
    costAmount?: number;
}
export declare class SessionSpans {
    #private;
    private readonly tracer;
    readonly sessionId: string;
    private identity;
    constructor(tracer: Tracer, sessionId: string, identity: SessionIdentity);
    get ready(): boolean;
    /** Attributes shared by every span of this session. */
    attributes(): Attributes;
    beginCreateAgent(identity: SessionIdentity): void;
    markReady(acpSessionId: string | undefined): void;
    /** Fail a pending start; false when no start was pending. */
    failStart(errorType: string): boolean;
    /**
     * Open a turn. With a remote parent (a forwarded traceparent) the turn
     * joins the caller's trace; otherwise it roots its own, grouped with the
     * session by `gen_ai.conversation.id`.
     */
    beginTurn(turnId: string, promptChars: number | undefined, remoteParent?: Context): void;
    hasTurn(turnId: string): boolean;
    /** End one turn and its open tools, or every open turn when undefined. */
    endTurn(turnId: string | undefined, outcome: SpanOutcome, attributes?: Attributes): void;
    /** Add an event to a turn, or to the oldest open turn when unspecified. */
    addTurnEvent(turnId: string | undefined, name: string, attributes?: Attributes): void;
    recordUsage(turnId: string, usage: ContextUsage): void;
    beginTool(turnId: string, tool: ToolCallInfo): void;
    endTool(toolCallId: string, outcome: "completed" | "failed"): void;
    /** Close every open span, innermost first. */
    closeAll(reason: string): void;
}
//# sourceMappingURL=session-spans.d.ts.map