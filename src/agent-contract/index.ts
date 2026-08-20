import {
  immutableJson,
  type CallbackCategory,
  type CallbackRequestedData,
  type CallbackRequestedEvent,
  type JsonObject,
  type JsonValue,
  type OpenMAEvent,
  type OpenMAEventSource,
  type TurnTerminalEvent,
} from "../session-events/openma.js";

export * from "../session-events/openma.js";

export type AgentPlacement = "local" | "remote" | "managed";

export interface AgentSessionHandle {
  readonly connectorId: string;
  readonly externalSessionId: string;
  readonly placement: AgentPlacement;
  readonly resumeToken?: string;
  readonly metadata?: JsonObject;
}

export function createAgentSessionHandle(
  input: AgentSessionHandle,
): Readonly<AgentSessionHandle> {
  if (!input.connectorId.trim()) throw new Error("connectorId must not be empty");
  if (!input.externalSessionId.trim()) {
    throw new Error("externalSessionId must not be empty");
  }
  return immutableJson(input);
}

export type AgentSessionPersistence = "ephemeral" | "resumable" | "persistent";

export interface AgentCapabilities {
  readonly sessionPersistence: AgentSessionPersistence;
  readonly streaming: boolean;
  readonly cancellation: boolean;
  readonly permissions: boolean;
  readonly elicitation: boolean;
  readonly steering?: boolean;
  readonly customTools?: boolean;
  readonly mcp?: boolean;
  readonly extensions?: JsonObject;
}

export interface AgentSessionInput {
  readonly agentId: string;
  readonly cwd?: string;
  readonly additionalDirectories?: readonly string[];
  readonly resume?: AgentSessionHandle;
  readonly metadata?: JsonObject;
}

export interface AgentContentBlock {
  readonly type: string;
  readonly [key: string]: JsonValue;
}

export type AgentContent = string | readonly AgentContentBlock[];

export interface AgentTurnInput {
  readonly turnId: string;
  readonly contextDigest?: string;
  readonly content: AgentContent;
  readonly grants?: readonly string[];
  readonly workspace?: {
    readonly cwd?: string;
    readonly additionalDirectories?: readonly string[];
  };
  readonly metadata?: JsonObject;
}

export type AgentCommand =
  | { type: "turn.steer"; content: AgentContent }
  | { type: "turn.cancel"; turnId: string }
  | {
      type: "callback.respond";
      callbackId: string;
      result?: JsonValue;
      error?: JsonValue;
    };

export interface OpenMAAgentConnector {
  readonly id: string;
  capabilities(): Promise<AgentCapabilities>;
  open(input: AgentSessionInput): Promise<AgentSessionHandle>;
  execute(
    session: AgentSessionHandle,
    input: AgentTurnInput,
  ): AsyncIterable<OpenMAEvent>;
  send(session: AgentSessionHandle, command: AgentCommand): Promise<void>;
  close(session: AgentSessionHandle): Promise<void>;
}

export interface AgentEventContext {
  readonly eventId: string;
  readonly sessionId: string;
  readonly occurredAt: string;
  readonly source?: OpenMAEventSource;
  readonly sessionThreadId?: string;
  readonly turnId: string;
  readonly workItemId?: string;
  readonly parentEventId?: string;
  readonly parentId?: string;
  readonly seq: number;
}

