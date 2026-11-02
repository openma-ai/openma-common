import { type WireSessionEvent } from "./managed.js";
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
/**
 * Derive unresolved requires_action tool calls from a Managed wire log.
 *
 * Prefer an explicit `pendingActions` array when a frame already carries one
 * (Backchat task snapshots). Otherwise walk `session.status_idle` /
 * `session.status_running` / settle events the same way Backchat does.
 */
export declare function pendingManagedActions(events: readonly WireSessionEvent[]): PendingManagedAction[];
//# sourceMappingURL=pending-actions.d.ts.map