/** Product-neutral runtime placement. Both Backchat and OpenManaged use the
 * same cloud transport; only the host behind a local runtime differs. */
export type SessionRuntime = "local" | "cloud";
export interface SessionStartCommand {
    type: "session.start";
    sessionId: string;
    agentId: string;
    runtime: SessionRuntime;
    acpSessionId?: string;
}
export interface SessionPromptCommand {
    type: "session.prompt";
    sessionId: string;
    turnId: string;
    text: string;
}
export interface SessionCancelCommand {
    type: "session.cancel";
    sessionId: string;
    turnId: string;
}
export interface SessionDisposeCommand {
    type: "session.dispose";
    sessionId: string;
}
export type SessionCommand = SessionStartCommand | SessionPromptCommand | SessionCancelCommand | SessionDisposeCommand;
export interface SessionReadyEvent {
    type: "session.ready";
    sessionId: string;
    acpSessionId: string;
}
export interface SessionStreamEvent {
    type: "session.event";
    sessionId: string;
    turnId: string;
    event: unknown;
}
export interface SessionCompleteEvent {
    type: "session.complete";
    sessionId: string;
    turnId: string;
}
export interface SessionErrorEvent {
    type: "session.error";
    sessionId: string;
    turnId?: string;
    message: string;
}
export interface SessionDisposedEvent {
    type: "session.disposed";
    sessionId: string;
}
export type SessionHostEvent = SessionReadyEvent | SessionStreamEvent | SessionCompleteEvent | SessionErrorEvent | SessionDisposedEvent;
export type SessionWireMessage = {
    type?: string;
    session_id?: string;
    tenant_id?: string;
    turn_id?: string;
    agent_id?: string;
    text?: string;
    event?: unknown;
    message?: string;
    acp_session_id?: string;
    resume?: {
        acp_session_id?: string;
    };
};
/** Decode the relay's snake_case JSON once at the boundary. Hosts should not
 * scatter wire-shape checks through their lifecycle implementation. */
export declare function decodeSessionCommand(input: unknown): SessionCommand | null;
/** Encode a host event to the relay wire shape. The optional tenant is kept
 * at the transport edge; it is not part of the local lifecycle model. */
export declare function encodeSessionHostEvent(event: SessionHostEvent, options?: {
    tenantId?: string;
}): Record<string, unknown>;
export type SessionLifecycleEvent = {
    type: "start.requested";
} | {
    type: "session.ready";
    acpSessionId: string;
} | {
    type: "prompt.requested";
    turnId: string;
} | {
    type: "prompt.cancelled";
    turnId: string;
} | {
    type: "session.complete";
    turnId: string;
} | {
    type: "session.error";
    turnId?: string;
    message: string;
} | {
    type: "session.disposed";
};
export type SessionLifecycleStatus = "draft" | "starting" | "ready" | "running" | "errored" | "disposed";
export interface SessionLifecycle {
    sessionId: string;
    status: SessionLifecycleStatus;
    acpSessionId?: string;
    activeTurnId?: string;
    lastError?: string;
}
export declare function initialSessionLifecycle(sessionId: string): SessionLifecycle;
/** Pure lifecycle reducer. Hosts keep their own persistence/transport, but
 * every host must apply these same transition and stale-event rules. */
export declare function reduceSessionLifecycle(state: SessionLifecycle, event: SessionLifecycleEvent): SessionLifecycle;
//# sourceMappingURL=index.d.ts.map