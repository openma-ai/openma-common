import {
  latestThoughtSegment,
  type ToolEntry,
  type TurnRender,
} from "./acp.js";

export interface WireSessionEvent {
  type: string;
  [key: string]: unknown;
}

export type ToolFamily = "builtin" | "custom" | "mcp";

export interface CanonicalTool {
  id: string;
  family: ToolFamily;
  name: string;
  input?: unknown;
  output?: unknown;
  status: "pending" | "running" | "completed" | "failed";
  isError?: boolean;
  rawUse?: WireSessionEvent;
  rawResult?: WireSessionEvent;
}

export type NormalizedSessionEvent =
  | { kind: "user_message"; id: string; text: string; raw: WireSessionEvent }
  | { kind: "assistant_delta"; id: string; text: string; raw: WireSessionEvent }
  | { kind: "assistant_message"; id: string; text: string; raw: WireSessionEvent }
  | { kind: "assistant_stream_end"; id?: string; raw: WireSessionEvent }
  | { kind: "thinking_delta"; id: string; text: string; raw: WireSessionEvent }
  | { kind: "thinking"; id: string; text: string; raw: WireSessionEvent }
  | { kind: "thinking_stream_end"; id?: string; raw: WireSessionEvent }
  | { kind: "tool_input_start"; toolId: string; name: string; raw: WireSessionEvent }
  | { kind: "tool_use"; tool: CanonicalTool; raw: WireSessionEvent }
  | { kind: "tool_result"; toolId: string; output: unknown; isError: boolean; raw: WireSessionEvent }
  | { kind: "notice"; tone: "warning" | "error"; message: string; source?: string; raw: WireSessionEvent }
  | { kind: "turn_running"; raw: WireSessionEvent }
  | { kind: "turn_complete"; raw: WireSessionEvent }
  | { kind: "turn_terminated"; raw: WireSessionEvent }
  | { kind: "ignore"; raw: WireSessionEvent };

export type ConversationItem =
  | {
      kind: "message";
      id: string;
      role: "user" | "assistant";
      text: string;
      raw: WireSessionEvent;
    }
  | { kind: "thinking"; id: string; text: string; raw: WireSessionEvent }
  | { kind: "tool"; id: string; tool: CanonicalTool; raw: WireSessionEvent }
  | {
      kind: "notice";
      id: string;
      tone: "warning" | "error";
      message: string;
      source?: string;
      cause?: { error: string; model?: string };
      raw: WireSessionEvent;
    };

export interface ConversationTurn {
  id: string;
  status: "running" | "completed" | "errored" | "terminated";
  items: ConversationItem[];
  rawEvents: WireSessionEvent[];
}

export interface CanonicalChatTurn {
  id: string;
  status: ConversationTurn["status"];
  userText: string;
  render: TurnRender;
  rawEvents: WireSessionEvent[];
}

function stringField(event: WireSessionEvent, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = event[name];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

export function eventText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      const value = (block as { text?: unknown }).text;
      return typeof value === "string" ? value : "";
    })
    .filter(Boolean)
    .join("\n");
}

export function eventThreadId(event: WireSessionEvent): string {
  return stringField(event, "session_thread_id") ?? "sthr_primary";
}

export function eventStableId(event: WireSessionEvent, fallback: string): string {
  return stringField(event, "id", "event_id", "message_id", "thinking_id", "tool_use_id", "mcp_tool_use_id") ?? fallback;
}

function toolFamily(type: string): ToolFamily {
  if (type.includes("mcp_")) return "mcp";
  if (type.includes("custom_")) return "custom";
  return "builtin";
}

