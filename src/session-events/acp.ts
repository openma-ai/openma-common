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
 * reduceTurn is the pure convenience wrapper; live callers retain a projector
 * and apply only newly received events.
 */

import { extractAcpSystemNotice } from "./acp-system-notices.js";

export { extractAcpSystemNotice, type AcpSystemNotice } from "./acp-system-notices.js";

/** Internal transport context added when the ACP SDK gives OpenMA a
 * notification-scoped `_meta` alongside `params.update`. The explicit key
 * keeps wire-layer metadata separate from update/harness `_meta` while the
 * existing flat update shape remains compatible with consumers. */
export const ACP_NOTIFICATION_CONTEXT_KEY = "_openma.acp.notification" as const;

export function preserveAcpNotificationContext(params: unknown): unknown {
  if (!params || typeof params !== "object") return params;
  const notification = params as Record<string, unknown>;
  if (!("update" in notification)) return params;
  const update = notification.update;
  if (!update || typeof update !== "object") return update;
  const notificationMeta = notification._meta;
  if (!notificationMeta || typeof notificationMeta !== "object") return update;
  return {
    ...(update as Record<string, unknown>),
    [ACP_NOTIFICATION_CONTEXT_KEY]: {
      ...(typeof notification.sessionId === "string"
        ? { session_id: notification.sessionId }
        : {}),
      meta: notificationMeta,
    },
  };
}

export interface ChunkText {
  text: string;
}

export interface ToolEntry {
  toolCallId: string;
  title?: string;
  kind?: string;
  status?: "pending" | "in_progress" | "completed" | "failed" | string;
  rawInput?: unknown;
  rawOutput?: unknown;
  toolName?: string;
  /** Vendor/implementation extension data carried by ACP `_meta`. ACP
   *  explicitly reserves this shape for custom protocol details. */
  meta?: Record<string, unknown>;
  /** Known vendor extension used by claude-agent-acp to associate subagent
   *  child tool calls with the parent Task/Agent tool use. */
  parentToolUseId?: string;
  /** ACP tool content blocks. Each block is one of:
   *    { type: "content", content: { type: "text" | "image" | ..., ... } }
   *    { type: "diff", path, oldText, newText }
   *    { type: "terminal", terminalId }
   *  Patch semantics on tool_call_update: when content arrives in an
   *  update, REPLACE the array (matches Zed's reference client). */
  content?: ToolContentBlock[];
  /** Files / URLs the tool touched. Renderer turns these into clickable
   *  links above the disclosure. */
  locations?: Array<{ path?: string; line?: number }>;
}

interface ToolOutputDelta {
  data: string;
  /** Terminal output is byte-stream-like; MCP progress is line-oriented. */
  separator: string;
}

interface NormalizedToolPatch extends Partial<ToolEntry> {
  toolCallId: string;
  /** Incoming-only adapter extension data consumed by reduceTurn. */
  outputDelta?: ToolOutputDelta;
}

export type ToolContentBlock =
  | {
      type: "content";
      content?: {
        type?: string;
        text?: string;
        uri?: string;
        name?: string;
        mimeType?: string;
        data?: string;
      };
    }
  | { type: "diff"; path?: string; oldText?: string; newText?: string }
  | { type: "terminal"; terminalId?: string };

export interface PlanEntry {
  id?: string;
  content: string;
  status?: "pending" | "in_progress" | "completed" | "cancelled";
  priority?: "high" | "medium" | "low";
}

export interface PlanDocument {
  id?: string;
  title?: string;
  type?: "markdown" | "file";
  markdown?: string;
  uri?: string;
}

export interface SessionCompaction {
  id: string;
  status: string;
  summary?: unknown[];
  error?: string;
  meta?: Record<string, unknown>;
}

export type TimelineItem =
  | { kind: "compaction"; compaction: SessionCompaction }
  | {
      /** Adjacent assistant chunks in the same phase and message append here. */
      kind: "assistant_text";
      segmentId?: number;
      text: string;
      phase?: "commentary" | "final_answer";
    }
  | {
      /** Adjacent chunks sharing a messageId patch the open thought item. */
      kind: "thought";
      segmentId?: number;
      messageId?: string;
      text: string;
    }
  | {
      /** Pointer to a ToolEntry; the renderer looks the entry up in `tools`
       *  by id rather than embedding it inline so tool_call_update events
       *  that PATCH the tool still flow through. */
      kind: "tool";
      toolCallId: string;
    }
  | {
      kind: "user_input";
      text: string;
      clientId?: string;
      attachments?: unknown[];
      annotations?: unknown[];
      startedAt?: string;
    };

