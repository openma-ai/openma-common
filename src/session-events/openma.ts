/**
 * OpenMA's harness-neutral event contract.
 *
 * ACP and vendor adapters translate their wire payloads into this envelope.
 * The renderer may project these events into UI state, but must not turn the
 * projection into a second event vocabulary.
 */

export const OPENMA_EVENT_SCHEMA_VERSION = "oma.event.v1" as const;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
  readonly [key: string]: JsonValue;
}
export interface JsonArray extends ReadonlyArray<JsonValue> {}

export type DeepReadonly<T> =
  T extends JsonPrimitive ? T
    : T extends readonly (infer U)[] ? readonly DeepReadonly<U>[]
      : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
        : T;

/** Validate, clone, and recursively freeze one portable JSON value.
 * Unlike a JSON stringify/parse round trip, this rejects values that would be
 * silently omitted or coerced. Published facts therefore preserve exactly the
 * data the adapter supplied. */
export function immutableJson<T>(value: T): DeepReadonly<T> {
  return cloneJson(value, "$", new WeakSet()) as DeepReadonly<T>;
}

function cloneJson(
  value: unknown,
  path: string,
  ancestors: WeakSet<object>,
): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalidJson(path, "number must be finite");
    return value;
  }
  if (typeof value !== "object") {
    invalidJson(path, `${typeof value} is not a JSON value`);
  }
  if (ancestors.has(value)) invalidJson(path, "cyclic reference");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return cloneJsonArray(value, path, ancestors);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      invalidJson(path, "object must have a plain or null prototype");
    }
    const clone: Record<string, JsonValue> = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === "symbol") invalidJson(path, "symbol keys are not JSON");
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        invalidJson(`${path}.${key}`, "property must be enumerable data");
      }
      Object.defineProperty(clone, key, {
        value: cloneJson(descriptor.value, `${path}.${key}`, ancestors),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return Object.freeze(clone);
  } finally {
    ancestors.delete(value);
  }
}

function cloneJsonArray(
  value: unknown[],
  path: string,
  ancestors: WeakSet<object>,
): JsonArray {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    invalidJson(path, "array must use the standard Array prototype");
  }
  const allowedKeys = new Set<string>(["length"]);
  const clone: JsonValue[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      invalidJson(`${path}[${index}]`, "sparse arrays are not JSON facts");
    }
    const key = String(index);
    allowedKeys.add(key);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      invalidJson(`${path}[${index}]`, "array item must be enumerable data");
    }
    clone.push(cloneJson(descriptor.value, `${path}[${index}]`, ancestors));
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol" || !allowedKeys.has(key)) {
      invalidJson(path, "array has a non-JSON property");
    }
  }
  return Object.freeze(clone);
}

function invalidJson(path: string, reason: string): never {
  throw new TypeError(`Invalid JSON at ${path}: ${reason}`);
}

export type OpenMAEventSourceKind = "harness" | "openma" | "user" | "system";

export interface OpenMAEventSource {
  readonly kind: OpenMAEventSourceKind;
  readonly harness?: string;
  readonly adapter?: string;
}

export interface RawEventRecord {
  readonly kind: "raw";
  readonly source: "acp" | "adapter" | "transport";
  readonly method?: string;
  readonly event_type?: string;
  readonly payload: unknown;
  readonly received_at: string;
  readonly reason: "unknown" | "unsupported" | "malformed";
}

export interface VendorEventRecord {
  readonly kind: "vendor";
  readonly harness: string;
  readonly namespace: string;
  readonly name: string;
  readonly version?: string;
  readonly correlation?: {
    readonly session_id?: string;
    readonly turn_id?: string;
    readonly work_item_id?: string;
    readonly parent_id?: string;
  };
  readonly data: unknown;
}

