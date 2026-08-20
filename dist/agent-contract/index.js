import { immutableJson, } from "../session-events/openma.js";
export * from "../session-events/openma.js";
export function createAgentSessionHandle(input) {
    if (!input.connectorId.trim())
        throw new Error("connectorId must not be empty");
    if (!input.externalSessionId.trim()) {
        throw new Error("externalSessionId must not be empty");
    }
    return immutableJson(input);
}
export function agentEventEnvelope(context, defaultSource) {
    if (!context.eventId.trim())
        throw new Error("eventId must not be empty");
    if (!context.sessionId.trim())
        throw new Error("sessionId must not be empty");
    if (!context.turnId.trim())
        throw new Error("turnId must not be empty");
    if (!context.occurredAt.trim())
        throw new Error("occurredAt must not be empty");
    if (!Number.isSafeInteger(context.seq) || context.seq < 0) {
        throw new Error("seq must be a non-negative safe integer");
    }
    return {
        event_id: context.eventId,
        session_id: context.sessionId,
        source: context.source ?? defaultSource,
        occurred_at: context.occurredAt,
        ...(context.sessionThreadId ? { session_thread_id: context.sessionThreadId } : {}),
        turn_id: context.turnId,
        ...(context.workItemId ? { work_item_id: context.workItemId } : {}),
        ...(context.parentEventId ? { parent_event_id: context.parentEventId } : {}),
        ...(context.parentId ? { parent_id: context.parentId } : {}),
        seq: context.seq,
    };
}
const TURN_TERMINAL_TYPES = {
    "turn.completed": "completed",
    "turn.failed": "failed",
    "turn.cancelled": "cancelled",
    "turn.interrupted": "interrupted",
};
export function turnTerminalStatus(event) {
    const status = TURN_TERMINAL_TYPES[event.type];
    if (status === undefined
        || typeof event.turn_id !== "string"
        || event.turn_id.length === 0
        || !Number.isSafeInteger(event.seq)
        || (event.seq ?? -1) < 0)
        return undefined;
    return status;
}
export function isTurnTerminalEvent(event) {
    return turnTerminalStatus(event) !== undefined;
}
export function isCallbackRequestEvent(event, category) {
    if (event.type !== "callback.requested")
        return false;
    if (!event.data || typeof event.data !== "object")
        return false;
    const data = event.data;
    if (typeof data.callback_id !== "string"
        || data.callback_id.length === 0
        || typeof data.fingerprint !== "string"
        || data.fingerprint.length === 0
        || typeof data.method !== "string"
        || data.method.length === 0)
        return false;
    return category === undefined
        || data.category === category;
}
export function isPermissionRequestEvent(event) {
    return isCallbackRequestEvent(event, "permission");
}
export function isElicitationRequestEvent(event) {
    return isCallbackRequestEvent(event, "elicitation");
}
export function callbackFingerprint(context, category, method, callbackId, params) {
    const segments = [
        context.sessionId,
        context.turnId,
        category,
        method,
        callbackId,
    ].map(encodeURIComponent);
    const normalizedParams = immutableJson(params ?? null);
    return `oma.callback.v1/${segments.join("/")}/${encodeURIComponent(canonicalJsonStringify(normalizedParams))}`;
}
function canonicalJsonStringify(value) {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJsonStringify).join(",")}]`;
    }
    const object = value;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJsonStringify(object[key])}`).join(",")}}`;
}
//# sourceMappingURL=index.js.map