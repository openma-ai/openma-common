import { eventThreadId, type WireSessionEvent } from "./managed.js";

/**
 * A tool call the Managed session is parked on (`session.status_idle` with
 * `stop_reason.type === "requires_action"`). `confirmation` needs a
 * `user.tool_confirmation`; `custom_result` needs a `user.custom_tool_result`.
 */
export interface PendingManagedAction {
  id: string;
  type: "confirmation" | "custom_result";
  event: WireSessionEvent;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Derive unresolved requires_action tool calls from a Managed wire log.
 *
 * Prefer an explicit `pendingActions` array when a frame already carries one
 * (Backchat task snapshots). Otherwise walk `session.status_idle` /
 * `session.status_running` / settle events the same way Backchat does.
 */
export function pendingManagedActions(
  events: readonly WireSessionEvent[],
): PendingManagedAction[] {
  const direct = [...events]
    .reverse()
    .find((event) => Array.isArray(event.pendingActions));
  if (direct && Array.isArray(direct.pendingActions)) {
    return direct.pendingActions as PendingManagedAction[];
  }

  const tools = new Map<string, WireSessionEvent>();
  const requested = new Map<string, string[]>();
  const resolved = new Set<string>();

  for (const event of events) {
    if (
      typeof event.id === "string" &&
      event.id &&
      (event.type === "agent.tool_use" ||
        event.type === "agent.mcp_tool_use" ||
        event.type === "agent.custom_tool_use")
    ) {
      tools.set(event.id, event);
    }

    const thread = eventThreadId(event);
    if (
      event.type === "session.status_running" ||
      event.type === "session.status_terminated"
    ) {
      requested.delete(thread);
    }
    if (event.type === "session.status_idle") {
      const reason = asRecord(event.stop_reason);
      const ids = Array.isArray(reason.event_ids)
        ? reason.event_ids.filter(
            (id): id is string => typeof id === "string" && id.length > 0,
          )
        : [];
      requested.set(
        thread,
        reason.type === "requires_action" ? ids : [],
      );
    }

    if (
      (event.type === "user.tool_confirmation" ||
        event.type === "agent.tool_result" ||
        event.type === "agent.mcp_tool_result") &&
      typeof event.tool_use_id === "string"
    ) {
      resolved.add(event.tool_use_id);
    }
    if (
      event.type === "user.custom_tool_result" &&
      typeof event.custom_tool_use_id === "string"
    ) {
      resolved.add(event.custom_tool_use_id);
    }
  }

  const ids = [...new Set([...requested.values()].flat())];
  return ids.flatMap((id) => {
    const event = tools.get(id);
    if (!event || resolved.has(id)) return [];
    return [
      {
        id,
        type:
          event.type === "agent.custom_tool_use"
            ? ("custom_result" as const)
            : ("confirmation" as const),
        event,
      },
    ];
  });
}