export const OPENMA_CANONICAL_EVENT_TYPES = [
  "user.message",
  "user.interrupt",
  "user.permission_response",
  "user.elicitation_response",
  "agent.message",
  "agent.message_chunk",
  "agent.thinking",
  "turn.queued",
  "turn.started",
  "turn.completed",
  "turn.failed",
  "turn.cancelled",
  "turn.interrupted",
  "tool.started",
  "tool.progress",
  "tool.completed",
  "tool.failed",
  "tool.cancelled",
  "work_item.started",
  "work_item.progress",
  "work_item.output",
  "work_item.completed",
  "work_item.failed",
  "work_item.cancelled",
  "work_item.killed",
  "work_item.terminated",
  "work_item.missing_terminal",
  "work_item.reidentified",
  "work_item.classified",
  "monitor.event",
  "plan.updated",
  "plan.completed",
  "plan.removed",
  "session.started",
  "session.running",
  "session.idle",
  "session.terminated",
  "session.error",
  "system.notice",
  "command_catalog.updated",
  "capability.updated",
  "usage.updated",
  "callback.requested",
  "callback.completed",
  "callback.failed",
  "callback.notification",
] as const;

export type CanonicalEventType =
  (typeof OPENMA_CANONICAL_EVENT_TYPES)[number];

export const OPENMA_EVENT_TYPES = [
  ...OPENMA_CANONICAL_EVENT_TYPES,
  "vendor.event",
  "raw.event",
] as const;

export type ToolStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled";
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
  locations?: Array<{ path?: string; line?: number }>;
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
  readonly schema_version: typeof OPENMA_EVENT_SCHEMA_VERSION;
  readonly event_id: string;
  readonly type: TType;
  readonly session_id: string;
  readonly session_thread_id?: string;
  readonly turn_id?: string;
  readonly work_item_id?: string;
  readonly parent_event_id?: string;
  readonly parent_id?: string;
  readonly source: DeepReadonly<OpenMAEventSource>;
  readonly occurred_at: string;
  readonly ingested_at?: string;
  readonly seq?: number;
  readonly data: DeepReadonly<TData>;
  /** Known canonical events may retain the adapter's original wire record. */
  readonly raw?: DeepReadonly<RawEventRecord>;
}

export type OpenMACanonicalEvent = OpenMAEventEnvelope<CanonicalEventType, unknown>;
export type MessageEvent =
  | OpenMAEventEnvelope<"user.message", MessageEventData>
  | OpenMAEventEnvelope<"agent.message", MessageEventData>
  | OpenMAEventEnvelope<"agent.message_chunk", MessageEventData>
  | OpenMAEventEnvelope<"agent.thinking", MessageEventData>;
export type ToolEvent =
  | OpenMAEventEnvelope<"tool.started", ToolLifecycleData>
  | OpenMAEventEnvelope<"tool.progress", ToolLifecycleData>
  | OpenMAEventEnvelope<"tool.completed", ToolLifecycleData>
  | OpenMAEventEnvelope<"tool.failed", ToolLifecycleData>
  | OpenMAEventEnvelope<"tool.cancelled", ToolLifecycleData>;

export type CallbackCategory =
  | "permission"
  | "filesystem"
  | "terminal"
  | "elicitation"
  | "mcp"
  | "extension";

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

export type CallbackRequestedEvent = OpenMAEventEnvelope<
  "callback.requested",
  CallbackRequestedData
>;

export type CallbackEvent =
  | CallbackRequestedEvent
  | OpenMAEventEnvelope<"callback.completed", CallbackLifecycleData>
  | OpenMAEventEnvelope<"callback.failed", CallbackLifecycleData>
  | OpenMAEventEnvelope<"callback.notification", CallbackLifecycleData>;

export interface TurnTerminalData {
  stop_reason?: string;
  reason?: string;
  error?: string;
  usage?: unknown;
  adapter_meta?: Record<string, unknown>;
}

export type TurnTerminalEvent =
  | OpenMAEventEnvelope<"turn.completed", TurnTerminalData>
  | OpenMAEventEnvelope<"turn.failed", TurnTerminalData>
  | OpenMAEventEnvelope<"turn.cancelled", TurnTerminalData>
  | OpenMAEventEnvelope<"turn.interrupted", TurnTerminalData>;

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