export interface TurnRender {
  thoughtText: string;
  /** The latest text from the open thought segment, if one exists. */
  currentThoughtText: string;
  assistantText: string;
  tools: ToolEntry[];
  plan: PlanEntry[];
  planDocument?: PlanDocument;
  /** Synthetic runtime notes that belong in the activity transcript. */
  notes: string[];
  /** Time-ordered list of "what to render between thought and assistant
   *  tail". Assistant message chunks and tool_calls interleave in the
   *  ACP stream — agents say "I'll look at X", call read_text_file,
   *  then say "now I'll edit Y" and call write_text_file. Lumping all
   *  text after all tools (the old behavior) reads as "did a bunch of
   *  things, then explained". This list preserves the order. */
  timeline: TimelineItem[];
}

interface AcpContentText {
  type?: string;
  text?: string;
}

interface ChunkPayload {
  sessionUpdate?: string;
  content?: AcpContentText;
}

interface ToolCallPayload {
  sessionUpdate?: string;
  toolCallId?: string;
  title?: string;
  kind?: string;
  status?: ToolEntry["status"];
  rawInput?: unknown;
  rawOutput?: unknown;
  content?: ToolContentBlock[];
  locations?: ToolEntry["locations"];
}

interface PlanPayload {
  sessionUpdate?: string;
  entries?: PlanEntry[];
}

export interface AvailableCommand {
  name: string;
  description?: string;
  input?: { hint?: string } | null;
}

export type ParsedAcpEvent =
  | {
      kind: "text";
      text: string;
      phase?: "commentary" | "final_answer";
      messageId?: string;
      /** Claude Agent ACP's nested transcript correlation. */
      parentToolUseId?: string;
      event: unknown;
    }
  | {
      kind: "thought";
      text: string;
      messageId?: string;
      /** Claude Agent ACP's nested transcript correlation. */
      parentToolUseId?: string;
      event: unknown;
    }
  | {
      kind: "user_input";
      text: string;
      clientId?: string;
      attachments?: unknown[];
      annotations?: unknown[];
      startedAt?: string;
      event: unknown;
    }
  | { kind: "notice"; notice: string; event: unknown }
  | { kind: "tool_call"; tool: NormalizedToolPatch; event: unknown }
  | { kind: "commands"; commands: AvailableCommand[]; event: unknown }
  | {
      kind: "plan";
      planId?: string;
      updateMode?: "replace" | "merge";
      plan: PlanEntry[];
      document?: PlanDocument;
      event: unknown;
    }
  | { kind: "plan_document"; document?: PlanDocument; event: unknown }
  | { kind: "plan_removed"; planId?: string; event: unknown }
  | { kind: "note"; note: string; event: unknown }
  | { kind: "silent"; event: unknown }
  | { kind: "raw"; event: unknown };

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

export function sessionUpdateInner(event: unknown): Record<string, unknown> {
  const ev = event as
    | { update?: Record<string, unknown>; sessionUpdate?: string }
    | null
    | undefined;
  const update = ev?.update;
  return (update && typeof update === "object" ? update : ev ?? {}) as Record<
    string,
    unknown
  >;
}

export function sessionUpdateType(event: unknown): string | undefined {
  const inner = sessionUpdateInner(event);
  const ev = event as { sessionUpdate?: unknown } | null | undefined;
  const rawType = typeof inner.type === "string" ? inner.type : undefined;
  const innerUpdate =
    typeof inner.sessionUpdate === "string" ? inner.sessionUpdate : undefined;
  const outerUpdate =
    typeof ev?.sessionUpdate === "string" ? ev.sessionUpdate : undefined;
  return (
    innerUpdate ??
    outerUpdate ??
    (rawType && ACP_SESSION_UPDATE_TYPES.has(rawType) ? rawType : undefined)
  );
}

