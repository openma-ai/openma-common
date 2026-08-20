/**
 * OpenMA's harness-neutral event contract.
 *
 * ACP and vendor adapters translate their wire payloads into this envelope.
 * The renderer may project these events into UI state, but must not turn the
 * projection into a second event vocabulary.
 */
export declare const OPENMA_EVENT_SCHEMA_VERSION: "oma.event.v1";
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
    readonly [key: string]: JsonValue;
}
export interface JsonArray extends ReadonlyArray<JsonValue> {
}
export type DeepReadonly<T> = T extends JsonPrimitive ? T : T extends readonly (infer U)[] ? readonly DeepReadonly<U>[] : T extends object ? {
    readonly [K in keyof T]: DeepReadonly<T[K]>;
} : T;
/** Validate, clone, and recursively freeze one portable JSON value.
 * Unlike a JSON stringify/parse round trip, this rejects values that would be
 * silently omitted or coerced. Published facts therefore preserve exactly the
 * data the adapter supplied. */
export declare function immutableJson<T>(value: T): DeepReadonly<T>;
export type OpenMAEventSourceKind = "harness" | "openma" | "user" | "system";
export interface OpenMAEventSource {
    kind: OpenMAEventSourceKind;
    harness?: string;
    adapter?: string;
}
export interface RawEventRecord {
    kind: "raw";
    source: "acp" | "adapter" | "transport";
    method?: string;
    event_type?: string;
    payload: unknown;
    received_at: string;
    reason: "unknown" | "unsupported" | "malformed";
}
export interface VendorEventRecord {
    kind: "vendor";
    harness: string;
    namespace: string;
    name: string;
    version?: string;
    correlation?: {
        session_id?: string;
        turn_id?: string;
        work_item_id?: string;
        parent_id?: string;
    };
    data: unknown;
}
export type CanonicalEventType = "user.message" | "user.interrupt" | "user.permission_response" | "user.elicitation_response" | "agent.message" | "agent.message_chunk" | "agent.thinking" | "turn.queued" | "turn.started" | "turn.completed" | "turn.failed" | "turn.cancelled" | "turn.interrupted" | "tool.started" | "tool.progress" | "tool.completed" | "tool.failed" | "tool.cancelled" | "work_item.started" | "work_item.progress" | "work_item.output" | "work_item.completed" | "work_item.failed" | "work_item.cancelled" | "work_item.killed" | "work_item.terminated" | "work_item.missing_terminal" | "work_item.reidentified" | "work_item.classified" | "monitor.event" | "plan.updated" | "plan.completed" | "plan.removed" | "session.started" | "session.running" | "session.idle" | "session.terminated" | "session.error" | "system.notice" | "command_catalog.updated" | "capability.updated" | "usage.updated" | "callback.requested" | "callback.completed" | "callback.failed" | "callback.notification";
export type ToolStatus = "pending" | "in_progress" | "completed" | "failed" | "cancelled";
export type ToolOutputKind = "terminal" | "mcp" | "text" | "structured";
export interface ToolOutputData {
    kind: ToolOutputKind;
    data: unknown;
    /** True when this record extends rather than replaces prior visible output. */
    append?: boolean;
    separator?: string;
    terminal_id?: string;
}
export interface ToolTerminalData {
    terminal_id?: string;
    exit_code?: number | null;
    signal?: string | null;
}
export interface ToolLifecycleData {
    tool_call_id: string;
    title?: string;
    kind?: string;
    status?: ToolStatus;
    tool_name?: string;
    raw_input?: unknown;
    raw_output?: unknown;
    content?: unknown[];
    locations?: Array<{
        path?: string;
        line?: number;
    }>;
    output?: ToolOutputData;
    terminal?: ToolTerminalData;
    error?: string;
    reason?: string;
    /** Preserved adapter extension data after its known semantics are lifted. */
    adapter_meta?: Record<string, unknown>;
}
/** Harness-neutral message payload. `content` retains a structured
 * MCP-compatible block (text, image, audio, resource link, or embedded
 * resource) when no plain-text projection exists. Adapter metadata is
 * evidence only; GUI projections consume the standard content fields. */