const EVENT_TYPES = new Set<string>(OPENMA_EVENT_TYPES);
const SOURCE_KINDS = new Set<string>(["harness", "openma", "user", "system"]);
const RAW_SOURCES = new Set<string>(["acp", "adapter", "transport"]);
const RAW_REASONS = new Set<string>(["unknown", "unsupported", "malformed"]);

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function validSource(value: unknown): boolean {
  const source = recordValue(value);
  return source !== undefined
    && typeof source.kind === "string"
    && SOURCE_KINDS.has(source.kind)
    && optionalString(source.harness)
    && optionalString(source.adapter);
}

function validRawRecord(value: unknown): boolean {
  const raw = recordValue(value);
  return raw !== undefined
    && raw.kind === "raw"
    && typeof raw.source === "string"
    && RAW_SOURCES.has(raw.source)
    && optionalString(raw.method)
    && optionalString(raw.event_type)
    && Object.hasOwn(raw, "payload")
    && typeof raw.received_at === "string"
    && typeof raw.reason === "string"
    && RAW_REASONS.has(raw.reason);
}

function validVendorRecord(value: unknown): boolean {
  const vendor = recordValue(value);
  const correlation = vendor?.correlation === undefined
    ? undefined
    : recordValue(vendor.correlation);
  return vendor !== undefined
    && vendor.kind === "vendor"
    && typeof vendor.harness === "string"
    && typeof vendor.namespace === "string"
    && typeof vendor.name === "string"
    && optionalString(vendor.version)
    && (vendor.correlation === undefined
      || (correlation !== undefined
        && optionalString(correlation.session_id)
        && optionalString(correlation.turn_id)
        && optionalString(correlation.work_item_id)
        && optionalString(correlation.parent_id)))
    && Object.hasOwn(vendor, "data");
}

/** The single runtime validator for Agent/UI/Store consumers. It accepts only
 * the published event vocabulary and strict portable JSON facts. */
export function isOpenMAEvent(input: unknown): input is OpenMAEvent {
  try {
    const event = recordValue(immutableJson(input));
    if (
      event === undefined
      || event.schema_version !== OPENMA_EVENT_SCHEMA_VERSION
      || typeof event.event_id !== "string"
      || event.event_id.length === 0
      || typeof event.type !== "string"
      || !EVENT_TYPES.has(event.type)
      || typeof event.session_id !== "string"
      || event.session_id.length === 0
      || !optionalString(event.session_thread_id)
      || !optionalString(event.turn_id)
      || !optionalString(event.work_item_id)
      || !optionalString(event.parent_event_id)
      || !optionalString(event.parent_id)
      || !validSource(event.source)
      || typeof event.occurred_at !== "string"
      || event.occurred_at.length === 0
      || !optionalString(event.ingested_at)
      || (event.seq !== undefined
        && (!Number.isSafeInteger(event.seq) || (event.seq as number) < 0))
      || !Object.hasOwn(event, "data")
      || (event.raw !== undefined && !validRawRecord(event.raw))
    ) return false;
    if (event.type === "raw.event") return validRawRecord(event.data);
    if (event.type === "vendor.event") return validVendorRecord(event.data);
    return true;
  } catch {
    return false;
  }
}

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

export type PlanEvent =
  | OpenMAEventEnvelope<"plan.updated", PlanUpdatedData>
  | OpenMAEventEnvelope<"plan.removed", PlanRemovedData>;

type OpenMAEventInput<TType extends string, TData> = Omit<
  OpenMAEventEnvelope<TType, TData>,
  "schema_version" | "source" | "data" | "raw"
> & {
  readonly source: OpenMAEventSource;
  readonly data: TData;
  readonly raw?: RawEventRecord;
};

export function createOpenMAEvent<TType extends string, TData>(
  input: OpenMAEventInput<TType, TData>,
): OpenMAEventEnvelope<TType, TData> {
  return immutableJson({
    schema_version: OPENMA_EVENT_SCHEMA_VERSION,
    ...input,
  }) as OpenMAEventEnvelope<TType, TData>;
}