function stringField(raw: Record<string, unknown>, names: string[]): string | undefined {
  for (const name of names) {
    const value = raw[name];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function normalizeToolCall(
  raw: Record<string, unknown>,
): NormalizedToolPatch {
  const meta = objectField(raw._meta);
  const claudeMeta = objectField(meta.claudeCode);
  const toolCallId = raw.toolCallId ?? raw.tool_call_id ?? raw.id;
  const entry: NormalizedToolPatch = {
    toolCallId: String(toolCallId ?? ""),
  };
  if (Object.keys(meta).length > 0) entry.meta = meta;
  const title = raw.title ?? raw.name ?? raw.toolName ?? raw.tool_name;
  if (typeof title === "string") entry.title = title;
  if (typeof raw.kind === "string") entry.kind = raw.kind;
  if (typeof raw.status === "string") entry.status = raw.status;
  const rawInput = raw.rawInput ?? raw.raw_input ?? raw.input ?? raw.args;
  const rawOutput = raw.rawOutput ?? raw.raw_output ?? raw.output ?? raw.result;
  if (rawInput !== undefined && rawInput !== null) entry.rawInput = rawInput;
  if (rawOutput !== undefined && rawOutput !== null) entry.rawOutput = rawOutput;
  if (rawOutput === undefined || rawOutput === null) {
    const terminalOutput = objectField(meta.terminal_output);
    const terminalOutputDelta = objectField(meta.terminal_output_delta);
    const mcpOutputDelta = objectField(meta.mcp_output_delta);
    const terminalData = stringValue(terminalOutput.data) ?? stringValue(terminalOutputDelta.data);
    const mcpData = stringValue(mcpOutputDelta.data);
    if (terminalData !== undefined) {
      entry.outputDelta = { data: terminalData, separator: "" };
    } else if (mcpData !== undefined) {
      entry.outputDelta = { data: mcpData, separator: "\n" };
    }
  }
  if (entry.status === undefined) {
    const terminalExit = objectField(meta.terminal_exit);
    const exitCode = terminalExit.exit_code ?? terminalExit.exitCode;
    const signal = terminalExit.signal;
    if (typeof exitCode === "number") {
      entry.status = exitCode === 0 ? "completed" : "failed";
    } else if (typeof signal === "string" && signal.length > 0) {
      entry.status = "failed";
    }
  }
  if (Array.isArray(raw.content)) entry.content = raw.content as ToolContentBlock[];
  if (Array.isArray(raw.locations)) entry.locations = raw.locations as ToolEntry["locations"];
  const toolName = claudeMeta.toolName ?? raw.toolName ?? raw.tool_name ?? raw.name;
  if (typeof toolName === "string") entry.toolName = toolName;
  const parentToolUseId =
    stringValue(claudeMeta.parentToolUseId) ??
    stringValue(raw.parentToolUseId) ??
    stringValue(raw.parent_tool_use_id);
  if (parentToolUseId) entry.parentToolUseId = parentToolUseId;
  return entry;
}

function normalizeCanonicalToolEvent(
  event: Record<string, unknown>,
): NormalizedToolPatch | null {
  const type = stringValue(event.type);
  if (
    type !== "tool.started"
    && type !== "tool.progress"
    && type !== "tool.completed"
    && type !== "tool.failed"
    && type !== "tool.cancelled"
  ) return null;
  const data = objectField(event.data);
  const toolCallId = stringField(data, ["tool_call_id", "toolCallId", "id"]);
  if (!toolCallId) return null;
  const tool = normalizeToolCall({
    toolCallId,
    ...(data.title !== undefined ? { title: data.title } : {}),
    ...(data.kind !== undefined ? { kind: data.kind } : {}),
    ...(data.status !== undefined ? { status: data.status } : {}),
    ...(data.raw_input !== undefined ? { rawInput: data.raw_input } : {}),
    ...(data.rawInput !== undefined ? { rawInput: data.rawInput } : {}),
    ...(data.raw_output !== undefined ? { rawOutput: data.raw_output } : {}),
    ...(data.rawOutput !== undefined ? { rawOutput: data.rawOutput } : {}),
    ...(
      data.raw_output === undefined
      && data.rawOutput === undefined
      && typeof data.error === "string"
        ? { rawOutput: data.error }
        : {}
    ),
    ...(data.content !== undefined ? { content: data.content } : {}),
    ...(data.locations !== undefined ? { locations: data.locations } : {}),
    ...(data.tool_name !== undefined ? { toolName: data.tool_name } : {}),
    ...(data.adapter_meta !== undefined ? { _meta: data.adapter_meta } : {}),
    ...(event.parent_id !== undefined ? { parentToolUseId: event.parent_id } : {}),
  });
  if (type === "tool.completed") tool.status = "completed";
  if (type === "tool.failed") tool.status = "failed";
  if (type === "tool.cancelled") tool.status = "cancelled";
  const output = objectField(data.output);
  const outputData = stringValue(output.data);
  if (tool.rawOutput === undefined && outputData !== undefined) {
    tool.outputDelta = {
      data: outputData,
      separator:
        typeof output.separator === "string"
          ? output.separator
          : output.kind === "mcp"
            ? "\n"
            : "",
    };
  }
  return tool;
}

function objectField(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function messageIdFrom(raw: Record<string, unknown>): string | undefined {
  return stringField(raw, ["messageId", "message_id"]);
}

function parentToolUseIdFrom(raw: Record<string, unknown>): string | undefined {
  const meta = objectField(raw._meta);
  const claudeMeta = objectField(meta.claudeCode);
  return (
    stringValue(claudeMeta.parentToolUseId) ??
    stringValue(raw.parentToolUseId) ??
    stringValue(raw.parent_tool_use_id)
  );
}

function codexMessagePhase(
  raw: Record<string, unknown>,
): "commentary" | "final_answer" | undefined {
  if (raw.phase === "commentary" || raw.phase === "final_answer") {
    return raw.phase;
  }
  const codex = objectField(objectField(raw._meta).codex);
  return codex.phase === "commentary" || codex.phase === "final_answer"
    ? codex.phase
    : undefined;
}

function extractContentText(inner: Record<string, unknown>): string | undefined {
  if (typeof inner.text === "string") return inner.text;
  if (typeof inner.delta === "string") return inner.delta;
  if (typeof inner.content === "string") return inner.content;
  const content = inner.content as
    | { type?: string; text?: string; content?: unknown }
    | undefined;
  if (typeof content?.text === "string") return content.text;
  if (typeof content?.content === "string") return content.content;
  if (content?.content && typeof content.content === "object") {
    const nested = content.content as { text?: string };
    if (typeof nested.text === "string") return nested.text;
  }
  return undefined;
}

function extractTextBlocks(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const text = value
      .map((part) => {
        if (!part || typeof part !== "object") return "";
        const block = part as { text?: unknown; content?: unknown };
        if (typeof block.text === "string") return block.text;
        if (typeof block.content === "string") return block.content;
        return "";
      })
      .join("");
    return text.length > 0 ? text : undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const block = value as { text?: unknown; content?: unknown };
  if (typeof block.text === "string") return block.text;
  if (typeof block.content === "string") return block.content;
  return undefined;
}

function isTransportDiagnosticText(text: string): boolean {
  return /^Falling back from WebSockets to HTTPS transport\./i.test(text.trim());
}

export function sanitizeThoughtText(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, "");
}

function parsePlanEntries(rawEntries: unknown): PlanEntry[] {
  if (!Array.isArray(rawEntries)) return [];
  return rawEntries
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    .map((entry) => ({
      id: typeof entry.id === "string" && entry.id.length > 0
        ? entry.id
        : undefined,
      content: typeof entry.content === "string" ? entry.content : "",
      priority:
        entry.priority === "high" ||
        entry.priority === "medium" ||
        entry.priority === "low"
          ? entry.priority
          : undefined,
      status:
        entry.status === "pending" ||
        entry.status === "in_progress" ||
        entry.status === "completed" ||
        entry.status === "cancelled"
          ? entry.status
          : "pending",
    }));
}

function getEventSummary(event: Record<string, unknown>): string | undefined {
  try {
    return JSON.stringify(event);
  } catch {
    return undefined;
  }
}

export function parseAcpEvent(event: unknown): ParsedAcpEvent {
  const eventRecord = objectField(event);
  const isCanonicalOpenMAEvent =
    eventRecord.schema_version === "oma.event.v1" ||
    eventRecord.schema === "oma.event.v1";
  const canonicalTool = isCanonicalOpenMAEvent
    ? normalizeCanonicalToolEvent(eventRecord)
    : null;
  if (canonicalTool) return { kind: "tool_call", tool: canonicalTool, event };
  const canonicalType = isCanonicalOpenMAEvent
    ? stringValue(eventRecord.type)
    : undefined;
  const canonicalData = objectField(eventRecord.data);
  if (
    canonicalType === "user.message" &&
    canonicalData.input_kind === "steering" &&
    canonicalData.outcome === "injected"
  ) {
    const text =
      stringValue(canonicalData.text)
      ?? extractTextBlocks(canonicalData.content)
      ?? "";
    const clientId = stringValue(eventRecord.turn_id);
    return {
      kind: "user_input",
      text,
      ...(clientId ? { clientId } : {}),
      ...(Array.isArray(canonicalData.attachments) ? { attachments: canonicalData.attachments } : {}),
      ...(Array.isArray(canonicalData.annotations) ? { annotations: canonicalData.annotations } : {}),
      ...(stringValue(eventRecord.occurred_at) ? { startedAt: stringValue(eventRecord.occurred_at) } : {}),
      event,
    };
  }
  if (canonicalType === "agent.message" || canonicalType === "agent.message_chunk") {
    const text =
      stringValue(canonicalData.text)
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
    const text =
      stringValue(canonicalData.text)
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
      const markdown =
        stringValue(document.markdown)
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
              type: "file" as const,
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
    const markdown =
      stringValue(document.markdown)
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
    if (
      inner.type === "agent.message_stream_start" ||
      inner.type === "agent.message_stream_end" ||
      inner.type === "agent.thinking_stream_start" ||
      inner.type === "agent.thinking_stream_end" ||
      inner.type === "agent.tool_use_input_stream_start" ||
      inner.type === "agent.tool_use_input_chunk" ||
      inner.type === "agent.tool_use_input_stream_end" ||
      inner.type === "session.status_running" ||
      inner.type === "session.status_idle" ||
      inner.type === "session.warning"
    ) {
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
    if (
      (inner.type === "tool_call" || inner.type === "tool_call_update") &&
      (typeof inner.toolCallId === "string" ||
        typeof inner.tool_call_id === "string" ||
        typeof inner.id === "string")
    ) {
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
    if (typeof text !== "string" || text.length === 0) return { kind: "silent", event };
    const notice =
      update === "agent_message_chunk" ? extractAcpSystemNotice(event) : null;
    if (notice) return { kind: "notice", notice: notice.message, event };
    if (update === "agent_message_chunk" && isTransportDiagnosticText(text)) {
      return { kind: "silent", event };
    }
    const visibleText = update === "agent_thought_chunk" ? sanitizeThoughtText(text) : text;
    if (visibleText.length === 0) return { kind: "silent", event };
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
    } as ParsedAcpEvent;
  }

  if (update === "user_message_chunk") return { kind: "silent", event };

  if (update === "tool_call" || update === "tool_call_update") {
    const toolCallId = stringField(inner, ["toolCallId", "tool_call_id", "id"]);
    if (!toolCallId) return { kind: "raw", event };
    return { kind: "tool_call", tool: normalizeToolCall(inner), event };
  }

  if (update === "plan") {
    const rawEntries = Array.isArray(inner.entries)
      ? inner.entries
      : inner.plan &&
          typeof inner.plan === "object" &&
          Array.isArray((inner.plan as { entries?: unknown }).entries)
        ? (inner.plan as { entries: unknown[] }).entries
        : [];
    return { kind: "plan", plan: parsePlanEntries(rawEntries), event };
  }

  if (update === "plan_update") {
    const plan = inner.plan && typeof inner.plan === "object"
      ? (inner.plan as Record<string, unknown>)
      : inner;
    const planId = stringField(plan, ["planId", "plan_id", "id"]);
    const content = plan.content && typeof plan.content === "object"
      ? (plan.content as Record<string, unknown>)
      : plan;
    if (Array.isArray(content.entries)) {
      return {
        kind: "plan",
        ...(planId ? { planId } : {}),
        plan: parsePlanEntries(content.entries),
        event,
      };
    }
    const markdown =
      typeof content.markdown === "string"
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
    if (!availableCommands) return { kind: "silent", event };
    return {
      kind: "commands",
      commands: availableCommands as AvailableCommand[],
      event,
    };
  }

  if (SILENT_SESSION_UPDATES.has(update)) return { kind: "silent", event };
  return { kind: "raw", event };
}

function isEmptyObject(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value !== "object") return false;
  return Object.keys(value as Record<string, unknown>).length === 0;
}

type OpenSegment =
  | {
      kind: "thought";
      messageId?: string;
      item: Extract<TimelineItem, { kind: "thought" }>;
    }
  | {
      kind: "assistant_text";
      messageId?: string;
      phase?: "commentary" | "final_answer";
      item: Extract<TimelineItem, { kind: "assistant_text" }>;
    };

export function createTurnProjector(): {
  apply(entry: { payload: unknown }): void;
  snapshot(): TurnRender;
} {
  const out: TurnRender = {
    thoughtText: "",
    currentThoughtText: "",
    assistantText: "",
    tools: [],
    plan: [],
    notes: [],
    timeline: [],
  };
  const compactionIndices = new Map<string, number>();
  const toolById = new Map<string, ToolEntry>();
  let toolsOrder: string[] = [];
  let openSegment: OpenSegment | undefined;
  let currentPlanId: string | undefined;
  const planIndexById = new Map<string, number>();
  let toolsVersion = 0;
  let snapshotToolsVersion = 0;
  let snapshotTools: ToolEntry[] = [];
  let planVersion = 0;
  let snapshotPlanVersion = 0;
  let snapshotPlan: PlanEntry[] = [];
  let timelineVersion = 0;
  let snapshotTimelineVersion = 0;
  let snapshotTimeline: TimelineItem[] = [];
  // Running concatenations of every thought / assistant segment. Segments
  // only ever grow at the end and the timeline only appends, so each chunk
  // extends these by its own text. Rebuilding them from the timeline on every
  // snapshot made a long turn's per-event cost grow with all text so far.
  let thoughtText = "";
  let assistantText = "";
  const closeOpenSegment = () => {
    openSegment = undefined;
  };
  const appendTimelineItem = (item: TimelineItem) => {
    out.timeline.push(item);
    timelineVersion += 1;
  };
  const replaceOpenTimelineItem = (item: TimelineItem) => {
    out.timeline[out.timeline.length - 1] = item;
    timelineVersion += 1;
  };
  // ACP content chunks and OpenMA `agent.*` chunk events are deltas: the
  // text of a segment is their plain concatenation. A chunk that repeats the
  // segment's tail ("4" after "#104", "\n\n" after "\n\n") is new text.
  const appendThought = (parsed: Extract<ParsedAcpEvent, { kind: "thought" }>) => {
    if (
      openSegment?.kind === "thought" &&
      openSegment.messageId === parsed.messageId
    ) {
      const item = {
        ...openSegment.item,
        text: openSegment.item.text + parsed.text,
      };
      replaceOpenTimelineItem(item);
      openSegment.item = item;
      thoughtText += parsed.text;
      return;
    }
    closeOpenSegment();
    thoughtText += parsed.text;
    const item: Extract<TimelineItem, { kind: "thought" }> = {
      kind: "thought",
      segmentId: out.timeline.length,
      text: parsed.text,
      ...(parsed.messageId ? { messageId: parsed.messageId } : {}),
    };
    appendTimelineItem(item);
    openSegment = {
      kind: "thought",
      messageId: parsed.messageId,
      item,
    };
  };
  const appendOutputDelta = (
    current: unknown,
    delta: ToolOutputDelta,
  ): unknown => {
    if (typeof current !== "string" || current.length === 0) return delta.data;
    if (
      delta.separator.length === 0
      || current.endsWith(delta.separator)
      || delta.data.startsWith(delta.separator)
    ) {
      return current + delta.data;
    }
    return current + delta.separator + delta.data;
  };
  const upsertTool = (incoming: NormalizedToolPatch): boolean => {
    const id = incoming.toolCallId;
    if (!id) return false;
    const prev = toolById.get(id);
    if (!prev) {
      const entry: ToolEntry = {
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
      if (
        entry.status === "in_progress" &&
        entry.content?.some((b) => b.type === "content" && b.content?.type === "image")
      ) {
        entry.status = "completed";
      }
      toolById.set(id, entry);
      toolsOrder.push(id);
      toolsVersion += 1;
      return true;
    }

    const next: ToolEntry = { ...prev };
    if (incoming.title !== undefined) next.title = incoming.title;
    if (incoming.kind !== undefined) next.kind = incoming.kind;
    if (incoming.status !== undefined) next.status = incoming.status;
    if (incoming.toolName !== undefined) next.toolName = incoming.toolName;
    if (incoming.meta !== undefined) {
      next.meta = {
        ...(next.meta ?? {}),
        ...incoming.meta,
      };
    }
    if (incoming.parentToolUseId !== undefined) {
      next.parentToolUseId = incoming.parentToolUseId;
    }
    if (incoming.rawInput !== undefined) {
      const incEmpty = isEmptyObject(incoming.rawInput);
      const prevHasContent = !isEmptyObject(next.rawInput);
      if (!(incEmpty && prevHasContent)) next.rawInput = incoming.rawInput;
    }
    if (incoming.rawOutput !== undefined) {
      // A native ACP rawOutput is a complete snapshot and therefore replaces
      // any adapter deltas accumulated before it.
      next.rawOutput = incoming.rawOutput;
    } else if (incoming.outputDelta !== undefined) {
      next.rawOutput = appendOutputDelta(next.rawOutput, incoming.outputDelta);
    }
    if (incoming.content !== undefined) next.content = incoming.content;
    if (incoming.locations !== undefined) next.locations = incoming.locations;
    if (
      next.status === "in_progress" &&
      next.content?.some((b) => b.type === "content" && b.content?.type === "image")
    ) {
      next.status = "completed";
    }
    toolById.set(id, next);
    toolsVersion += 1;
    return false;
  };

  const addPlanEntries = (
    incoming: readonly PlanEntry[],
    merge: boolean,
  ) => {
    if (!merge) {
      out.plan = incoming.map((entry) => ({ ...entry }));
      planIndexById.clear();
      out.plan.forEach((entry, index) => {
        if (entry.id) planIndexById.set(entry.id, index);
      });
      planVersion += 1;
      return;
    }
    let changed = false;
    for (const entry of incoming) {
      const existingIndex = entry.id
        ? planIndexById.get(entry.id)
        : undefined;
      if (existingIndex === undefined) {
        if (entry.id) planIndexById.set(entry.id, out.plan.length);
        out.plan.push({ ...entry });
        changed = true;
      } else {
        out.plan[existingIndex] = { ...entry };
        changed = true;
      }
    }
    if (changed) planVersion += 1;
  };

  const apply = ({ payload }: { payload: unknown }) => {
    const root = objectField(payload);
    const rawData = root.type === "raw.event" ? objectField(root.data) : undefined;
    const wire = sessionUpdateInner(rawData?.payload ?? payload);
    if (wire.sessionUpdate === "compaction_update" || wire.sessionUpdate === "compaction_summary_chunk") {
      if (typeof wire.compactionId !== "string" || !wire.compactionId) return;
      const chunk = wire.sessionUpdate === "compaction_summary_chunk";
      if (!chunk && typeof wire.status !== "string") return;
      if (chunk && (!wire.content || typeof wire.content !== "object")) return;
      const index = compactionIndices.get(wire.compactionId);
      const previous = index === undefined ? undefined : out.timeline[index];
      const next: SessionCompaction = {
        ...(previous?.kind === "compaction" ? previous.compaction : { id: wire.compactionId, status: "in_progress" }),
      };
      if (chunk) next.summary = [...(next.summary ?? []), wire.content];
      else {
        next.status = wire.status as string;
        if (wire.summary === null) next.summary = undefined;
        else if (Array.isArray(wire.summary)) next.summary = [...wire.summary];
        if (wire.error === null) next.error = undefined;
        else if (typeof wire.error === "string") next.error = wire.error;
        if (wire._meta === null) next.meta = undefined;
        else if (wire._meta && typeof wire._meta === "object") next.meta = wire._meta as Record<string, unknown>;
      }
      if (index === undefined) {
        closeOpenSegment();
        compactionIndices.set(next.id, out.timeline.length);
        appendTimelineItem({ kind: "compaction", compaction: next });
      } else {
        out.timeline[index] = { kind: "compaction", compaction: next };
        timelineVersion += 1;
      }
      return;
    }
    const parsed = parseAcpEvent(payload);
    switch (parsed.kind) {
      case "user_input":
        closeOpenSegment();
        appendTimelineItem({
          kind: "user_input",
          text: parsed.text,
          ...(parsed.clientId ? { clientId: parsed.clientId } : {}),
          ...(parsed.attachments ? { attachments: parsed.attachments } : {}),
          ...(parsed.annotations ? { annotations: parsed.annotations } : {}),
          ...(parsed.startedAt ? { startedAt: parsed.startedAt } : {}),
        });
        break;
      case "thought":
        appendThought(parsed);
        break;
      case "text": {
        if (
          openSegment?.kind === "assistant_text" &&
          openSegment.messageId === parsed.messageId &&
          openSegment.phase === parsed.phase
        ) {
          const item = {
            ...openSegment.item,
            text: openSegment.item.text + parsed.text,
          };
          replaceOpenTimelineItem(item);
          openSegment.item = item;
          assistantText += parsed.text;
          break;
        }
        closeOpenSegment();
        const item: Extract<TimelineItem, { kind: "assistant_text" }> = {
          kind: "assistant_text",
          segmentId: out.timeline.length,
          text: parsed.text,
          ...(parsed.phase ? { phase: parsed.phase } : {}),
        };
        appendTimelineItem(item);
        assistantText += parsed.text;
        openSegment = {
          kind: "assistant_text",
          messageId: parsed.messageId,
          phase: parsed.phase,
          item,
        };
        break;
      }
      case "tool_call": {
        const created = upsertTool(parsed.tool);
        if (created) {
          closeOpenSegment();
          appendTimelineItem({
            kind: "tool",
            toolCallId: parsed.tool.toolCallId,
          });
        }
        break;
      }
      case "plan":
        addPlanEntries(
          parsed.plan,
          parsed.updateMode === "merge" &&
            (currentPlanId === undefined ||
              parsed.planId === undefined ||
              parsed.planId === currentPlanId),
        );
        if (parsed.document) out.planDocument = parsed.document;
        currentPlanId = parsed.planId;
        break;
      case "plan_document":
        out.planDocument = parsed.document;
        if (parsed.document) currentPlanId = parsed.document.id;
        break;
      case "plan_removed":
        if (parsed.planId === undefined || parsed.planId === currentPlanId) {
          if (out.plan.length > 0) planVersion += 1;
          out.plan = [];
          planIndexById.clear();
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
      case "raw":
        break;
    }
  };

  const snapshot = (): TurnRender => {
    if (timelineVersion !== snapshotTimelineVersion) {
      snapshotTimeline = out.timeline.slice();
      snapshotTimelineVersion = timelineVersion;
    }
    const timeline = snapshotTimeline;
    if (snapshotToolsVersion !== toolsVersion) {
      snapshotTools = toolsOrder
        .map((id) => toolById.get(id))
        .filter((tool): tool is ToolEntry => !!tool);
      snapshotToolsVersion = toolsVersion;
    }
    if (snapshotPlanVersion !== planVersion) {
      snapshotPlan = out.plan.slice();
      snapshotPlanVersion = planVersion;
    }
    return {
      thoughtText,
      currentThoughtText:
        openSegment?.kind === "thought"
          ? latestThoughtSegment(openSegment.item.text)
          : "",
      assistantText,
      tools: snapshotTools,
      plan: snapshotPlan,
      planDocument: out.planDocument ? { ...out.planDocument } : undefined,
      notes: [...out.notes],
      timeline,
    };
  };

  return { apply, snapshot };
}

export function reduceTurn(events: readonly { payload: unknown }[]): TurnRender {
  const projector = createTurnProjector();
  for (const event of events) projector.apply(event);
  return projector.snapshot();
}

export function latestThoughtSegment(text: string): string {
  if (/\n{2,}\s*$/.test(text)) return "";
  const segments = text
    .split(/\n{2,}/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  return segments.at(-1) ?? "";
}

/** @deprecated Use @openma/common/protocol/acp for the SDK codec. */
export * from "../protocol/acp/index.js";