export function agentEventEnvelope(
  context: AgentEventContext,
  defaultSource: OpenMAEventSource,
): {
  event_id: string;
  session_id: string;
  source: OpenMAEventSource;
  occurred_at: string;
  session_thread_id?: string;
  turn_id: string;
  work_item_id?: string;
  parent_event_id?: string;
  parent_id?: string;
  seq: number;
} {
  if (!context.eventId.trim()) throw new Error("eventId must not be empty");
  if (!context.sessionId.trim()) throw new Error("sessionId must not be empty");
  if (!context.turnId.trim()) throw new Error("turnId must not be empty");
  if (!context.occurredAt.trim()) throw new Error("occurredAt must not be empty");
  if (!Number.isSafeInteger(context.seq) || context.seq < 0) {
    throw new Error("seq must be a non-negative safe integer");
  }
  return {
    event_id: context.eventId,
    session_id: context.sessionId,
    source: context.source ?? defaultSource,
    occurred_at: context.occurredAt,
    ...(context.sessionThreadId ? { session_thread_id: context.sessionThreadId } : {}),
    turn_id: context.turnId,
    ...(context.workItemId ? { work_item_id: context.workItemId } : {}),
    ...(context.parentEventId ? { parent_event_id: context.parentEventId } : {}),
    ...(context.parentId ? { parent_id: context.parentId } : {}),
    seq: context.seq,
  };
}

export type AgentTurnTerminalStatus =
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

const TURN_TERMINAL_TYPES = {
  "turn.completed": "completed",
  "turn.failed": "failed",
  "turn.cancelled": "cancelled",
  "turn.interrupted": "interrupted",
} as const;

export function turnTerminalStatus(
  event: OpenMAEvent,
): AgentTurnTerminalStatus | undefined {
  const status = TURN_TERMINAL_TYPES[
    event.type as keyof typeof TURN_TERMINAL_TYPES
  ];
  if (
    status === undefined
    || typeof event.turn_id !== "string"
    || event.turn_id.length === 0
    || !Number.isSafeInteger(event.seq)
    || (event.seq ?? -1) < 0
  ) return undefined;
  return status;
}

export function isTurnTerminalEvent(event: OpenMAEvent): event is TurnTerminalEvent {
  return turnTerminalStatus(event) !== undefined;
}

export type CallbackRequestEventFor<TCategory extends CallbackCategory> =
  Omit<CallbackRequestedEvent, "data">
  & { data: CallbackRequestedData & { category: TCategory } };

export function isCallbackRequestEvent<TCategory extends CallbackCategory>(
  event: OpenMAEvent,
  category: TCategory,
): event is CallbackRequestEventFor<TCategory>;
export function isCallbackRequestEvent(
  event: OpenMAEvent,
): event is CallbackRequestedEvent;
export function isCallbackRequestEvent(
  event: OpenMAEvent,
  category?: CallbackCategory,
): boolean {
  if (event.type !== "callback.requested") return false;
  if (!event.data || typeof event.data !== "object") return false;
  const data = event.data as Partial<CallbackRequestedData>;
  if (
    typeof data.callback_id !== "string"
    || data.callback_id.length === 0
    || typeof data.fingerprint !== "string"
    || data.fingerprint.length === 0
    || typeof data.method !== "string"
    || data.method.length === 0
  ) return false;
  return category === undefined
    || data.category === category;
}

export function isPermissionRequestEvent(
  event: OpenMAEvent,
): event is CallbackRequestEventFor<"permission"> {
  return isCallbackRequestEvent(event, "permission");
}

export function isElicitationRequestEvent(
  event: OpenMAEvent,
): event is CallbackRequestEventFor<"elicitation"> {
  return isCallbackRequestEvent(event, "elicitation");
}

export function callbackFingerprint(
  context: Pick<AgentEventContext, "sessionId" | "turnId">,
  category: CallbackCategory,
  method: string,
  callbackId: string,
  params: unknown,
): string {
  const segments = [
    context.sessionId,
    context.turnId,
    category,
    method,
    callbackId,
  ].map(encodeURIComponent);
  const normalizedParams = immutableJson(params ?? null) as JsonValue;
  return `oma.callback.v1/${segments.join("/")}/${encodeURIComponent(
    canonicalJsonStringify(normalizedParams),
  )}`;
}

function canonicalJsonStringify(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJsonStringify).join(",")}]`;
  }
  const object = value as JsonObject;
  return `{${Object.keys(object).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJsonStringify(object[key]!)}`
  ).join(",")}}`;
}