export interface CreateVendorEventInput
  extends Omit<OpenMAEventInput<"vendor.event", VendorEventRecord>, "type" | "data"> {
  harness: string;
  namespace: string;
  name: string;
  version?: string;
  correlation?: VendorEventRecord["correlation"];
  data: unknown;
}

export function createVendorEvent(input: CreateVendorEventInput): VendorEvent {
  const { harness, namespace, name, version, correlation, data, ...envelope } = input;
  return createOpenMAEvent({
    ...envelope,
    type: "vendor.event",
    data: {
      kind: "vendor",
      harness,
      namespace,
      name,
      ...(version ? { version } : {}),
      ...(correlation ? { correlation } : {}),
      data,
    },
  });
}

export interface CreateRawEventInput
  extends Omit<OpenMAEventInput<"raw.event", RawEventRecord>, "type" | "data"> {
  source_kind: RawEventRecord["source"];
  method?: string;
  event_type?: string;
  payload: unknown;
  received_at?: string;
  reason: RawEventRecord["reason"];
}

export function createRawEvent(input: CreateRawEventInput): RawEvent {
  const {
    source_kind,
    method,
    event_type,
    payload,
    received_at,
    reason,
    ...envelope
  } = input;
  return createOpenMAEvent({
    ...envelope,
    type: "raw.event",
    data: {
      kind: "raw",
      source: source_kind,
      ...(method ? { method } : {}),
      ...(event_type ? { event_type } : {}),
      payload,
      received_at: received_at ?? input.occurred_at,
      reason,
    },
  });
}

export type WorkItemKind = "agent" | "bash" | "monitor" | "other";
export type WorkItemTerminalStatus =
  | "completed"
  | "failed"
  | "cancelled"
  | "killed"
  | "terminated";
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

export type WorkItemEvent =
  | OpenMAEventEnvelope<"work_item.started", WorkItemStartedData>
  | OpenMAEventEnvelope<"work_item.progress", WorkItemProgressData>
  | OpenMAEventEnvelope<"work_item.output", WorkItemOutputData>
  | OpenMAEventEnvelope<"work_item.completed", WorkItemCompletedData>
  | OpenMAEventEnvelope<"work_item.failed", WorkItemFailureData>
  | OpenMAEventEnvelope<"work_item.cancelled", WorkItemFailureData>
  | OpenMAEventEnvelope<"work_item.killed", WorkItemFailureData>
  | OpenMAEventEnvelope<"work_item.terminated", WorkItemFailureData>
  | OpenMAEventEnvelope<"work_item.missing_terminal", WorkItemMissingTerminalData>
  | OpenMAEventEnvelope<"work_item.reidentified", WorkItemReidentifiedData>
  | OpenMAEventEnvelope<"work_item.classified", WorkItemClassifiedData>;

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

function isWorkItemEvent(event: OpenMAEvent): event is WorkItemEvent {
  return event.type.startsWith("work_item.") && typeof event.work_item_id === "string";
}

function isTerminal(status: WorkItemStatus): status is WorkItemTerminalStatus {
  return status !== "running" && status !== "unknown";
}

function cloneRegistry(registry: WorkItemRegistry): WorkItemRegistry {
  return {
    items: new Map([...registry.items].map(([id, item]) => [id, { ...item, output: [...item.output] }])),
    seen_event_ids: new Set(registry.seen_event_ids),
  };
}

function getOrCreateItem(
  items: Map<string, WorkItemSnapshot>,
  id: string,
  kind: WorkItemKind = "other",
): WorkItemSnapshot {
  const existing = items.get(id);
  if (existing) return existing;
  const created: WorkItemSnapshot = {
    id,
    kind,
    status: "unknown",
    output: [],
    missing_start: true,
  };
  items.set(id, created);
  return created;
}