export function normalizeSessionEvent(event: WireSessionEvent): NormalizedSessionEvent {
  switch (event.type) {
    case "turn.queued":
    case "user.message": {
      const data = (event.data && typeof event.data === "object")
        ? (event.data as { content?: unknown; text?: string })
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
      return { kind: "turn_running", raw: event };
    case "session.status_idle":
      return { kind: "turn_complete", raw: event };
    case "session.status_terminated":
      return { kind: "turn_terminated", raw: event };
    default:
      return { kind: "ignore", raw: event };
  }
}

function modelError(event: WireSessionEvent): { error: string; model?: string } | null {
  if (event.type !== "span.model_request_end") return null;
  const data = event.data && typeof event.data === "object"
    ? event.data as Record<string, unknown>
    : event;
  if (data.finish_reason !== "error" || typeof data.error_message !== "string") return null;
  return {
    error: data.error_message,
    ...(typeof data.model === "string" ? { model: data.model } : {}),
  };
}

/** A `user.message` the server has accepted but not processed yet.
 *
 * Official Managed Agents semantics: `processed_at` is `null` while a
 * `user.message` waits behind the running turn; the same event id is
 * re-emitted with a timestamp once processing finishes. Queued messages are
 * kept out of `turns` so they never split the running turn. */
export interface QueuedUserMessage {
  id: string;
  text: string;
  /** `pending`: server reported `processed_at: null`. `deferred`: the
   * server stamped it (legacy accept-time stamping) but it arrived while the
   * current turn was still running, so it waits for that turn to end. */
  reason: "pending" | "deferred";
  raw: WireSessionEvent;
}

export interface ConversationProjectionOptions {
  threadId?: string;
  /** Treat a timestamped `user.message` that arrives while the current turn
   * has not reached idle/terminated as queued until that turn ends. This is
   * the fallback for servers that stamp `processed_at` at accept time.
   * Default: true. */
  deferMidTurnUserMessages?: boolean;
}

export interface ConversationProjection {
  turns: ConversationTurn[];
  queued: QueuedUserMessage[];
}

export interface CanonicalChatProjection {
  turns: CanonicalChatTurn[];
  queued: QueuedUserMessage[];
}

function isPendingUserMessage(event: WireSessionEvent): boolean {
  // Prefer OpenMA delivery (GUI-facing). Fall back to CMA processed_at only
  // inside this adapter module — callers outside protocol/managed should not
  // set processed_at.
  if (event.type === "turn.queued") return true;
  if (event.delivery === "queued") return true;
  if (event.type === "user.message" && event.delivery === "processed") return false;
  return event.type === "user.message" && "processed_at" in event && event.processed_at === null;
}

/** Collapse repeated copies of the same user message id: a stamped
 * `user.message` wins over a prior `turn.queued` / delivery:queued echo. */
function userMessageLikeId(event: WireSessionEvent): string | undefined {
  if (event.type !== "user.message" && event.type !== "turn.queued") return undefined;
  const id = eventStableId(event, "");
  return id || undefined;
}

function dedupeUserMessages(events: readonly WireSessionEvent[]): WireSessionEvent[] {
  const stamped = new Map<string, number>();
  const last = new Map<string, number>();
  events.forEach((event, index) => {
    const id = userMessageLikeId(event);
    if (!id) return;
    last.set(id, index);
    if (!isPendingUserMessage(event)) stamped.set(id, index);
  });
  return events.filter((event, index) => {
    const id = userMessageLikeId(event);
    if (!id) return true;
    const keep = stamped.get(id) ?? last.get(id);
    return keep === index;
  });
}

export function projectConversationTurns(
  events: readonly WireSessionEvent[],
  options: ConversationProjectionOptions = {},
): ConversationTurn[] {
  return projectConversation(events, options).turns;
}

/** Project turns plus the queue of accepted-but-unprocessed user messages. */
export function projectConversation(
  events: readonly WireSessionEvent[],
  options: ConversationProjectionOptions = {},
): ConversationProjection {
  const threadId = options.threadId ?? "sthr_primary";
  const deferMidTurn = options.deferMidTurnUserMessages ?? true;
  const filtered = dedupeUserMessages(events.filter((event) => eventThreadId(event) === threadId));
  const results = new Map<string, Extract<NormalizedSessionEvent, { kind: "tool_result" }>>();
  for (const event of filtered) {
    const normalized = normalizeSessionEvent(event);
    if (normalized.kind === "tool_result") results.set(normalized.toolId, normalized);
  }

  const pending: Array<{ order: number; message: QueuedUserMessage }> = [];
  const deferred: Array<{ order: number; event: WireSessionEvent; normalized: Extract<NormalizedSessionEvent, { kind: "user_message" }> }> = [];
  let flushedTurn: { turn: ConversationTurn; order: number; event: WireSessionEvent; normalized: Extract<NormalizedSessionEvent, { kind: "user_message" }> } | undefined;
  const turns: ConversationTurn[] = [];
  let current: ConversationTurn | undefined;
  let pendingModelError: { error: string; model?: string } | null = null;

  const ensureTurn = (event: WireSessionEvent) => {
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

  const openUserTurn = (
    event: WireSessionEvent,
    normalized: Extract<NormalizedSessionEvent, { kind: "user_message" }>,
  ): ConversationTurn => {
    const turn: ConversationTurn = {
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
    current = undefined;
    flushedTurn = undefined;
    const next = deferred.shift();
    if (next) flushedTurn = { turn: openUserTurn(next.event, next.normalized), ...next };
  };

  for (const [order, event] of filtered.entries()) {
    const cause = modelError(event);
    if (cause) pendingModelError = cause;
    const normalized = normalizeSessionEvent(event);
    if (normalized.kind === "user_message") {
      if (isPendingUserMessage(event)) {
        pending.push({ order, message: { id: normalized.id, text: normalized.text, reason: "pending", raw: event } });
        continue;
      }
      const active = current as ConversationTurn | undefined;
      const busy = active !== undefined
        && active.status === "running"
        && active.items.some((item) => item.kind === "message" && item.role === "user");
      if (deferMidTurn && (busy || deferred.length > 0)) {
        deferred.push({ order, event, normalized });
        continue;
      }
      flushedTurn = undefined;
      openUserTurn(event, normalized);
      continue;
    }
    const turn = ensureTurn(event);
    if (flushedTurn?.turn === turn) flushedTurn = undefined;
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
        const tool: CanonicalTool = result
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
        if (turn.status === "running") turn.status = "completed";
        endTurn();
        break;
      case "turn_terminated":
        turn.status = "terminated";
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
      message: { id: normalized.id, text: normalized.text, reason: "deferred" as const, raw: event },
    })),
  ].sort((left, right) => left.order - right.order).map(({ message }) => message);
  return { turns: turns.filter((turn) => turn.items.length > 0), queued };
}

