/**
 * OpenAI Agents → OpenMA event decoder.
 *
 * Direct port of backchat `DirectAgentRuntime` at `64fd74d`
 * (`src/main/direct-agent-runtime.ts`): `#item`, `#turn`, `#openaiEvent`,
 * `#pending`, `#vendor`, and `#event`. `#wrap` stays in backchat; it only
 * builds the desktop task envelope around the canonical event.
 * `pendingActions` / `custom_result` stay there too.
 * `decodeOpenAIAgentsPendingActions` returns the `required_actions` vendor
 * event plus the `function_call` entries themselves.
 *
 * Input types are structural on purpose. That commit duck-types items
 * (`"status" in item`, `type.endsWith("_call")`) instead of switching on the
 * SDK union, and the contract is byte-for-byte output against that commit.
 * An optional `openai` peer would not make the mapping exhaustive the way
 * `@anthropic-ai/sdk` does for Managed Agents.
 */
import {
  createOpenMAEvent,
  createVendorEvent,
  type CanonicalEventType,
  type OpenMAEvent,
} from "../../session-events/openma.js";

const SOURCE = { kind: "harness", harness: "openai-agents" } as const;

const TURN_EVENT_TYPES = {
  completed: "turn.completed",
  failed: "turn.failed",
  cancelled: "turn.cancelled",
  queued: "turn.queued",
  in_progress: "session.running",
  waiting: "session.running",
} as const satisfies Record<string, CanonicalEventType>;

export interface OpenAIAgentsDecodeContext {
  sessionId: string;
  /**
   * Replaces `new Date()` in the backchat mapper. Turn events ignore this
   * and use `completed_at ?? created_at` (Unix seconds → ISO).
   */
  now: () => string;
}

export interface OpenAIAgentsPendingContext extends OpenAIAgentsDecodeContext {
  /**
   * History supplies `required:${uuid}`. Stream session events derive
   * `${event_id}:required` themselves.
   */
  eventId: string;
}

export interface OpenAIAgentsItem {
  type: string;
  id?: string | null;
  turn_id?: string;
  status?: string;
  role?: string;
  content?: unknown;
  summary?: unknown;
  call_id?: string;
  output?: unknown;
  error?: unknown;
  name?: unknown;
  arguments?: unknown;
  command?: unknown;
  [key: string]: unknown;
}

export interface OpenAIAgentsTurn {
  id: string;
  status: string;
  created_at: number;
  completed_at?: number | null;
  error?: { message?: string; [key: string]: unknown } | null;
  [key: string]: unknown;
}

export interface OpenAIAgentsRequiredAction {
  type: string;
  call_id?: string;
  name?: string;
  arguments?: unknown;
  turn_id?: string;
  [key: string]: unknown;
}

export interface OpenAIAgentsSessionSnapshot {
  status?: string;
  error?: unknown;
  required_actions?: readonly OpenAIAgentsRequiredAction[];
  [key: string]: unknown;
}

export interface OpenAIAgentsStreamEvent {
  type: string;
  event_id: string;
  item_id?: string;
  delta?: string;
  turn_id?: string | null;
  item?: OpenAIAgentsItem;
  turn?: OpenAIAgentsTurn;
  session?: OpenAIAgentsSessionSnapshot;
  [key: string]: unknown;
}

/** Fields backchat reads off a pending `function_call`. Not `custom_result`. */
export interface OpenAIAgentsPendingFunctionCall {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: unknown;
  turn_id: string;
}

export interface OpenAIAgentsPendingResult {
  event: OpenMAEvent;
  functionCalls: OpenAIAgentsPendingFunctionCall[];
}

/** Same expression as backchat `64fd74d`: `b.text ?? ""`, joined with `""`. */
function contentText(content: unknown): string {
  return typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((block: { text?: unknown }) => block.text ?? "").join("")
      : "";
}

