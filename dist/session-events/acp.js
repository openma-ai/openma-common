/**
 * Reduce an array of ACP `session.event` payloads into the bubble structure
 * the chat view renders.
 *
 *   - `agent_message_chunk` (type=text) → concatenated into a single
 *     assistant bubble (one per turn).
 *   - `agent_thought_chunk` (type=text) → concatenated into an optional
 *     "Thinking" reasoning block above the assistant bubble.
 *   - `tool_call` → a new `ToolEntry` with status/title/etc, content[]
 *     blocks (diff / terminal / image / content), and locations[].
 *   - `tool_call_update` → PATCH onto an existing tool by toolCallId.
 *   - `plan`             → REPLACE the current plan (no merging).
 *   - `available_commands_update` → REPLACE the per-session slash command
 *     list. The session store, not reduceTurn, owns this — it's
 *     session-scoped, not turn-scoped — but we surface it here so the
 *     reducer test can verify the dispatch path.
 *   - `current_mode_update` → REPLACE the agent's current mode id.
 *   - session-level metadata is handled by SessionStore before this reducer.
 *
 * Designed to be pure: pass an immutable event list, get a snapshot.
 * Re-running on each render is cheap because events list grows linearly
 * with the turn length (a few hundred at most).
 */
import { extractAcpSystemNotice } from "./acp-system-notices.js";
export { extractAcpSystemNotice } from "./acp-system-notices.js";
/** Internal transport context added when the ACP SDK gives OpenMA a
 * notification-scoped `_meta` alongside `params.update`. The explicit key
 * keeps wire-layer metadata separate from update/harness `_meta` while the
 * existing flat update shape remains compatible with consumers. */