function applyWorkItemEvent(items: Map<string, WorkItemSnapshot>, event: WorkItemEvent): void {
  const id = event.work_item_id;
  if (!id) return;
  const data = event.data as WorkItemStartedData & WorkItemProgressData & WorkItemOutputData & WorkItemCompletedData & WorkItemFailureData & WorkItemMissingTerminalData & WorkItemReidentifiedData & WorkItemClassifiedData;
  if (event.type === "work_item.reidentified") {
    const previous = items.get(data.previous_work_item_id);
    const current = items.get(id);
    if (!previous) {
      getOrCreateItem(items, id);
      return;
    }
    items.delete(data.previous_work_item_id);
    items.set(id, current
      ? {
          ...previous,
          ...current,
          id,
          kind: current.kind === "other" ? previous.kind : current.kind,
          output: [...previous.output, ...current.output],
        }
      : { ...previous, id, output: [...previous.output] });
    return;
  }
  if (event.type === "work_item.classified") {
    const existing = items.get(id);
    if (existing) existing.kind = data.kind;
    return;
  }
  const item = getOrCreateItem(items, id, event.type === "work_item.started" ? data.kind : undefined);
  if (isTerminal(item.status) && event.type !== `work_item.${item.status}`) return;

  switch (event.type) {
    case "work_item.started":
      if (isTerminal(item.status)) return;
      if (item.kind === "other" || data.kind !== "other") {
        item.kind = data.kind;
      }
      item.title = data.title;
      item.status = "running";
      item.started_at = event.occurred_at;
      item.missing_start = undefined;
      item.missing_terminal = undefined;
      item.reason = undefined;
      return;
    case "work_item.progress":
      if (typeof data.progress === "number") item.progress = data.progress;
      if (data.output !== undefined) item.output.push(data.output);
      return;
    case "work_item.output":
      item.output.push(data.output);
      return;
    case "work_item.completed":
      // A terminal-only adapter update may carry the generic `other` kind
      // because it cannot re-identify the already-started item. Preserve a
      // richer kind learned from the start event instead of downgrading a
      // Bash/agent item to `other`.
      if (data.kind && (item.kind === "other" || data.kind !== "other")) {
        item.kind = data.kind;
      }
      if (data.title) item.title = data.title;
      item.status = "completed";
      item.result = data.result;
      item.ended_at = event.occurred_at;
      item.missing_terminal = undefined;
      return;
    case "work_item.failed":
    case "work_item.cancelled":
    case "work_item.killed":
    case "work_item.terminated":
      if (data.kind && (item.kind === "other" || data.kind !== "other")) {
        item.kind = data.kind;
      }
      if (data.title) item.title = data.title;
      item.status = event.type.slice("work_item.".length) as WorkItemTerminalStatus;
      item.error = data.error;
      item.reason = data.reason;
      item.result = data.result;
      item.ended_at = event.occurred_at;
      item.missing_terminal = undefined;
      return;
    case "work_item.missing_terminal":
      item.status = "unknown";
      item.reason = data.reason;
      item.missing_terminal = true;
      return;
  }
}

export function reduceWorkItems(events: readonly OpenMAEvent[]): WorkItemRegistry {
  const registry: WorkItemRegistry = { items: new Map(), seen_event_ids: new Set() };
  const ordered = events.map((event, index) => ({ event, index })).sort((a, b) => {
    if (a.event.seq === undefined && b.event.seq === undefined) return a.index - b.index;
    if (a.event.seq === undefined) return 1;
    if (b.event.seq === undefined) return -1;
    return a.event.seq - b.event.seq || a.index - b.index;
  });

  for (const { event } of ordered) {
    if (registry.seen_event_ids.has(event.event_id)) continue;
    registry.seen_event_ids.add(event.event_id);
    if (isWorkItemEvent(event)) applyWorkItemEvent(registry.items, event);
  }
  return registry;
}

export function finalizeWorkItems(registry: WorkItemRegistry): WorkItemRegistry {
  const finalized = cloneRegistry(registry);
  for (const [id, item] of finalized.items) {
    if (isTerminal(item.status)) continue;
    finalized.items.set(id, {
      ...item,
      status: "unknown",
      missing_terminal: true,
    });
  }
  return finalized;
}