function isoFromSeconds(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function canonical(
  context: OpenAIAgentsDecodeContext,
  id: string,
  type: CanonicalEventType,
  data: unknown,
  turnId?: string,
  occurredAt = context.now(),
): OpenMAEvent {
  return createOpenMAEvent({
    event_id: id,
    session_id: context.sessionId,
    ...(turnId ? { turn_id: turnId } : {}),
    source: SOURCE,
    occurred_at: occurredAt,
    type,
    data,
  }) as OpenMAEvent;
}

function vendor(
  context: OpenAIAgentsDecodeContext,
  id: string,
  name: string,
  data: unknown,
  turnId?: string,
): OpenMAEvent {
  return createVendorEvent({
    event_id: id,
    session_id: context.sessionId,
    ...(turnId ? { turn_id: turnId } : {}),
    source: SOURCE,
    occurred_at: context.now(),
    harness: "openai-agents",
    namespace: "agents",
    name,
    data,
  });
}

export function decodeOpenAIAgentsItem(
  item: OpenAIAgentsItem,
  context: OpenAIAgentsDecodeContext,
): OpenMAEvent {
  const id = item.id ?? `${item.turn_id}:user`;
  if (item.type === "message") {
    return canonical(
      context,
      `item:${id}:${item.status}`,
      item.role === "user" ? "user.message" : "agent.message",
      { message_id: id, text: contentText(item.content), content: item.content },
      item.turn_id,
    );
  }
  if (item.type === "reasoning") {
    return canonical(
      context,
      `item:${id}`,
      "agent.thinking",
      { message_id: id, text: contentText(item.summary) },
      item.turn_id,
    );
  }
  if (item.type === "function_call_output") {
    return canonical(
      context,
      `item:${id}`,
      item.status === "failed" ? "tool.failed" : "tool.completed",
      { tool_call_id: item.call_id, raw_output: item.output, error: item.error },
      item.turn_id,
    );
  }
  if ("status" in item && (item.type.endsWith("_call") || item.type === "command_execution")) {
    const value = item as unknown as Record<string, unknown>;
    return canonical(
      context,
      `item:${id}:${value.status}`,
      value.status === "failed"
        ? "tool.failed"
        : value.status === "completed"
          ? "tool.completed"
          : "tool.started",
      {
        tool_call_id: value.call_id ?? id,
        tool_name: value.name ?? item.type,
        title: value.name ?? item.type,
        raw_input: value.arguments ?? value.command ?? item,
        raw_output: value.output,
        error: value.error,
      },
      item.turn_id,
    );
  }
  return vendor(context, `item:${id}`, item.type, item, item.turn_id);
}

export function decodeOpenAIAgentsTurn(
  turn: OpenAIAgentsTurn,
  context: OpenAIAgentsDecodeContext,
): OpenMAEvent {
  const type = TURN_EVENT_TYPES[turn.status as keyof typeof TURN_EVENT_TYPES];
  return canonical(
    context,
    `turn:${turn.id}:${turn.status}`,
    type as CanonicalEventType,
    { error: turn.error, message: turn.error?.message },
    turn.id,
    isoFromSeconds((turn.completed_at ?? turn.created_at) as number),
  );
}

export function decodeOpenAIAgentsPendingActions(
  session: OpenAIAgentsSessionSnapshot,
  context: OpenAIAgentsPendingContext,
): OpenAIAgentsPendingResult {
  const actions = session.required_actions ?? [];
  const functionCalls = actions.flatMap((action): OpenAIAgentsPendingFunctionCall[] => {
    if (action.type !== "function_call") return [];
    return [{
      type: "function_call",
      call_id: action.call_id,
      name: action.name,
      arguments: action.arguments,
      turn_id: action.turn_id,
    } as OpenAIAgentsPendingFunctionCall];
  });
  return {
    event: vendor(context, context.eventId, "required_actions", actions),
    functionCalls,
  };
}

export function decodeOpenAIAgentsStreamEvent(
  event: OpenAIAgentsStreamEvent,
  context: OpenAIAgentsDecodeContext,
): OpenMAEvent[] {
  if (
    event.type === "agent.session.turn.item.added"
    || event.type === "agent.session.turn.item.done"
  ) {
    return [decodeOpenAIAgentsItem(event.item as OpenAIAgentsItem, context)];
  }
  if (event.type === "agent.session.turn.output_text.delta") {
    return [canonical(
      context,
      event.event_id,
      "agent.message_chunk",
      { message_id: event.item_id, text: event.delta },
      event.turn_id ?? undefined,
    )];
  }
  if ("turn" in event) {
    return [decodeOpenAIAgentsTurn(event.turn as OpenAIAgentsTurn, context)];
  }
  if ("session" in event) {
    const session = event.session as OpenAIAgentsSessionSnapshot;
    const type = session.status === "idle"
      ? "session.idle"
      : session.status === "failed"
        ? "session.error"
        : "session.running";
    return [
      canonical(context, event.event_id, type, { message: session.error }),
      decodeOpenAIAgentsPendingActions(session, {
        ...context,
        eventId: `${event.event_id}:required`,
      }).event,
    ];
  }
  const turnId = "turn_id" in event ? event.turn_id ?? undefined : undefined;
  return [vendor(context, event.event_id, event.type, event, turnId)];
}
