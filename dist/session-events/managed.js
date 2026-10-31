import { latestThoughtSegment, } from "./acp.js";
function stringField(event, ...names) {
    for (const name of names) {
        const value = event[name];
        if (typeof value === "string" && value.length > 0)
            return value;
    }
    return undefined;
}
export function eventText(content) {
    if (typeof content === "string")
        return content;
    if (!Array.isArray(content))
        return "";
    return content
        .map((block) => {
        if (!block || typeof block !== "object")
            return "";
        const value = block.text;
        return typeof value === "string" ? value : "";
    })
        .filter(Boolean)
        .join("\n");
}
export function eventThreadId(event) {
    return stringField(event, "session_thread_id") ?? "sthr_primary";
}
export function eventStableId(event, fallback) {
    return stringField(event, "id", "event_id", "message_id", "thinking_id", "tool_use_id", "mcp_tool_use_id") ?? fallback;
}
function openmaData(event) {
    const data = event.data;
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
}
function dataString(data, name) {
    const value = data[name];
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
function idleStopReason(event) {
    const data = openmaData(event);
    const raw = event.stop_reason ?? data.stop_reason;
    if (typeof raw === "string")
        return { stopReason: raw };
    if (!raw || typeof raw !== "object")
        return {};
    const record = raw;
    const stopReason = typeof record.type === "string" ? record.type : undefined;
    const ids = Array.isArray(record.event_ids)
        ? record.event_ids.filter((id) => typeof id === "string" && id.length > 0)
        : undefined;
    return {
        ...(stopReason ? { stopReason } : {}),
        ...(ids && ids.length > 0 ? { awaitingEventIds: ids } : {}),
    };
}
function isIdleEvent(event) {
    return event.type === "session.status_idle" || event.type === "session.idle";
}
function isTerminalStatusEvent(event) {
    return isIdleEvent(event) || event.type === "session.status_terminated" || event.type === "session.terminated";
}
function eventSeq(event) {
    const value = event.seq ?? openmaData(event).seq;
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function eventTimeKey(event) {
    const value = event.processed_at ?? event.occurred_at ?? event.ts ?? event.created_at;
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
/** Causal order for projection.
 *
 * When every event carries a numeric `seq` (OpenMA event log order), sort by
 * it. Otherwise keep list order but, within a run of adjacent events sharing
 * the same millisecond timestamp, move idle/terminated status events after
 * the other events of that millisecond: the server writes the closing tool
 * result / message / interrupt and the idle in the same ms, and a
 * `(processed_at, id)` list order can put the idle first. */
export function orderSessionEventsCausally(events) {
    if (events.length > 0 && events.every((event) => eventSeq(event) !== undefined)) {
        return events
            .map((event, index) => ({ event, index }))
            .sort((a, b) => (eventSeq(a.event) - eventSeq(b.event)) || (a.index - b.index))
            .map(({ event }) => event);
    }
    const out = [];
    let index = 0;
    while (index < events.length) {
        const key = eventTimeKey(events[index]);
        let end = index + 1;
        if (key !== undefined) {
            while (end < events.length && eventTimeKey(events[end]) === key)
                end += 1;
        }
        const run = events.slice(index, end);
        if (run.length > 1) {
            out.push(...run.filter((event) => !isTerminalStatusEvent(event)));
            out.push(...run.filter((event) => isTerminalStatusEvent(event)));
        }
        else {
            out.push(...run);
        }
        index = end;
    }
    return out;
}
function toolFamily(type) {
    if (type.includes("mcp_"))
        return "mcp";
    if (type.includes("custom_"))
        return "custom";
    return "builtin";
}
export function normalizeSessionEvent(event) {
    switch (event.type) {
        case "turn.queued":
        case "user.message": {
            const data = (event.data && typeof event.data === "object")
                ? event.data
                : undefined;
            const content = event.content ?? data?.content;
            const text = eventText(content) || (typeof data?.text === "string" ? data.text : "") || stringField(event, "text") || "";
            return {
                kind: "user_message",
                id: eventStableId(event, "user-message"),
                text,
                raw: event,
            };
        }
        case "agent.message_chunk":
            return {
                kind: "assistant_delta",
                id: stringField(event, "message_id", "id") ?? "assistant-stream",
                text: stringField(event, "delta") ?? "",
                raw: event,
            };
        case "agent.message":
            return {
                kind: "assistant_message",
                id: stringField(event, "message_id", "id") ?? "assistant-message",
                text: eventText(event.content),
                raw: event,
            };
        case "agent.message_stream_end":
            return { kind: "assistant_stream_end", id: stringField(event, "message_id", "id"), raw: event };
        case "agent.thinking_chunk":
            return {
                kind: "thinking_delta",
                id: stringField(event, "thinking_id", "id") ?? "thinking-stream",
                text: stringField(event, "delta") ?? "",
                raw: event,
            };
        case "agent.thinking":
            return {
                kind: "thinking",
                id: stringField(event, "thinking_id", "id") ?? "thinking",
                text: eventText(event.content) || stringField(event, "text", "delta") || "",
                raw: event,
            };
        case "agent.thinking_stream_end":
            return { kind: "thinking_stream_end", id: stringField(event, "thinking_id", "id"), raw: event };
        case "agent.tool_use_input_stream_start":
            return {
                kind: "tool_input_start",
                toolId: stringField(event, "tool_use_id", "id") ?? "tool-input",
                name: stringField(event, "tool_name", "name") ?? "tool",
                raw: event,
            };
        case "agent.tool_use":
        case "agent.custom_tool_use":
        case "agent.mcp_tool_use": {
            const id = stringField(event, "id", "tool_use_id", "mcp_tool_use_id") ?? "tool";
            return {
                kind: "tool_use",
                tool: {
                    id,
                    family: toolFamily(event.type),
                    name: stringField(event, "name", "tool_name") ?? "tool",
                    input: event.input,
                    status: "running",
                    rawUse: event,
                },
                raw: event,
            };
        }
        case "agent.tool_result":
        case "agent.mcp_tool_result":
            return {
                kind: "tool_result",
                toolId: stringField(event, "tool_use_id", "mcp_tool_use_id", "id") ?? "tool",
                output: event.content ?? event.output ?? event.result ?? "",
                isError: event.is_error === true || event.error === true,
                raw: event,
            };
        case "session.warning":
            return {
                kind: "notice",
                tone: "warning",
                message: stringField(event, "message", "error") ?? "Session warning",
                source: stringField(event, "source"),
                raw: event,
            };
        case "session.error":
            return {
                kind: "notice",
                tone: "error",
                message: stringField(event, "error", "message") ?? "Session error",
                source: stringField(event, "source"),
                raw: event,
            };
        case "session.status_running":
        case "session.running":
            return { kind: "turn_running", raw: event };
        case "session.status_idle":
        case "session.idle": {
            const stop = idleStopReason(event);
            return { kind: "turn_complete", ...stop, raw: event };
        }
        case "session.status_terminated":
        case "session.terminated":
            return { kind: "turn_terminated", raw: event };
        // OpenMA canonical tool lifecycle (decodeManagedSessionEvent output for
        // agent.*tool_use / agent.*tool_result). Hosts that ingest OpenMA events
        // (Console) project through here, so accept both vocabularies.
        case "tool.started": {
            const data = openmaData(event);
            const id = dataString(data, "tool_call_id") ?? stringField(event, "tool_use_id", "id") ?? "tool";
            const kind = dataString(data, "kind");
            return {
                kind: "tool_use",
                tool: {
                    id,
                    family: kind === "mcp" || kind === "custom" ? kind : "builtin",
                    name: dataString(data, "tool_name") ?? stringField(event, "name", "tool_name") ?? "tool",
                    input: data.raw_input ?? event.input,
                    status: "running",
                    rawUse: event,
                },
                raw: event,
            };
        }
        case "tool.completed":
        case "tool.failed": {
            const data = openmaData(event);
            return {
                kind: "tool_result",
                toolId: dataString(data, "tool_call_id") ?? stringField(event, "tool_use_id", "id") ?? "tool",
                output: data.content ?? data.raw_output ?? event.content ?? "",
                isError: event.type === "tool.failed",
                raw: event,
            };
        }
        default:
            return { kind: "ignore", raw: event };
    }
}
function modelError(event) {
    if (event.type !== "span.model_request_end")
        return null;
    const data = event.data && typeof event.data === "object"
        ? event.data
        : event;
    if (data.finish_reason !== "error" || typeof data.error_message !== "string")
        return null;
    return {
        error: data.error_message,
        ...(typeof data.model === "string" ? { model: data.model } : {}),
    };
}
/** message_id of an OpenMA queue-lifecycle fact (`turn.cancelled` /
 * `turn.steered` about one queued user message), else undefined. */
export function queueLifecycleMessageId(event) {
    if (event.type !== "turn.cancelled" && event.type !== "turn.steered")
        return undefined;
    const data = event.data && typeof event.data === "object"
        ? event.data
        : undefined;
    const id = data?.message_id ?? event.message_id;
    return typeof id === "string" && id.length > 0 ? id : undefined;
}
function isPendingUserMessage(event) {
    // Prefer OpenMA delivery (GUI-facing). Fall back to CMA processed_at only
    // inside this adapter module — callers outside protocol/managed should not
    // set processed_at.
    if (event.type === "turn.queued")
        return true;
    if (event.delivery === "queued")
        return true;
    if (event.type === "user.message" && event.delivery === "processed")
        return false;
    return event.type === "user.message" && "processed_at" in event && event.processed_at === null;
}
/** Collapse repeated copies of the same user message id: a stamped
 * `user.message` wins over a prior `turn.queued` / delivery:queued echo. */
function userMessageLikeId(event) {
    if (event.type !== "user.message" && event.type !== "turn.queued")
        return undefined;
    const id = eventStableId(event, "");
    return id || undefined;
}
function dedupeUserMessages(events) {
    const stamped = new Map();
    const last = new Map();
    events.forEach((event, index) => {
        const id = userMessageLikeId(event);
        if (!id)
            return;
        last.set(id, index);
        if (!isPendingUserMessage(event))
            stamped.set(id, index);
    });
    return events.filter((event, index) => {
        const id = userMessageLikeId(event);
        if (!id)
            return true;
        const keep = stamped.get(id) ?? last.get(id);
        return keep === index;
    });
}
function turnInterrupted(turn) {
    return turn.rawEvents.some((event) => event.type === "user.interrupt");
}
export function projectConversationTurns(events, options = {}) {
    return projectConversation(events, options).turns;
}
/** Project turns plus the queue of accepted-but-unprocessed user messages. */
export function projectConversation(events, options = {}) {
    const threadId = options.threadId ?? "sthr_primary";
    const deferMidTurn = options.deferMidTurnUserMessages ?? true;
    // OpenMA queue lifecycle: `turn.cancelled` with a message_id removed a
    // queued message server-side; `turn.steered` absorbed it into the running
    // turn. Both are decoded from the server's queue frames by the adapter.
    const cancelledIds = new Set();
    const steeredIds = new Set();
    for (const event of events) {
        const messageId = queueLifecycleMessageId(event);
        if (!messageId)
            continue;
        if (event.type === "turn.cancelled")
            cancelledIds.add(messageId);
        else if (event.type === "turn.steered")
            steeredIds.add(messageId);
    }
    const filtered = dedupeUserMessages(orderSessionEventsCausally(events).filter((event) => {
        if (eventThreadId(event) !== threadId)
            return false;
        if (queueLifecycleMessageId(event))
            return false;
        const id = userMessageLikeId(event);
        return !(id && cancelledIds.has(id));
    }));
    const results = new Map();
    for (const event of filtered) {
        const normalized = normalizeSessionEvent(event);
        if (normalized.kind === "tool_result")
            results.set(normalized.toolId, normalized);
    }
    const pending = [];
    const deferred = [];
    let flushedTurn;
    const turns = [];
    let current;
    let pendingModelError = null;
    let lastEnded;
    let sessionState = "unknown";
    const ensureTurn = (event) => {
        // An event that arrives after its turn ended (late tool result,
        // synthetic interrupted result, trailing message) belongs to that turn;
        // never open a user-less running turn for it.
        if (!current && lastEnded)
            return lastEnded;
        if (!current) {
            current = {
                id: eventStableId(event, `turn-${turns.length}`),
                status: "running",
                items: [],
                rawEvents: [],
            };
            turns.push(current);
        }
        return current;
    };
    const openUserTurn = (event, normalized) => {
        const turn = {
            id: normalized.id,
            status: "running",
            items: [{ kind: "message", id: normalized.id, role: "user", text: normalized.text, raw: event }],
            rawEvents: [event],
        };
        turns.push(turn);
        current = turn;
        return turn;
    };
    const endTurn = () => {
        if (current)
            lastEnded = current;
        current = undefined;
        flushedTurn = undefined;
        const next = deferred.shift();
        if (next)
            flushedTurn = { turn: openUserTurn(next.event, next.normalized), ...next };
    };
    for (const [order, event] of filtered.entries()) {
        const cause = modelError(event);
        if (cause)
            pendingModelError = cause;
        const normalized = normalizeSessionEvent(event);
        if (normalized.kind === "user_message") {
            if (isPendingUserMessage(event)) {
                pending.push({ order, message: { id: normalized.id, text: normalized.text, reason: "pending", raw: event } });
                continue;
            }
            const active = current;
            const busy = active !== undefined
                && (active.status === "running" || active.status === "awaiting")
                && active.items.some((item) => item.kind === "message" && item.role === "user");
            if (busy && steeredIds.has(normalized.id)) {
                active.items.push({ kind: "message", id: normalized.id, role: "user", text: normalized.text, steered: true, raw: event });
                active.rawEvents.push(event);
                continue;
            }
            if (deferMidTurn && (busy || deferred.length > 0)) {
                deferred.push({ order, event, normalized });
                continue;
            }
            flushedTurn = undefined;
            openUserTurn(event, normalized);
            continue;
        }
        const turn = ensureTurn(event);
        if (flushedTurn?.turn === turn)
            flushedTurn = undefined;
        turn.rawEvents.push(event);
        switch (normalized.kind) {
            case "assistant_message":
                turn.items.push({ kind: "message", id: normalized.id, role: "assistant", text: normalized.text, raw: event });
                break;
            case "thinking":
                turn.items.push({ kind: "thinking", id: normalized.id, text: normalized.text, raw: event });
                break;
            case "tool_use": {
                const result = results.get(normalized.tool.id);
                const tool = result
                    ? {
                        ...normalized.tool,
                        output: result.output,
                        status: result.isError ? "failed" : "completed",
                        isError: result.isError,
                        rawResult: result.raw,
                    }
                    : normalized.tool;
                turn.items.push({ kind: "tool", id: tool.id, tool, raw: event });
                break;
            }
            case "tool_result":
                if (!turn.items.some((item) => item.kind === "tool" && item.tool.id === normalized.toolId)) {
                    turn.items.push({
                        kind: "tool",
                        id: normalized.toolId,
                        tool: {
                            id: normalized.toolId,
                            family: event.type.includes("mcp_") ? "mcp" : "builtin",
                            name: "tool",
                            output: normalized.output,
                            status: normalized.isError ? "failed" : "completed",
                            isError: normalized.isError,
                            rawResult: event,
                        },
                        raw: event,
                    });
                }
                break;
            case "notice":
                turn.items.push({
                    kind: "notice",
                    id: eventStableId(event, `notice-${turn.items.length}`),
                    tone: normalized.tone,
                    message: normalized.message,
                    source: normalized.source,
                    ...(normalized.tone === "error" && pendingModelError ? { cause: pendingModelError } : {}),
                    raw: event,
                });
                if (normalized.tone === "error") {
                    turn.status = "errored";
                    pendingModelError = null;
                }
                break;
            case "turn_running":
                sessionState = "running";
                if (turn === current && turn.status === "awaiting") {
                    turn.status = "running";
                    delete turn.awaitingToolCallIds;
                }
                break;
            case "turn_complete": {
                if (normalized.stopReason)
                    turn.stopReason = normalized.stopReason;
                if (normalized.stopReason === "requires_action") {
                    sessionState = "requires_action";
                    // Official semantics: the turn is parked, not finished. It
                    // continues across the tool round-trip.
                    if (turn === current && (turn.status === "running" || turn.status === "awaiting")) {
                        turn.status = "awaiting";
                        turn.awaitingToolCallIds = normalized.awaitingEventIds ?? [];
                    }
                    break;
                }
                sessionState = "idle";
                if (turn.status === "running" || turn.status === "awaiting") {
                    turn.status = turnInterrupted(turn)
                        ? "interrupted"
                        : normalized.stopReason && normalized.stopReason !== "end_turn"
                            ? "errored"
                            : "completed";
                }
                delete turn.awaitingToolCallIds;
                if (turn === current)
                    endTurn();
                break;
            }
            case "turn_terminated":
                sessionState = "terminated";
                turn.status = "terminated";
                delete turn.awaitingToolCallIds;
                if (turn === current)
                    endTurn();
                break;
            default:
                break;
        }
    }
    // A deferred message promoted at the last idle with nothing after it has
    // not actually started processing yet: keep it queued instead of showing
    // an empty "running" turn.
    const queuedDeferred = [...deferred];
    if (flushedTurn && flushedTurn.turn.rawEvents.length === 1) {
        turns.splice(turns.indexOf(flushedTurn.turn), 1);
        queuedDeferred.unshift({ order: flushedTurn.order, event: flushedTurn.event, normalized: flushedTurn.normalized });
    }
    const queued = [
        ...pending,
        ...queuedDeferred.map(({ order, event, normalized }) => ({
            order,
            message: { id: normalized.id, text: normalized.text, reason: "deferred", raw: event },
        })),
    ].sort((left, right) => left.order - right.order).map(({ message }) => message);
    // Session-level settle: once the session is idle/terminated nothing may
    // stay running. A host-provided status wins over the log.
    const hostStatus = options.sessionStatus;
    const settled = hostStatus === "idle" || hostStatus === "terminated"
        ? hostStatus
        : sessionState === "idle" || sessionState === "terminated"
            ? sessionState
            : undefined;
    if (hostStatus === "idle" && sessionState === "requires_action") {
        // Host idle without stop_reason is compatible with requires_action.
    }
    else if (settled) {
        for (const turn of turns) {
            if (turn.status !== "running" && turn.status !== "awaiting")
                continue;
            turn.status = settled === "terminated" ? "terminated" : turnInterrupted(turn) ? "interrupted" : "completed";
            delete turn.awaitingToolCallIds;
        }
        if (hostStatus === "terminated")
            sessionState = "terminated";
        else if (hostStatus === "idle" && sessionState !== "terminated")
            sessionState = "idle";
    }
    // Only the last open turn can be active; earlier open ones were superseded.
    const visible = turns.filter((turn) => turn.items.length > 0);
    let active;
    for (let i = visible.length - 1; i >= 0; i -= 1) {
        const turn = visible[i];
        if (turn.status === "running" || turn.status === "awaiting") {
            if (!active)
                active = turn;
            else
                turn.status = turnInterrupted(turn) ? "interrupted" : "completed";
        }
    }
    return {
        turns: visible,
        queued,
        ...(active ? { activeTurnId: active.id } : {}),
        awaitingToolCallIds: active?.status === "awaiting" ? [...(active.awaitingToolCallIds ?? [])] : [],
        sessionState,
    };
}
/** Adapt Managed's event vocabulary to the richer ACP/Backchat render model.
 * The renderer can therefore consume one `TurnRender` whether events came
 * from a local ACP child or OpenManaged's cloud/local runtime. */
export function projectCanonicalChatTurns(events, options = {}) {
    return projectCanonicalChat(events, options).turns;
}
/** Canonical chat turns plus queued user messages (see `QueuedUserMessage`). */
export function projectCanonicalChat(events, options = {}) {
    const projection = projectConversation(events, options);
    return {
        queued: projection.queued,
        ...(projection.activeTurnId ? { activeTurnId: projection.activeTurnId } : {}),
        awaitingToolCallIds: projection.awaitingToolCallIds,
        sessionState: projection.sessionState,
        turns: projection.turns.map((turn) => {
            const render = {
                thoughtText: "",
                currentThoughtText: "",
                assistantText: "",
                tools: [],
                plan: [],
                notes: [],
                timeline: [],
            };
            const userParts = [];
            for (const item of turn.items) {
                if (item.kind === "message") {
                    if (item.role === "user") {
                        if (item.steered)
                            render.timeline.push({ kind: "user_input", text: item.text, clientId: item.id });
                        else
                            userParts.push(item.text);
                        continue;
                    }
                    render.assistantText += item.text;
                    render.timeline.push({ kind: "assistant_text", text: item.text });
                    continue;
                }
                if (item.kind === "thinking") {
                    render.thoughtText += item.text;
                    render.timeline.push({ kind: "thought", messageId: item.id, text: item.text });
                    render.currentThoughtText = latestThoughtSegment(render.thoughtText);
                    continue;
                }
                if (item.kind === "notice") {
                    render.notes.push(item.message);
                    continue;
                }
                const tool = item.tool;
                const status = tool.status === "running" ? "in_progress" : tool.status;
                const entry = {
                    toolCallId: tool.id,
                    title: tool.name,
                    toolName: tool.name,
                    status,
                    rawInput: tool.input,
                    rawOutput: tool.output,
                };
                render.tools.push(entry);
                render.timeline.push({ kind: "tool", toolCallId: tool.id });
            }
            if (turn.status !== "running")
                render.currentThoughtText = "";
            return {
                id: turn.id,
                status: turn.status,
                ...(turn.awaitingToolCallIds ? { awaitingToolCallIds: turn.awaitingToolCallIds } : {}),
                ...(turn.stopReason ? { stopReason: turn.stopReason } : {}),
                userText: userParts.join("\n"),
                render,
                rawEvents: turn.rawEvents,
            };
        }),
    };
}
/** @deprecated Use @openma/common/protocol/managed for the v2 SDK codec. */
export * from "../protocol/managed/index.js";
//# sourceMappingURL=managed.js.map