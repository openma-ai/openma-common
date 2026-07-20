function nonEmpty(value) {
    return typeof value === "string" && value.length > 0;
}
/** Decode the relay's snake_case JSON once at the boundary. Hosts should not
 * scatter wire-shape checks through their lifecycle implementation. */
export function decodeSessionCommand(input) {
    if (!input || typeof input !== "object")
        return null;
    const message = input;
    if (!nonEmpty(message.session_id))
        return null;
    switch (message.type) {
        case "session.start":
            if (!nonEmpty(message.agent_id))
                return null;
            return {
                type: "session.start",
                sessionId: message.session_id,
                agentId: message.agent_id,
                runtime: "local",
                ...(nonEmpty(message.resume?.acp_session_id)
                    ? { acpSessionId: message.resume.acp_session_id }
                    : {}),
            };
        case "session.prompt":
            if (!nonEmpty(message.turn_id) || typeof message.text !== "string")
                return null;
            return {
                type: "session.prompt",
                sessionId: message.session_id,
                turnId: message.turn_id,
                text: message.text,
            };
        case "session.cancel":
            if (!nonEmpty(message.turn_id))
                return null;
            return { type: "session.cancel", sessionId: message.session_id, turnId: message.turn_id };
        case "session.dispose":
            return { type: "session.dispose", sessionId: message.session_id };
        default:
            return null;
    }
}
/** Encode a host event to the relay wire shape. The optional tenant is kept
 * at the transport edge; it is not part of the local lifecycle model. */
export function encodeSessionHostEvent(event, options = {}) {
    const tenant = options.tenantId ? { tenant_id: options.tenantId } : {};
    switch (event.type) {
        case "session.ready":
            return {
                type: event.type,
                session_id: event.sessionId,
                ...tenant,
                acp_session_id: event.acpSessionId,
            };
        case "session.event":
            return {
                type: event.type,
                session_id: event.sessionId,
                ...tenant,
                turn_id: event.turnId,
                event: event.event,
            };
        case "session.complete":
            return {
                type: event.type,
                session_id: event.sessionId,
                ...tenant,
                turn_id: event.turnId,
            };
        case "session.error":
            return {
                type: event.type,
                session_id: event.sessionId,
                ...tenant,
                ...(event.turnId ? { turn_id: event.turnId } : {}),
                message: event.message,
            };
        case "session.disposed":
            return { type: event.type, session_id: event.sessionId, ...tenant };
    }
}
export function initialSessionLifecycle(sessionId) {
    return { sessionId, status: "draft" };
}
/** Pure lifecycle reducer. Hosts keep their own persistence/transport, but
 * every host must apply these same transition and stale-event rules. */
export function reduceSessionLifecycle(state, event) {
    switch (event.type) {
        case "start.requested":
            if (state.status === "disposed")
                return state;
            return { ...state, status: "starting", lastError: undefined };
        case "session.ready":
            if (state.status === "disposed")
                return state;
            return {
                ...state,
                status: "ready",
                acpSessionId: event.acpSessionId,
                activeTurnId: undefined,
                lastError: undefined,
            };
        case "prompt.requested":
            if (state.status === "disposed")
                return state;
            return { ...state, status: "running", activeTurnId: event.turnId, lastError: undefined };
        case "session.complete":
            if (state.activeTurnId !== event.turnId)
                return state;
            return { ...state, status: "ready", activeTurnId: undefined };
        case "prompt.cancelled":
            if (state.activeTurnId !== event.turnId)
                return state;
            return { ...state, status: "ready", activeTurnId: undefined };
        case "session.error":
            if (event.turnId && state.activeTurnId && event.turnId !== state.activeTurnId)
                return state;
            return {
                ...state,
                status: "errored",
                activeTurnId: undefined,
                lastError: event.message,
            };
        case "session.disposed":
            return { ...state, status: "disposed", activeTurnId: undefined };
    }
}
//# sourceMappingURL=index.js.map