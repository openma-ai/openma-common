/** Product-neutral runtime placement. Both Backchat and OpenManaged use the
 * same cloud transport; only the host behind a local runtime differs. */
export type SessionRuntime = "local" | "cloud";

export interface SessionStartCommand {
  type: "session.start";
  sessionId: string;
  agentId: string;
  runtime: SessionRuntime;
  acpSessionId?: string;
}

export interface SessionPromptCommand {
  type: "session.prompt";
  sessionId: string;
  turnId: string;
  text: string;
}

export interface SessionCancelCommand {
  type: "session.cancel";
  sessionId: string;
  turnId: string;
}

export interface SessionDisposeCommand {
  type: "session.dispose";
  sessionId: string;
}

export type SessionCommand =
  | SessionStartCommand
  | SessionPromptCommand
  | SessionCancelCommand
  | SessionDisposeCommand;

export interface SessionReadyEvent {
  type: "session.ready";
  sessionId: string;
  acpSessionId: string;
}

export interface SessionStreamEvent {
  type: "session.event";
  sessionId: string;
  turnId: string;
  event: unknown;
}

export interface SessionCompleteEvent {
  type: "session.complete";
  sessionId: string;
  turnId: string;
}

export interface SessionErrorEvent {
  type: "session.error";
  sessionId: string;
  turnId?: string;
  message: string;
}

export interface SessionDisposedEvent {
  type: "session.disposed";
  sessionId: string;
}

export type SessionHostEvent =
  | SessionReadyEvent
  | SessionStreamEvent
  | SessionCompleteEvent
  | SessionErrorEvent
  | SessionDisposedEvent;

export type SessionWireMessage = {
  type?: string;
  session_id?: string;
  tenant_id?: string;
  turn_id?: string;
  agent_id?: string;
  text?: string;
  event?: unknown;
  message?: string;
  acp_session_id?: string;
  resume?: { acp_session_id?: string };
};

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Decode the relay's snake_case JSON once at the boundary. Hosts should not
 * scatter wire-shape checks through their lifecycle implementation. */
export function decodeSessionCommand(input: unknown): SessionCommand | null {
  if (!input || typeof input !== "object") return null;
  const message = input as SessionWireMessage;
  if (!nonEmpty(message.session_id)) return null;
  switch (message.type) {
    case "session.start":
      if (!nonEmpty(message.agent_id)) return null;
      return {
        type: "session.start",
        sessionId: message.session_id,
        agentId: message.agent_id,
        runtime: "local",
        ...(nonEmpty(message.resume?.acp_session_id)
          ? { acpSessionId: message.resume.acp_session_id }
          : {}),
      };
    case "session.prompt":
      if (!nonEmpty(message.turn_id) || typeof message.text !== "string") return null;
      return {
        type: "session.prompt",
        sessionId: message.session_id,
        turnId: message.turn_id,
        text: message.text,
      };
    case "session.cancel":
      if (!nonEmpty(message.turn_id)) return null;
      return { type: "session.cancel", sessionId: message.session_id, turnId: message.turn_id };
    case "session.dispose":
      return { type: "session.dispose", sessionId: message.session_id };
    default:
      return null;
  }
}

/** Encode a host event to the relay wire shape. The optional tenant is kept
 * at the transport edge; it is not part of the local lifecycle model. */
export function encodeSessionHostEvent(
  event: SessionHostEvent,
  options: { tenantId?: string } = {},
): Record<string, unknown> {
  const tenant = options.tenantId ? { tenant_id: options.tenantId } : {};
  switch (event.type) {
    case "session.ready":
      return {
        type: event.type,
        session_id: event.sessionId,
        ...tenant,
        acp_session_id: event.acpSessionId,
      };
    case "session.event":
      return {
        type: event.type,
        session_id: event.sessionId,
        ...tenant,
        turn_id: event.turnId,
        event: event.event,
      };
    case "session.complete":
      return {
        type: event.type,
        session_id: event.sessionId,
        ...tenant,
        turn_id: event.turnId,
      };
    case "session.error":
      return {
        type: event.type,
        session_id: event.sessionId,
        ...tenant,
        ...(event.turnId ? { turn_id: event.turnId } : {}),
        message: event.message,
      };
    case "session.disposed":
      return { type: event.type, session_id: event.sessionId, ...tenant };
  }
}

export type SessionLifecycleEvent =
  | { type: "start.requested" }
  | { type: "session.ready"; acpSessionId: string }
  | { type: "prompt.requested"; turnId: string }
  | { type: "prompt.cancelled"; turnId: string }
  | { type: "session.complete"; turnId: string }
  | { type: "session.error"; turnId?: string; message: string }
  | { type: "session.disposed" };

export type SessionLifecycleStatus =
  | "draft"
  | "starting"
  | "ready"
  | "running"
  | "errored"
  | "disposed";

export interface SessionLifecycle {
  sessionId: string;
  status: SessionLifecycleStatus;
  acpSessionId?: string;
  activeTurnId?: string;
  lastError?: string;
}

export function initialSessionLifecycle(sessionId: string): SessionLifecycle {
  return { sessionId, status: "draft" };
}

/** Pure lifecycle reducer. Hosts keep their own persistence/transport, but
 * every host must apply these same transition and stale-event rules. */
export function reduceSessionLifecycle(
  state: SessionLifecycle,
  event: SessionLifecycleEvent,
): SessionLifecycle {
  switch (event.type) {
    case "start.requested":
      if (state.status === "disposed") return state;
      return { ...state, status: "starting", lastError: undefined };
    case "session.ready":
      if (state.status === "disposed") return state;
      return {
        ...state,
        status: "ready",
        acpSessionId: event.acpSessionId,
        activeTurnId: undefined,
        lastError: undefined,
      };
    case "prompt.requested":
      if (state.status === "disposed") return state;
      return { ...state, status: "running", activeTurnId: event.turnId, lastError: undefined };
    case "session.complete":
      if (state.activeTurnId !== event.turnId) return state;
      return { ...state, status: "ready", activeTurnId: undefined };
    case "prompt.cancelled":
      if (state.activeTurnId !== event.turnId) return state;
      return { ...state, status: "ready", activeTurnId: undefined };
    case "session.error":
      if (event.turnId && state.activeTurnId && event.turnId !== state.activeTurnId) return state;
      return {
        ...state,
        status: "errored",
        activeTurnId: undefined,
        lastError: event.message,
      };
    case "session.disposed":
      return { ...state, status: "disposed", activeTurnId: undefined };
  }
}
