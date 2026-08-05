/**
 * OpenMA's harness-neutral event contract.
 *
 * ACP and vendor adapters translate their wire payloads into this envelope.
 * The renderer may project these events into UI state, but must not turn the
 * projection into a second event vocabulary.
 */
export const OPENMA_EVENT_SCHEMA_VERSION = "oma.event.v1";
export function createOpenMAEvent(input) {
    return { schema_version: OPENMA_EVENT_SCHEMA_VERSION, ...input };
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
export function reduceWorkItems(events) {
    const registry = { items: new Map(), seen_event_ids: new Set() };
    const ordered = events.map((event, index) => ({ event, index })).sort((a, b) => {
        if (a.event.seq === undefined && b.event.seq === undefined)
            return a.index - b.index;
        if (a.event.seq === undefined)
            return 1;
        if (b.event.seq === undefined)
            return -1;
        return a.event.seq - b.event.seq || a.index - b.index;
    });
    for (const { event } of ordered) {
        if (registry.seen_event_ids.has(event.event_id))
            continue;
        registry.seen_event_ids.add(event.event_id);
        if (isWorkItemEvent(event))
            applyWorkItemEvent(registry.items, event);
    }
    return registry;
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
//# sourceMappingURL=openma.js.map