/**
 * OpenMA's harness-neutral event contract.
 *
 * ACP and vendor adapters translate their wire payloads into this envelope.
 * The renderer may project these events into UI state, but must not turn the
 * projection into a second event vocabulary.
 */
export const OPENMA_EVENT_SCHEMA_VERSION = "oma.event.v1";
/** Validate, clone, and recursively freeze one portable JSON value.
 * Unlike a JSON stringify/parse round trip, this rejects values that would be
 * silently omitted or coerced. Published facts therefore preserve exactly the
 * data the adapter supplied. */
export function immutableJson(value) {
    return cloneJson(value, "$", new WeakSet());
}
function cloneJson(value, path, ancestors) {
    if (value === null || typeof value === "string" || typeof value === "boolean") {
        return value;
    }
    if (typeof value === "number") {
        if (!Number.isFinite(value))
            invalidJson(path, "number must be finite");
        return value;
    }
    if (typeof value !== "object") {
        invalidJson(path, `${typeof value} is not a JSON value`);
    }
    if (ancestors.has(value))
        invalidJson(path, "cyclic reference");
    ancestors.add(value);
    try {
        if (Array.isArray(value))
            return cloneJsonArray(value, path, ancestors);
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            invalidJson(path, "object must have a plain or null prototype");
        }
        const clone = {};
        for (const key of Reflect.ownKeys(value)) {
            if (typeof key === "symbol")
                invalidJson(path, "symbol keys are not JSON");
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
    }
    finally {
        ancestors.delete(value);
    }
}
function cloneJsonArray(value, path, ancestors) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
        invalidJson(path, "array must use the standard Array prototype");
    }
    const allowedKeys = new Set(["length"]);
    const clone = [];
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
function invalidJson(path, reason) {
    throw new TypeError(`Invalid JSON at ${path}: ${reason}`);
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
    "turn.steered",
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
    "user.message_chunk",
    "user.fs_write_response",
    "session.updated",
    "session.rescheduled",
    "system.message",
    "outcome.defined",
    "outcome.evaluation_started",
    "outcome.evaluation_progress",
    "outcome.evaluation_completed",
];
export const OPENMA_EVENT_TYPES = [
    ...OPENMA_CANONICAL_EVENT_TYPES,
    "vendor.event",
    "raw.event",
];
const EVENT_TYPES = new Set(OPENMA_EVENT_TYPES);
const SOURCE_KINDS = new Set(["harness", "openma", "user", "system"]);
const RAW_SOURCES = new Set(["acp", "adapter", "transport"]);
const RAW_REASONS = new Set(["unknown", "unsupported", "malformed"]);
function recordValue(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value
        : undefined;
}
function optionalString(value) {
    return value === undefined || typeof value === "string";
}
function validSource(value) {
    const source = recordValue(value);
    return source !== undefined
        && typeof source.kind === "string"
        && SOURCE_KINDS.has(source.kind)
        && optionalString(source.harness)
        && optionalString(source.adapter);
}
function validRawRecord(value) {
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
function validVendorRecord(value) {
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
export function isOpenMAEvent(input) {
    try {
        const event = recordValue(immutableJson(input));
        if (event === undefined
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
                && (!Number.isSafeInteger(event.seq) || event.seq < 0))
            || !Object.hasOwn(event, "data")
            || (event.raw !== undefined && !validRawRecord(event.raw)))
            return false;
        if (event.type === "raw.event")
            return validRawRecord(event.data);
        if (event.type === "vendor.event")
            return validVendorRecord(event.data);
        return true;
    }
    catch {
        return false;
    }
}
export function createOpenMAEvent(input) {
    return {
        schema: OPENMA_EVENT_SCHEMA_VERSION,
        schema_version: OPENMA_EVENT_SCHEMA_VERSION,
        ...input,
    };
}
export function createVendorEvent(input) {
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
export function createRawEvent(input) {
    const { source_kind, method, event_type, payload, received_at, reason, ...envelope } = input;
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
export function createWorkItemRegistry() {
    return { items: new Map(), seen_event_ids: new Set() };
}
function isWorkItemEvent(event) {
    return event.type.startsWith("work_item.") && typeof event.work_item_id === "string";
}
function isTerminal(status) {
    return status !== "running" && status !== "unknown";
}
function cloneRegistry(registry) {
    return {
        items: new Map([...registry.items].map(([id, item]) => [id, { ...item, output: [...item.output] }])),
        seen_event_ids: new Set(registry.seen_event_ids),
    };
}
function getOrCreateItem(items, id, kind = "other") {
    const existing = items.get(id);
    if (existing)
        return existing;
    const created = {
        id,
        kind,
        status: "unknown",
        output: [],
        missing_start: true,
    };
    items.set(id, created);
    return created;
}
function applyWorkItemEvent(items, event) {
    const id = event.work_item_id;
    if (!id)
        return;
    const data = event.data;
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
        if (existing)
            existing.kind = data.kind;
        return;
    }
    const item = getOrCreateItem(items, id, event.type === "work_item.started" ? data.kind : undefined);
    if (isTerminal(item.status) && event.type !== `work_item.${item.status}`)
        return;
    switch (event.type) {
        case "work_item.started":
            if (isTerminal(item.status))
                return;
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
            if (typeof data.progress === "number")
                item.progress = data.progress;
            if (data.output !== undefined)
                item.output.push(data.output);
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
            if (data.title)
                item.title = data.title;
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
            if (data.title)
                item.title = data.title;
            item.status = event.type.slice("work_item.".length);
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
export function reduceWorkItemEvent(registry, event) {
    if (registry.seen_event_ids.has(event.event_id))
        return registry;
    const next = cloneRegistry(registry);
    next.seen_event_ids.add(event.event_id);
    if (isWorkItemEvent(event))
        applyWorkItemEvent(next.items, event);
    return next;
}
/** Sequenced events in `seq` order, then unsequenced events in arrival order. */
function orderWorkItemEvents(events) {
    return events.map((event, index) => ({ event, index })).sort((a, b) => {
        if (a.event.seq === undefined && b.event.seq === undefined)
            return a.index - b.index;
        if (a.event.seq === undefined)
            return 1;
        if (b.event.seq === undefined)
            return -1;
        return a.event.seq - b.event.seq || a.index - b.index;
    }).map(({ event }) => event);
}
/** Ids whose snapshots an event may change; copied before mutation so
 * previously returned snapshots stay immutable. */
function touchedWorkItemIds(event) {
    const ids = event.work_item_id ? [event.work_item_id] : [];
    if (event.type !== "work_item.reidentified")
        return ids;
    return [event.data.previous_work_item_id, ...ids];
}
/** Linear-time reduction. One working registry is mutated in place; the
 * input events are never mutated. */
export function reduceWorkItems(events) {
    const registry = createWorkItemRegistry();
    for (const event of orderWorkItemEvents(events)) {
        if (registry.seen_event_ids.has(event.event_id))
            continue;
        registry.seen_event_ids.add(event.event_id);
        if (isWorkItemEvent(event))
            applyWorkItemEvent(registry.items, event);
    }
    return registry;
}
/** Incremental equivalent of `reduceWorkItems`: constant work per in-order
 * event. Events that arrive out of `seq` order (for example an older history
 * page) mark the projection dirty; the next `snapshot()` re-reduces once, so a
 * whole prepended page costs one O(n) pass. The result always equals
 * `reduceWorkItems(allEvents)`. */
export function createWorkItemProjector() {
    const received = [];
    const receivedIds = new Set();
    let items = new Map();
    let seen = new Set();
    let maxSeq;
    let sawUnsequenced = false;
    let dirty = false;
    let version = 0;
    let snapshotVersion = -1;
    let current = createWorkItemRegistry();
    const applyInOrder = (event) => {
        seen.add(event.event_id);
        if (!isWorkItemEvent(event))
            return false;
        for (const id of touchedWorkItemIds(event)) {
            const item = items.get(id);
            if (item)
                items.set(id, { ...item, output: [...item.output] });
        }
        applyWorkItemEvent(items, event);
        return true;
    };
    return {
        apply(event) {
            // A replayed event id is the same event; it can never change the result.
            if (receivedIds.has(event.event_id))
                return false;
            receivedIds.add(event.event_id);
            received.push(event);
            const inOrder = event.seq === undefined
                ? true
                : !sawUnsequenced && (maxSeq === undefined || event.seq >= maxSeq);
            if (event.seq === undefined)
                sawUnsequenced = true;
            else
                maxSeq = maxSeq === undefined ? event.seq : Math.max(maxSeq, event.seq);
            if (dirty)
                return isWorkItemEvent(event);
            if (!inOrder) {
                dirty = true;
                return true;
            }
            if (!applyInOrder(event))
                return false;
            version += 1;
            return true;
        },
        snapshot() {
            if (dirty) {
                const registry = reduceWorkItems(received);
                items = registry.items;
                seen = registry.seen_event_ids;
                dirty = false;
                version += 1;
            }
            if (snapshotVersion !== version) {
                current = { items: new Map(items), seen_event_ids: seen };
                snapshotVersion = version;
            }
            return current;
        },
    };
}
export function finalizeWorkItems(registry) {
    const finalized = cloneRegistry(registry);
    for (const [id, item] of finalized.items) {
        if (isTerminal(item.status))
            continue;
        finalized.items.set(id, {
            ...item,
            status: "unknown",
            missing_terminal: true,
        });
    }
    return finalized;
}
/** True when an OpenMA event represents CMA-style queued delivery.
 * Prefer this over reading any harness `processed_at` field. */
export function isOpenMAQueuedEvent(event) {
    if (!event || typeof event !== "object")
        return false;
    if (event.type === "turn.queued")
        return true;
    const data = event.data;
    return data?.delivery === "queued";
}
//# sourceMappingURL=openma.js.map