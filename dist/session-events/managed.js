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
    return stringField(event, "id", "message_id", "thinking_id", "tool_use_id", "mcp_tool_use_id") ?? fallback;
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
        case "user.message":
            return {
                kind: "user_message",
                id: eventStableId(event, "user-message"),
                text: eventText(event.content),
                raw: event,
            };
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
            return { kind: "turn_running", raw: event };
        case "session.status_idle":
            return { kind: "turn_complete", raw: event };
        case "session.status_terminated":
            return { kind: "turn_terminated", raw: event };
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
export function projectConversationTurns(events, options = {}) {
    const threadId = options.threadId ?? "sthr_primary";
    const filtered = events.filter((event) => eventThreadId(event) === threadId);
    const results = new Map();
    for (const event of filtered) {
        const normalized = normalizeSessionEvent(event);
        if (normalized.kind === "tool_result")
            results.set(normalized.toolId, normalized);
    }
    const turns = [];
    let current;
    let pendingModelError = null;
    const ensureTurn = (event) => {
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
    for (const event of filtered) {
        const cause = modelError(event);
        if (cause)
            pendingModelError = cause;
        const normalized = normalizeSessionEvent(event);
        if (normalized.kind === "user_message") {
            current = {
                id: normalized.id,
                status: "running",
                items: [],
                rawEvents: [],
            };
            turns.push(current);
        }
        const turn = ensureTurn(event);
        turn.rawEvents.push(event);
        switch (normalized.kind) {
            case "user_message":
                turn.items.push({ kind: "message", id: normalized.id, role: "user", text: normalized.text, raw: event });
                break;
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
            case "turn_complete":
                if (turn.status === "running")
                    turn.status = "completed";
                current = undefined;
                break;
            case "turn_terminated":
                turn.status = "terminated";
                current = undefined;
                break;
            default:
                break;
        }
    }
    return turns.filter((turn) => turn.items.length > 0);
}
/** Adapt Managed's event vocabulary to the richer ACP/Backchat render model.
 * The renderer can therefore consume one `TurnRender` whether events came
 * from a local ACP child or OpenManaged's cloud/local runtime. */
export function projectCanonicalChatTurns(events, options = {}) {
    return projectConversationTurns(events, options).map((turn) => {
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
            userText: userParts.join("\n"),
            render,
            rawEvents: turn.rawEvents,
        };
    });
}
//# sourceMappingURL=managed.js.map