export const ACP_NOTIFICATION_CONTEXT_KEY = "_openma.acp.notification";
export function preserveAcpNotificationContext(params) {
    if (!params || typeof params !== "object")
        return params;
    const notification = params;
    if (!("update" in notification))
        return params;
    const update = notification.update;
    if (!update || typeof update !== "object")
        return update;
    const notificationMeta = notification._meta;
    if (!notificationMeta || typeof notificationMeta !== "object")
        return update;
    return {
        ...update,
        [ACP_NOTIFICATION_CONTEXT_KEY]: {
            ...(typeof notification.sessionId === "string"
                ? { session_id: notification.sessionId }
                : {}),
            meta: notificationMeta,
        },
    };
}
const SILENT_SESSION_UPDATES = new Set([
    "current_mode_update",
    "config_option_update",
    "session_info_update",
    "usage_update",
]);
const ACP_SESSION_UPDATE_TYPES = new Set([
    "user_message_chunk",
    "agent_message_chunk",
    "agent_thought_chunk",
    "tool_call",
    "tool_call_update",
    "plan",
    "plan_update",
    "plan_removed",
    "available_commands_update",
    ...SILENT_SESSION_UPDATES,
]);
export function sessionUpdateInner(event) {
    const ev = event;
    const update = ev?.update;
    return (update && typeof update === "object" ? update : ev ?? {});
}
export function sessionUpdateType(event) {
    const inner = sessionUpdateInner(event);
    const ev = event;
    const rawType = typeof inner.type === "string" ? inner.type : undefined;
    const innerUpdate = typeof inner.sessionUpdate === "string" ? inner.sessionUpdate : undefined;
    const outerUpdate = typeof ev?.sessionUpdate === "string" ? ev.sessionUpdate : undefined;
    return (innerUpdate ??
        outerUpdate ??
        (rawType && ACP_SESSION_UPDATE_TYPES.has(rawType) ? rawType : undefined));
}
function stringField(raw, names) {
    for (const name of names) {
        const value = raw[name];
        if (typeof value === "string" && value.length > 0)
            return value;
    }
    return undefined;
}
function normalizeToolCall(raw) {
    const meta = objectField(raw._meta);
    const claudeMeta = objectField(meta.claudeCode);
    const toolCallId = raw.toolCallId ?? raw.tool_call_id ?? raw.id;
    const entry = {
        toolCallId: String(toolCallId ?? ""),
    };
    if (Object.keys(meta).length > 0)
        entry.meta = meta;
    const title = raw.title ?? raw.name ?? raw.toolName ?? raw.tool_name;
    if (typeof title === "string")
        entry.title = title;
    if (typeof raw.kind === "string")
        entry.kind = raw.kind;
    if (typeof raw.status === "string")
        entry.status = raw.status;
    const rawInput = raw.rawInput ?? raw.raw_input ?? raw.input ?? raw.args;
    const rawOutput = raw.rawOutput ?? raw.raw_output ?? raw.output ?? raw.result;
    if (rawInput !== undefined && rawInput !== null)
        entry.rawInput = rawInput;
    if (rawOutput !== undefined && rawOutput !== null)
        entry.rawOutput = rawOutput;
    if (rawOutput === undefined || rawOutput === null) {
        const terminalOutput = objectField(meta.terminal_output);
        const terminalOutputDelta = objectField(meta.terminal_output_delta);
        const mcpOutputDelta = objectField(meta.mcp_output_delta);
        const terminalData = stringValue(terminalOutput.data) ?? stringValue(terminalOutputDelta.data);
        const mcpData = stringValue(mcpOutputDelta.data);
        if (terminalData !== undefined) {
            entry.outputDelta = { data: terminalData, separator: "" };
        }
        else if (mcpData !== undefined) {
            entry.outputDelta = { data: mcpData, separator: "\n" };
        }
    }
    if (entry.status === undefined) {
        const terminalExit = objectField(meta.terminal_exit);
        const exitCode = terminalExit.exit_code ?? terminalExit.exitCode;
        const signal = terminalExit.signal;
        if (typeof exitCode === "number") {
            entry.status = exitCode === 0 ? "completed" : "failed";
        }
        else if (typeof signal === "string" && signal.length > 0) {
            entry.status = "failed";
        }
    }
    if (Array.isArray(raw.content))
        entry.content = raw.content;
    if (Array.isArray(raw.locations))
        entry.locations = raw.locations;
    const toolName = claudeMeta.toolName ?? raw.toolName ?? raw.tool_name ?? raw.name;
    if (typeof toolName === "string")
        entry.toolName = toolName;
    const parentToolUseId = stringValue(claudeMeta.parentToolUseId) ??
        stringValue(raw.parentToolUseId) ??
        stringValue(raw.parent_tool_use_id);
    if (parentToolUseId)
        entry.parentToolUseId = parentToolUseId;
    return entry;
}
function normalizeCanonicalToolEvent(event) {
    const type = stringValue(event.type);
    if (type !== "tool.started"
        && type !== "tool.progress"
        && type !== "tool.completed"
        && type !== "tool.failed"
        && type !== "tool.cancelled")
        return null;
    const data = objectField(event.data);
    const toolCallId = stringField(data, ["tool_call_id", "toolCallId", "id"]);
    if (!toolCallId)
        return null;
    const tool = normalizeToolCall({
        toolCallId,
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.kind !== undefined ? { kind: data.kind } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.raw_input !== undefined ? { rawInput: data.raw_input } : {}),
        ...(data.rawInput !== undefined ? { rawInput: data.rawInput } : {}),
        ...(data.raw_output !== undefined ? { rawOutput: data.raw_output } : {}),
        ...(data.rawOutput !== undefined ? { rawOutput: data.rawOutput } : {}),
        ...(data.raw_output === undefined
            && data.rawOutput === undefined
            && typeof data.error === "string"
            ? { rawOutput: data.error }
            : {}),
        ...(data.content !== undefined ? { content: data.content } : {}),
        ...(data.locations !== undefined ? { locations: data.locations } : {}),
        ...(data.tool_name !== undefined ? { toolName: data.tool_name } : {}),
        ...(data.adapter_meta !== undefined ? { _meta: data.adapter_meta } : {}),
        ...(event.parent_id !== undefined ? { parentToolUseId: event.parent_id } : {}),
    });
    if (type === "tool.completed")
        tool.status = "completed";
    if (type === "tool.failed")
        tool.status = "failed";
    if (type === "tool.cancelled")
        tool.status = "cancelled";
    const output = objectField(data.output);
    const outputData = stringValue(output.data);
    if (tool.rawOutput === undefined && outputData !== undefined) {
        tool.outputDelta = {
            data: outputData,
            separator: typeof output.separator === "string"
                ? output.separator
                : output.kind === "mcp"
                    ? "\n"
                    : "",
        };
    }
    return tool;
}
function objectField(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
}
function stringValue(value) {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
function messageIdFrom(raw) {
    return stringField(raw, ["messageId", "message_id"]);
}
function parentToolUseIdFrom(raw) {
    const meta = objectField(raw._meta);
    const claudeMeta = objectField(meta.claudeCode);
    return (stringValue(claudeMeta.parentToolUseId) ??
        stringValue(raw.parentToolUseId) ??
        stringValue(raw.parent_tool_use_id));
}
function codexMessagePhase(raw) {
    if (raw.phase === "commentary" || raw.phase === "final_answer") {
        return raw.phase;
    }
    const codex = objectField(objectField(raw._meta).codex);
    return codex.phase === "commentary" || codex.phase === "final_answer"
        ? codex.phase
        : undefined;
}
function extractContentText(inner) {
    if (typeof inner.text === "string")
        return inner.text;
    if (typeof inner.delta === "string")
        return inner.delta;
    if (typeof inner.content === "string")
        return inner.content;
    const content = inner.content;
    if (typeof content?.text === "string")
        return content.text;
    if (typeof content?.content === "string")
        return content.content;
    if (content?.content && typeof content.content === "object") {
        const nested = content.content;
        if (typeof nested.text === "string")
            return nested.text;
    }
    return undefined;
}
function extractTextBlocks(value) {
    if (typeof value === "string")
        return value;
    if (Array.isArray(value)) {
        const text = value
            .map((part) => {
            if (!part || typeof part !== "object")
                return "";
            const block = part;
            if (typeof block.text === "string")
                return block.text;
            if (typeof block.content === "string")
                return block.content;
            return "";
        })
            .join("");
        return text.length > 0 ? text : undefined;
    }
    if (!value || typeof value !== "object")
        return undefined;
    const block = value;
    if (typeof block.text === "string")
        return block.text;
    if (typeof block.content === "string")
        return block.content;
    return undefined;
}
function isTransportDiagnosticText(text) {
    return /^Falling back from WebSockets to HTTPS transport\./i.test(text.trim());
}
export function sanitizeThoughtText(text) {
    return text.replace(/<!--[\s\S]*?-->/g, "");
}
function parsePlanEntries(rawEntries) {
    if (!Array.isArray(rawEntries))
        return [];
    return rawEntries
        .filter((entry) => Boolean(entry) && typeof entry === "object")
        .map((entry) => ({
        id: typeof entry.id === "string" && entry.id.length > 0
            ? entry.id
            : undefined,
        content: typeof entry.content === "string" ? entry.content : "",
        priority: entry.priority === "high" ||
            entry.priority === "medium" ||
            entry.priority === "low"
            ? entry.priority
            : undefined,
        status: entry.status === "pending" ||
            entry.status === "in_progress" ||
            entry.status === "completed" ||
            entry.status === "cancelled"
            ? entry.status
            : "pending",
    }));
}
function getEventSummary(event) {
    try {
        return JSON.stringify(event);
    }
    catch {
        return undefined;
    }
}
export function parseAcpEvent(event) {
    const eventRecord = objectField(event);
    const isCanonicalOpenMAEvent = eventRecord.schema_version === "oma.event.v1";
    const canonicalTool = isCanonicalOpenMAEvent
        ? normalizeCanonicalToolEvent(eventRecord)
        : null;
    if (canonicalTool)
        return { kind: "tool_call", tool: canonicalTool, event };
    const canonicalType = isCanonicalOpenMAEvent
        ? stringValue(eventRecord.type)
        : undefined;
    const canonicalData = objectField(eventRecord.data);
    if (canonicalType === "agent.message" || canonicalType === "agent.message_chunk") {
        const text = stringValue(canonicalData.text)
            ?? extractTextBlocks(canonicalData.content);
        return text
            ? {
                kind: "text",
                text,
                messageId: stringField(canonicalData, ["message_id", "messageId"]),
                ...(canonicalData.phase === "commentary"
                    || canonicalData.phase === "final_answer"
                    ? { phase: canonicalData.phase }
                    : {}),
                parentToolUseId: stringValue(eventRecord.parent_id),
                event,
            }
            : { kind: "silent", event };
    }
    if (canonicalType === "agent.thinking") {
        const text = stringValue(canonicalData.text)
            ?? extractTextBlocks(canonicalData.content);
        return text
            ? {
                kind: "thought",
                text: sanitizeThoughtText(text),
                messageId: stringField(canonicalData, ["message_id", "messageId"]),
                parentToolUseId: stringValue(eventRecord.parent_id),
                event,
            }
            : { kind: "silent", event };
    }
    if (canonicalType === "plan.updated") {
        if (Array.isArray(canonicalData.entries)) {
            const document = objectField(canonicalData.document);
            const markdown = stringValue(document.markdown)
                ?? stringValue(canonicalData.markdown);
            const uri = stringValue(document.uri) ?? stringValue(canonicalData.uri);
            const parsedDocument = markdown
                ? {
                    ...(stringValue(document.id) ? { id: String(document.id) } : {}),
                    ...(stringValue(document.title) ? { title: String(document.title) } : {}),
                    markdown,
                }
                : uri
                    ? {
                        ...(stringValue(document.id) ? { id: String(document.id) } : {}),
                        ...(stringValue(document.title) ? { title: String(document.title) } : {}),
                        type: "file",
                        uri,
                    }
                    : undefined;
            return {
                kind: "plan",
                planId: stringField(canonicalData, ["plan_id", "planId", "id"]),
                updateMode: canonicalData.update_mode === "merge" ? "merge" : "replace",
                plan: parsePlanEntries(canonicalData.entries),
                ...(parsedDocument ? { document: parsedDocument } : {}),
                event,
            };
        }
        const document = objectField(canonicalData.document);
        const markdown = stringValue(document.markdown)
            ?? stringValue(canonicalData.markdown);
        if (markdown) {
            return {
                kind: "plan_document",
                document: {
                    ...(stringValue(document.id) ? { id: String(document.id) } : {}),
                    ...(stringValue(document.title) ? { title: String(document.title) } : {}),
                    markdown,
                },
                event,
            };
        }
        const uri = stringValue(document.uri) ?? stringValue(canonicalData.uri);
        if (uri) {
            return {
                kind: "plan_document",
                document: {
                    ...(stringValue(document.id) ? { id: String(document.id) } : {}),
                    ...(stringValue(document.title) ? { title: String(document.title) } : {}),
                    type: "file",
                    uri,
                },
                event,
            };
        }
    }
    if (canonicalType === "plan.completed" || canonicalType === "plan.removed") {
        return {
            kind: "plan_removed",
            planId: stringField(canonicalData, ["plan_id", "planId", "id"]),
            event,
        };
    }
    const inner = sessionUpdateInner(event);
    const update = sessionUpdateType(event);
    if (!update) {
        if (inner.type === "agent.message_chunk" && typeof inner.delta === "string") {
            return inner.delta.length > 0
                ? {
                    kind: "text",
                    text: inner.delta,
                    phase: codexMessagePhase(inner),
                    messageId: messageIdFrom(inner),
                    parentToolUseId: parentToolUseIdFrom(inner),
                    event,
                }
                : { kind: "silent", event };
        }
        if (inner.type === "agent.message") {
            const text = extractTextBlocks(inner.content);
            return typeof text === "string" && text.length > 0
                ? {
                    kind: "text",
                    text,
                    phase: codexMessagePhase(inner),
                    messageId: messageIdFrom(inner),
                    parentToolUseId: parentToolUseIdFrom(inner),
                    event,
                }
                : { kind: "silent", event };
        }
        if (inner.type === "agent.thinking_chunk" && typeof inner.delta === "string") {
            const text = sanitizeThoughtText(inner.delta);
            return inner.delta.length > 0
                ? text.length > 0
                    ? {
                        kind: "thought",
                        text,
                        messageId: messageIdFrom(inner),
                        parentToolUseId: parentToolUseIdFrom(inner),
                        event,
                    }
                    : { kind: "silent", event }
                : { kind: "silent", event };
        }
        if (inner.type === "agent.thinking") {
            const rawText = typeof inner.text === "string" ? inner.text : extractTextBlocks(inner.content);
            const text = typeof rawText === "string" ? sanitizeThoughtText(rawText) : rawText;
            return typeof text === "string" && text.length > 0
                ? {
                    kind: "thought",
                    text,
                    messageId: messageIdFrom(inner),
                    parentToolUseId: parentToolUseIdFrom(inner),
                    event,
                }
                : { kind: "silent", event };
        }
        if (inner.type === "agent.tool_use" && typeof inner.id === "string") {
            return {
                kind: "tool_call",
                tool: {
                    toolCallId: inner.id,
                    title: typeof inner.name === "string" ? inner.name : "tool",
                    toolName: typeof inner.name === "string" ? inner.name : undefined,
                    rawInput: inner.input ?? {},
                    status: "pending",
                },
                event,
            };
        }
        if (inner.type === "agent.tool_result" && typeof inner.tool_use_id === "string") {
            return {
                kind: "tool_call",
                tool: {
                    toolCallId: inner.tool_use_id,
                    rawOutput: extractTextBlocks(inner.content) ?? inner.content,
                    status: inner.is_error ? "failed" : "completed",
                },
                event,
            };
        }
        if (inner.type === "agent.message_stream_start" ||
            inner.type === "agent.message_stream_end" ||
            inner.type === "agent.thinking_stream_start" ||
            inner.type === "agent.thinking_stream_end" ||
            inner.type === "agent.tool_use_input_stream_start" ||
            inner.type === "agent.tool_use_input_chunk" ||
            inner.type === "agent.tool_use_input_stream_end" ||
            inner.type === "session.status_running" ||
            inner.type === "session.status_idle" ||
            inner.type === "session.warning") {
            return { kind: "silent", event };
        }
        if (inner.type === "session.error" && typeof inner.error === "string" && inner.error.length > 0) {
            return { kind: "note", note: inner.error, event };
        }
        if (inner.type === "text" && typeof inner.text === "string" && inner.text.length > 0) {
            return {
                kind: "text",
                text: inner.text,
                phase: codexMessagePhase(inner),
                messageId: messageIdFrom(inner),
                parentToolUseId: parentToolUseIdFrom(inner),
                event,
            };
        }
        if (inner.type === "thought" && typeof inner.text === "string" && inner.text.length > 0) {
            const text = sanitizeThoughtText(inner.text);
            return text.length > 0
                ? {
                    kind: "thought",
                    text,
                    messageId: messageIdFrom(inner),
                    parentToolUseId: parentToolUseIdFrom(inner),
                    event,
                }
                : { kind: "silent", event };
        }
        if (inner.type === "requestPermission") {
            // Compatibility for sessions persisted before approval requests moved
            // exclusively onto the broker channel. Approval is transient UI state,
            // never a completed tool/activity row.
            return { kind: "silent", event };
        }
        if ((inner.type === "tool_call" || inner.type === "tool_call_update") &&
            (typeof inner.toolCallId === "string" ||
                typeof inner.tool_call_id === "string" ||
                typeof inner.id === "string")) {
            return { kind: "tool_call", tool: normalizeToolCall(inner), event };
        }
        if (inner.type === "promptError" && typeof inner.error === "string" && inner.error.length > 0) {
            return { kind: "text", text: inner.error, event };
        }
        if (inner.type === "promptComplete") {
            return { kind: "note", note: "Turn complete", event };
        }
        return { kind: "raw", event };
    }
    if (update === "agent_message_chunk" || update === "agent_thought_chunk") {
        const text = extractContentText(inner);
        if (typeof text !== "string" || text.length === 0)
            return { kind: "silent", event };
        const notice = update === "agent_message_chunk" ? extractAcpSystemNotice(event) : null;
        if (notice)
            return { kind: "notice", notice: notice.message, event };
        if (update === "agent_message_chunk" && isTransportDiagnosticText(text)) {
            return { kind: "silent", event };
        }
        const visibleText = update === "agent_thought_chunk" ? sanitizeThoughtText(text) : text;
        if (visibleText.length === 0)
            return { kind: "silent", event };
        return {
            kind: update === "agent_thought_chunk" ? "thought" : "text",
            text: visibleText,
            ...(update === "agent_thought_chunk"
                ? {
                    messageId: messageIdFrom(inner),
                    parentToolUseId: parentToolUseIdFrom(inner),
                }
                : {
                    phase: codexMessagePhase(inner),
                    messageId: messageIdFrom(inner),
                    parentToolUseId: parentToolUseIdFrom(inner),
                }),
            event,
        };
    }
    if (update === "user_message_chunk")
        return { kind: "silent", event };
    if (update === "tool_call" || update === "tool_call_update") {
        const toolCallId = stringField(inner, ["toolCallId", "tool_call_id", "id"]);
        if (!toolCallId)
            return { kind: "raw", event };
        return { kind: "tool_call", tool: normalizeToolCall(inner), event };
    }
    if (update === "plan") {
        const rawEntries = Array.isArray(inner.entries)
            ? inner.entries
            : inner.plan &&
                typeof inner.plan === "object" &&
                Array.isArray(inner.plan.entries)
                ? inner.plan.entries
                : [];
        return { kind: "plan", plan: parsePlanEntries(rawEntries), event };
    }
    if (update === "plan_update") {
        const plan = inner.plan && typeof inner.plan === "object"
            ? inner.plan
            : inner;
        const planId = stringField(plan, ["planId", "plan_id", "id"]);
        const content = plan.content && typeof plan.content === "object"
            ? plan.content
            : plan;
        if (Array.isArray(content.entries)) {
            return {
                kind: "plan",
                ...(planId ? { planId } : {}),
                plan: parsePlanEntries(content.entries),
                event,
            };
        }
        const markdown = typeof content.markdown === "string"
            ? content.markdown
            : typeof content.content === "string"
                ? content.content
                : undefined;
        if (markdown) {
            return {
                kind: "plan_document",
                document: {
                    ...(planId ? { id: planId } : {}),
                    ...(typeof plan.title === "string" ? { title: plan.title } : {}),
                    markdown,
                },
                event,
            };
        }
        const uri = stringValue(plan.uri) ?? stringValue(content.uri);
        if (uri) {
            return {
                kind: "plan_document",
                document: {
                    ...(planId ? { id: planId } : {}),
                    ...(typeof plan.title === "string" ? { title: plan.title } : {}),
                    type: "file",
                    uri,
                },
                event,
            };
        }
        const summary = getEventSummary(inner);
        return {
            kind: "note",
            note: summary ? `Plan updated: ${summary}` : "Plan updated",
            event,
        };
    }
    if (update === "plan_removed") {
        return {
            kind: "plan_removed",
            planId: stringField(inner, ["planId", "plan_id", "id"]),
            event,
        };
    }
    if (update === "available_commands_update") {
        const availableCommands = Array.isArray(inner.availableCommands)
            ? inner.availableCommands
            : Array.isArray(inner.available_commands)
                ? inner.available_commands
                : null;
        if (!availableCommands)
            return { kind: "silent", event };
        return {
            kind: "commands",
            commands: availableCommands,
            event,
        };
    }
    if (SILENT_SESSION_UPDATES.has(update))
        return { kind: "silent", event };
    return { kind: "raw", event };
}
function isEmptyObject(value) {
    if (value === undefined || value === null)
        return true;
    if (typeof value !== "object")
        return false;
    return Object.keys(value).length === 0;
}
const MIN_OVERLAP = 8;
const SNAPSHOT_HEAD_PROBE = 16;
export function mergeStreamingText(accumulated, incoming) {
    if (!accumulated)
        return incoming;
    if (!incoming)
        return accumulated;
    if (incoming === accumulated)
        return accumulated;
    if (incoming.startsWith(accumulated))
        return incoming;
    if (accumulated.endsWith(incoming))
        return accumulated;
    if (incoming.length >= accumulated.length) {
        const head = Math.min(SNAPSHOT_HEAD_PROBE, accumulated.length);
        if (head > 0 && incoming.slice(0, head) === accumulated.slice(0, head)) {
            return incoming;
        }
    }
    const maxOverlap = Math.min(accumulated.length, incoming.length);
    for (let k = maxOverlap; k >= MIN_OVERLAP; k--) {
        if (accumulated.endsWith(incoming.slice(0, k))) {
            return accumulated + incoming.slice(k);
        }
    }
    return accumulated + incoming;
}
export function reduceTurn(events) {
    const out = {
        thoughtText: "",
        currentThoughtText: "",
        assistantText: "",
        tools: [],
        plan: [],
        notes: [],
        timeline: [],
    };
    const toolById = new Map();
    let toolsOrder = [];
    // Running buffer for the current assistant_text segment. Flushed into
    // out.timeline when a tool_call event arrives (which breaks the run)
    // or at end-of-stream. Same chunk concatenation we used to do into
    // assistantText, but segment-aware.
    let textBuf = "";
    let textPhase;
    const flushText = () => {
        if (textBuf) {
            out.timeline.push({
                kind: "assistant_text",
                text: textBuf,
                ...(textPhase ? { phase: textPhase } : {}),
            });
            textBuf = "";
            textPhase = undefined;
        }
    };
    const thoughtIndexByMessageId = new Map();
    let currentPlanId;
    let anonymousThoughtIndex;
    const appendThought = (parsed) => {
        const id = parsed.messageId;
        const existingIndex = id
            ? thoughtIndexByMessageId.get(id)
            : anonymousThoughtIndex;
        if (existingIndex !== undefined) {
            const existing = out.timeline[existingIndex];
            if (existing?.kind === "thought") {
                existing.text = mergeStreamingText(existing.text, parsed.text);
                out.currentThoughtText = latestThoughtSegment(existing.text);
                return;
            }
        }
        flushText();
        const item = {
            kind: "thought",
            text: parsed.text,
            ...(id ? { messageId: id } : {}),
        };
        const index = out.timeline.push(item) - 1;
        if (id)
            thoughtIndexByMessageId.set(id, index);
        else
            anonymousThoughtIndex = index;
        out.currentThoughtText = latestThoughtSegment(parsed.text);
    };
    const appendOutputDelta = (current, delta) => {
        if (typeof current !== "string" || current.length === 0)
            return delta.data;
        if (delta.separator.length === 0
            || current.endsWith(delta.separator)
            || delta.data.startsWith(delta.separator)) {
            return current + delta.data;
        }
        return current + delta.separator + delta.data;
    };
    const mergePlanEntries = (current, incoming) => {
        const next = [...current];
        const indexById = new Map();
        next.forEach((entry, index) => {
            if (entry.id)
                indexById.set(entry.id, index);
        });
        for (const entry of incoming) {
            const existingIndex = entry.id ? indexById.get(entry.id) : undefined;
            if (existingIndex === undefined) {
                if (entry.id)
                    indexById.set(entry.id, next.length);
                next.push(entry);
            }
            else {
                next[existingIndex] = entry;
            }
        }
        return next;
    };
    const upsertTool = (incoming) => {
        const id = incoming.toolCallId;
        if (!id)
            return;
        const prev = toolById.get(id);
        if (!prev) {
            const entry = {
                toolCallId: id,
                title: incoming.title,
                kind: incoming.kind,
                status: incoming.status,
                rawInput: incoming.rawInput,
                rawOutput: incoming.rawOutput !== undefined
                    ? incoming.rawOutput
                    : incoming.outputDelta?.data,
                toolName: incoming.toolName,
                meta: incoming.meta,
                parentToolUseId: incoming.parentToolUseId,
                content: incoming.content,
                locations: incoming.locations,
            };
            if (entry.status === "in_progress" &&
                entry.content?.some((b) => b.type === "content" && b.content?.type === "image")) {
                entry.status = "completed";
            }
            toolById.set(id, entry);
            if (!toolsOrder.includes(id)) {
                toolsOrder.push(id);
                flushText();
                out.timeline.push({ kind: "tool", toolCallId: id });
            }
            return;
        }
        if (incoming.title !== undefined)
            prev.title = incoming.title;
        if (incoming.kind !== undefined)
            prev.kind = incoming.kind;
        if (incoming.status !== undefined)
            prev.status = incoming.status;
        if (incoming.toolName !== undefined)
            prev.toolName = incoming.toolName;
        if (incoming.meta !== undefined) {
            prev.meta = {
                ...(prev.meta ?? {}),
                ...incoming.meta,
            };
        }
        if (incoming.parentToolUseId !== undefined) {
            prev.parentToolUseId = incoming.parentToolUseId;
        }
        if (incoming.rawInput !== undefined) {
            const incEmpty = isEmptyObject(incoming.rawInput);
            const prevHasContent = !isEmptyObject(prev.rawInput);
            if (!(incEmpty && prevHasContent))
                prev.rawInput = incoming.rawInput;
        }
        if (incoming.rawOutput !== undefined) {
            // A native ACP rawOutput is a complete snapshot and therefore replaces
            // any adapter deltas accumulated before it.
            prev.rawOutput = incoming.rawOutput;
        }
        else if (incoming.outputDelta !== undefined) {
            prev.rawOutput = appendOutputDelta(prev.rawOutput, incoming.outputDelta);
        }
        if (incoming.content !== undefined)
            prev.content = incoming.content;
        if (incoming.locations !== undefined)
            prev.locations = incoming.locations;
        if (prev.status === "in_progress" &&
            prev.content?.some((b) => b.type === "content" && b.content?.type === "image")) {
            prev.status = "completed";
        }
    };
    for (const ev of events) {
        const parsed = parseAcpEvent(ev.payload);
        switch (parsed.kind) {
            case "thought":
                out.thoughtText = mergeStreamingText(out.thoughtText, parsed.text);
                appendThought(parsed);
                break;
            case "text":
                out.currentThoughtText = "";
                if (textBuf && textPhase !== parsed.phase)
                    flushText();
                textPhase = parsed.phase;
                textBuf = mergeStreamingText(textBuf, parsed.text);
                break;
            case "tool_call":
                out.currentThoughtText = "";
                upsertTool(parsed.tool);
                break;
            case "plan":
                out.plan = parsed.updateMode === "merge"
                    && (currentPlanId === undefined
                        || parsed.planId === undefined
                        || parsed.planId === currentPlanId)
                    ? mergePlanEntries(out.plan, parsed.plan)
                    : parsed.plan;
                if (parsed.document)
                    out.planDocument = parsed.document;
                currentPlanId = parsed.planId;
                break;
            case "plan_document":
                out.planDocument = parsed.document;
                if (parsed.document)
                    currentPlanId = parsed.document.id;
                break;
            case "plan_removed":
                if (parsed.planId === undefined || parsed.planId === currentPlanId) {
                    out.plan = [];
                    out.planDocument = undefined;
                    currentPlanId = undefined;
                }
                break;
            case "note":
                out.notes.push(parsed.note);
                break;
            case "commands":
            case "notice":
            case "silent":
                break;
            case "raw":
                // Drop raw events from the primary chat surface. They are still
                // available in the persisted event stream for debugging.
                break;
        }
    }
    // Flush any trailing assistant text so the closing message segment
    // makes it into the timeline.
    flushText();
    out.tools = toolsOrder
        .map((id) => toolById.get(id))
        .filter((e) => !!e);
    // For back-compat with code still reading TurnRender.assistantText —
    // the streaming track and a few legacy spots — concatenate the segments.
    out.assistantText = out.timeline
        .filter((t) => t.kind === "assistant_text")
        .map((t) => t.text)
        .join("");
    return out;
}
export function latestThoughtSegment(text) {
    if (/\n{2,}\s*$/.test(text))
        return "";
    const segments = text
        .split(/\n{2,}/)
        .map((segment) => segment.trim())
        .filter(Boolean);
    return segments.at(-1) ?? "";
}
//# sourceMappingURL=acp.js.map