export interface MessageEventData {
    text?: string;
    content?: unknown;
    message_id?: string;
    phase?: "commentary" | "final_answer";
    adapter_meta?: Record<string, unknown>;
}
export interface OpenMAEventEnvelope<TType extends string, TData> {
    schema_version: typeof OPENMA_EVENT_SCHEMA_VERSION;
    event_id: string;
    type: TType;
    session_id: string;
    session_thread_id?: string;
    turn_id?: string;
    work_item_id?: string;
    parent_event_id?: string;
    parent_id?: string;
    source: OpenMAEventSource;
    occurred_at: string;
    ingested_at?: string;
    seq?: number;
    data: TData;
    /** Known canonical events may retain the adapter's original wire record. */
    raw?: RawEventRecord;
}
export type OpenMACanonicalEvent = OpenMAEventEnvelope<CanonicalEventType, unknown>;
export type MessageEvent = OpenMAEventEnvelope<"user.message", MessageEventData> | OpenMAEventEnvelope<"agent.message", MessageEventData> | OpenMAEventEnvelope<"agent.message_chunk", MessageEventData> | OpenMAEventEnvelope<"agent.thinking", MessageEventData>;
export type ToolEvent = OpenMAEventEnvelope<"tool.started", ToolLifecycleData> | OpenMAEventEnvelope<"tool.progress", ToolLifecycleData> | OpenMAEventEnvelope<"tool.completed", ToolLifecycleData> | OpenMAEventEnvelope<"tool.failed", ToolLifecycleData> | OpenMAEventEnvelope<"tool.cancelled", ToolLifecycleData>;
export type CallbackCategory = "permission" | "filesystem" | "terminal" | "elicitation" | "mcp" | "extension";
/** An agent-to-host request/notification observed at the client boundary.
 * This records the input lifecycle without leaking ACP transport shapes into
 * GUI projections. `callback_id` correlates a request with its terminal fact. */
export interface CallbackLifecycleData {
    callback_id?: string;
    /** Stable within one session/turn and suitable for callback deduplication. */
    fingerprint?: string;
    method: string;
    category: CallbackCategory;
    params?: unknown;
    result?: unknown;
    error?: unknown;
}
export interface CallbackRequestedData extends CallbackLifecycleData {
    callback_id: string;
    fingerprint: string;
}
export type CallbackRequestedEvent = OpenMAEventEnvelope<"callback.requested", CallbackRequestedData>;
export type CallbackEvent = CallbackRequestedEvent | OpenMAEventEnvelope<"callback.completed", CallbackLifecycleData> | OpenMAEventEnvelope<"callback.failed", CallbackLifecycleData> | OpenMAEventEnvelope<"callback.notification", CallbackLifecycleData>;
export interface TurnTerminalData {
    stop_reason?: string;
    reason?: string;
    error?: string;
    usage?: unknown;
    adapter_meta?: Record<string, unknown>;
}
export type TurnTerminalEvent = OpenMAEventEnvelope<"turn.completed", TurnTerminalData> | OpenMAEventEnvelope<"turn.failed", TurnTerminalData> | OpenMAEventEnvelope<"turn.cancelled", TurnTerminalData> | OpenMAEventEnvelope<"turn.interrupted", TurnTerminalData>;
/** One event delivered by a long-lived external subscription. Monitor
 * notifications do not necessarily carry a stable subscription id, so
 * correlation remains optional on the envelope's `work_item_id`. */
