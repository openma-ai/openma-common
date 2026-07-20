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
function codexMessagePhase(raw) {
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
        content: typeof entry.content === "string" ? entry.content : "",
        priority: entry.priority === "high" ||
            entry.priority === "medium" ||
            entry.priority === "low"
            ? entry.priority
            : undefined,
        status: entry.status === "pending" ||
            entry.status === "in_progress" ||
            entry.status === "completed"
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
                    event,
                }
                : { kind: "silent", event };
        }
        if (inner.type === "agent.thinking_chunk" && typeof inner.delta === "string") {
            const text = sanitizeThoughtText(inner.delta);
            return inner.delta.length > 0
                ? text.length > 0
                    ? { kind: "thought", text, messageId: messageIdFrom(inner), event }
                    : { kind: "silent", event }
                : { kind: "silent", event };
        }
        if (inner.type === "agent.thinking") {
            const rawText = typeof inner.text === "string" ? inner.text : extractTextBlocks(inner.content);
            const text = typeof rawText === "string" ? sanitizeThoughtText(rawText) : rawText;
            return typeof text === "string" && text.length > 0
                ? { kind: "thought", text, messageId: messageIdFrom(inner), event }
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
                event,
            };
        }
        if (inner.type === "thought" && typeof inner.text === "string" && inner.text.length > 0) {
            const text = sanitizeThoughtText(inner.text);
            return text.length > 0
                ? { kind: "thought", text, messageId: messageIdFrom(inner), event }
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
                ? { messageId: messageIdFrom(inner) }
                : {
                    phase: codexMessagePhase(inner),
                    messageId: messageIdFrom(inner),
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
        const content = plan.content && typeof plan.content === "object"
            ? plan.content
            : plan;
        if (Array.isArray(content.entries)) {
            return { kind: "plan", plan: parsePlanEntries(content.entries), event };
        }
        const markdown = typeof content.markdown === "string"
            ? content.markdown
            : typeof content.content === "string"
                ? content.content
                : undefined;
        if (markdown) {
            return {
                kind: "plan",
                plan: [{ content: markdown, status: "in_progress" }],
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
            kind: "note",
            note: typeof inner.id === "string" ? `Plan removed: ${inner.id}` : "Plan removed",
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
                rawOutput: incoming.rawOutput,
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
        if (incoming.rawOutput !== undefined)
            prev.rawOutput = incoming.rawOutput;
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
                out.plan = parsed.plan;
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