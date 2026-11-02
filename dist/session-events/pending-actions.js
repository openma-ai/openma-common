import { eventThreadId } from "./managed.js";
function asRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
}
/**
 * Derive unresolved requires_action tool calls from a Managed wire log.
 *
 * Prefer an explicit `pendingActions` array when a frame already carries one
 * (Backchat task snapshots). Otherwise walk `session.status_idle` /
 * `session.status_running` / settle events the same way Backchat does.
 */
export function pendingManagedActions(events) {
    const direct = [...events]
        .reverse()
        .find((event) => Array.isArray(event.pendingActions));
    if (direct && Array.isArray(direct.pendingActions)) {
        return direct.pendingActions;
    }
    const tools = new Map();
    const requested = new Map();
    const resolved = new Set();
    for (const event of events) {
        if (typeof event.id === "string" &&
            event.id &&
            (event.type === "agent.tool_use" ||
                event.type === "agent.mcp_tool_use" ||
                event.type === "agent.custom_tool_use")) {
            tools.set(event.id, event);
        }
        const thread = eventThreadId(event);
        if (event.type === "session.status_running" ||
            event.type === "session.status_terminated") {
            requested.delete(thread);
        }
        if (event.type === "session.status_idle") {
            const reason = asRecord(event.stop_reason);
            const ids = Array.isArray(reason.event_ids)
                ? reason.event_ids.filter((id) => typeof id === "string" && id.length > 0)
                : [];
            requested.set(thread, reason.type === "requires_action" ? ids : []);
        }
        if ((event.type === "user.tool_confirmation" ||
            event.type === "agent.tool_result" ||
            event.type === "agent.mcp_tool_result") &&
            typeof event.tool_use_id === "string") {
            resolved.add(event.tool_use_id);
        }
        if (event.type === "user.custom_tool_result" &&
            typeof event.custom_tool_use_id === "string") {
            resolved.add(event.custom_tool_use_id);
        }
    }
    const ids = [...new Set([...requested.values()].flat())];
    return ids.flatMap((id) => {
        const event = tools.get(id);
        if (!event || resolved.has(id))
            return [];
        return [
            {
                id,
                type: event.type === "agent.custom_tool_use"
                    ? "custom_result"
                    : "confirmation",
                event,
            },
        ];
    });
}
//# sourceMappingURL=pending-actions.js.map