/** Adapt Managed's event vocabulary to the richer ACP/Backchat render model.
 * The renderer can therefore consume one `TurnRender` whether events came
 * from a local ACP child or OpenManaged's cloud/local runtime. */
export function projectCanonicalChatTurns(
  events: readonly WireSessionEvent[],
  options: ConversationProjectionOptions = {},
): CanonicalChatTurn[] {
  return projectCanonicalChat(events, options).turns;
}

/** Canonical chat turns plus queued user messages (see `QueuedUserMessage`). */
export function projectCanonicalChat(
  events: readonly WireSessionEvent[],
  options: ConversationProjectionOptions = {},
): CanonicalChatProjection {
  const projection = projectConversation(events, options);
  return { queued: projection.queued, turns: projection.turns.map((turn) => {
    const render: TurnRender = {
      thoughtText: "",
      currentThoughtText: "",
      assistantText: "",
      tools: [],
      plan: [],
      notes: [],
      timeline: [],
    };
    const userParts: string[] = [];
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
      const status: ToolEntry["status"] =
        tool.status === "running" ? "in_progress" : tool.status;
      const entry: ToolEntry = {
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
    if (turn.status !== "running") render.currentThoughtText = "";
    return {
      id: turn.id,
      status: turn.status,
      userText: userParts.join("\n"),
      render,
      rawEvents: turn.rawEvents,
    };
  }) };
}

/** @deprecated Use @openma/common/protocol/managed for the v2 SDK codec. */
export * from "../protocol/managed/index.js";
