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
  return stringField(event, "id", "message_id", "thinking_id", "tool_use_id", "mcp_tool_use_id") ?? fallback;
}

function toolFamily(type: string): ToolFamily {
  if (type.includes("mcp_")) return "mcp";
  if (type.includes("custom_")) return "custom";
  return "builtin";
}

export function normalizeSessionEvent(event: WireSessionEvent): NormalizedSessionEvent {
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

export function projectConversationTurns(
  events: readonly WireSessionEvent[],
  options: { threadId?: string } = {},
): ConversationTurn[] {
  const threadId = options.threadId ?? "sthr_primary";
  const filtered = events.filter((event) => eventThreadId(event) === threadId);
  const results = new Map<string, Extract<NormalizedSessionEvent, { kind: "tool_result" }>>();
  for (const event of filtered) {
    const normalized = normalizeSessionEvent(event);
    if (normalized.kind === "tool_result") results.set(normalized.toolId, normalized);
  }

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

  for (const event of filtered) {
    const cause = modelError(event);
    if (cause) pendingModelError = cause;
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
