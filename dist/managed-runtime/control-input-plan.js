import { eventThreadId, normalizeSessionEvent } from "../session-events/managed.js";
/** Derive answer admission from canonical history, not an independent mutable
 * pending-call ledger. The shared event normalizer owns status/tool decoding. */
export function planManagedControlAnswer(history, event) {
    const thread = eventThreadId(event);
    let requested = null;
    const closed = new Set();
    for (const prior of history) {
        if (eventThreadId(prior) !== thread)
            continue;
        const normalized = normalizeSessionEvent(prior);
        if (normalized.kind === "turn_complete") {
            requested = normalized.stopReason === "requires_action" ? normalized.awaitingEventIds ?? [] : null;
        }
        else if (normalized.kind === "turn_running" || normalized.kind === "turn_terminated") {
            requested = null;
        }
        const id = managedControlAnswerId(prior);
        if (id !== null)
            closed.add(id);
    }
    const id = managedControlAnswerId(event);
    if (id === null || closed.has(id))
        return "closed";
    if (requested === null)
        return "release";
    const pending = requested.filter(id => !closed.has(id));
    if (!pending.includes(id))
        return "closed";
    return pending.some(other => other !== id) ? "partial" : "release";
}
export function managedControlAnswerId(event) {
    const normalized = normalizeSessionEvent(event);
    if (normalized.kind === "tool_result")
        return normalized.toolId;
    const id = event.type === "user.custom_tool_result" ? event.custom_tool_use_id
        : event.type === "user.tool_confirmation" || event.type === "user.tool_result" ? event.tool_use_id : undefined;
    return typeof id === "string" && id.length > 0 ? id : null;
}
//# sourceMappingURL=control-input-plan.js.map