export interface MonitorEventData {
    description: string;
    text: string;
    adapter_meta?: Record<string, unknown>;
}
export type MonitorEvent = OpenMAEventEnvelope<"monitor.event", MonitorEventData>;
export type VendorEvent = OpenMAEventEnvelope<"vendor.event", VendorEventRecord>;
export type RawEvent = OpenMAEventEnvelope<"raw.event", RawEventRecord>;
export type OpenMAEvent = OpenMACanonicalEvent | VendorEvent | RawEvent;
export interface CanonicalPlanEntry {
    id?: string;
    content: string;
    priority?: "high" | "medium" | "low" | string;
    status?: "pending" | "in_progress" | "completed" | "cancelled" | string;
    adapter_meta?: Record<string, unknown>;
}
export type PlanRepresentation = "items" | "markdown" | "file";
export interface PlanUpdatedData {
    representation: PlanRepresentation;
    plan_id?: string;
    /** Whether entries replace the current plan snapshot or merge into it by
     * stable entry id. Omitted values preserve ACP's replacement semantics. */
    update_mode?: "replace" | "merge";
    entries?: CanonicalPlanEntry[];
    document?: {
        id?: string;
        title?: string;
        markdown?: string;
        uri?: string;
    };
    adapter_meta?: Record<string, unknown>;
}
export interface PlanRemovedData {
    plan_id?: string;
    adapter_meta?: Record<string, unknown>;
}
export type PlanEvent = OpenMAEventEnvelope<"plan.updated", PlanUpdatedData> | OpenMAEventEnvelope<"plan.removed", PlanRemovedData>;
type OpenMAEventInput<TType extends string, TData> = Omit<OpenMAEventEnvelope<TType, TData>, "schema_version">;
export declare function createOpenMAEvent<TType extends string, TData>(input: OpenMAEventInput<TType, TData>): OpenMAEventEnvelope<TType, TData>;
export interface CreateVendorEventInput extends Omit<OpenMAEventInput<"vendor.event", VendorEventRecord>, "type" | "data"> {
    harness: string;
    namespace: string;
    name: string;
    version?: string;
    correlation?: VendorEventRecord["correlation"];
    data: unknown;
}
export declare function createVendorEvent(input: CreateVendorEventInput): VendorEvent;
export interface CreateRawEventInput extends Omit<OpenMAEventInput<"raw.event", RawEventRecord>, "type" | "data"> {
    source_kind: RawEventRecord["source"];
    method?: string;
    event_type?: string;
    payload: unknown;
    received_at?: string;
    reason: RawEventRecord["reason"];
}
export declare function createRawEvent(input: CreateRawEventInput): RawEvent;
export type WorkItemKind = "agent" | "bash" | "monitor" | "other";
export type WorkItemTerminalStatus = "completed" | "failed" | "cancelled" | "killed" | "terminated";
export type WorkItemStatus = "running" | WorkItemTerminalStatus | "unknown";
export interface WorkItemStartedData {
    kind: WorkItemKind;
    title?: string;
    command?: string;
    args?: string[];
    cwd?: string;
    can_stop?: boolean;
}
export interface WorkItemProgressData {
    progress?: number;
    output?: unknown;
}
export interface WorkItemOutputData {
    output: unknown;
}
export interface WorkItemTerminalIdentityData {
    /** Identity evidence carried by a terminal-only adapter observation. */
    kind?: WorkItemKind;
    title?: string;
}
export interface WorkItemCompletedData extends WorkItemTerminalIdentityData {
    result?: unknown;
}
export interface WorkItemFailureData extends WorkItemTerminalIdentityData {
    error?: string;
    reason?: string;
    result?: unknown;
}
export interface WorkItemMissingTerminalData {
    reason: string;
}
export interface WorkItemReidentifiedData {
    previous_work_item_id: string;
}
/** Refines a work item's semantic kind after stronger adapter evidence
 * arrives. This does not restart or otherwise alter its lifecycle. */
export interface WorkItemClassifiedData {
    kind: WorkItemKind;
}
export type WorkItemEvent = OpenMAEventEnvelope<"work_item.started", WorkItemStartedData> | OpenMAEventEnvelope<"work_item.progress", WorkItemProgressData> | OpenMAEventEnvelope<"work_item.output", WorkItemOutputData> | OpenMAEventEnvelope<"work_item.completed", WorkItemCompletedData> | OpenMAEventEnvelope<"work_item.failed", WorkItemFailureData> | OpenMAEventEnvelope<"work_item.cancelled", WorkItemFailureData> | OpenMAEventEnvelope<"work_item.killed", WorkItemFailureData> | OpenMAEventEnvelope<"work_item.terminated", WorkItemFailureData> | OpenMAEventEnvelope<"work_item.missing_terminal", WorkItemMissingTerminalData> | OpenMAEventEnvelope<"work_item.reidentified", WorkItemReidentifiedData> | OpenMAEventEnvelope<"work_item.classified", WorkItemClassifiedData>;
export interface WorkItemSnapshot {
    id: string;
    kind: WorkItemKind;
    status: WorkItemStatus;
    title?: string;
    progress?: number;
    output: unknown[];
    result?: unknown;
    error?: string;
    reason?: string;
    started_at?: string;
    ended_at?: string;
    missing_start?: boolean;
    missing_terminal?: boolean;
}
export interface WorkItemRegistry {
    items: Map<string, WorkItemSnapshot>;
    seen_event_ids: Set<string>;
}
export declare function reduceWorkItems(events: readonly OpenMAEvent[]): WorkItemRegistry;
export declare function finalizeWorkItems(registry: WorkItemRegistry): WorkItemRegistry;
export {};
//# sourceMappingURL=openma.d.ts.map