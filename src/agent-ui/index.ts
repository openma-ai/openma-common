import type {
  MessageEventData,
  OpenMAEvent,
  OutcomeDefinedData,
  OutcomeEvaluationData,
  CanonicalPlanEntry,
  CallbackCategory,
  CallbackLifecycleData,
  PlanRepresentation,
  PlanUpdatedData,
  ToolLifecycleData,
  ToolOutputData,
  ToolStatus,
  WorkItemKind,
  WorkItemSnapshot,
  WorkItemStatus,
} from "../session-events/openma.js";
import {
  reduceWorkItemEvent,
} from "../session-events/openma.js";

export const AGENT_UI_STATE_VERSION = "oma.agent-ui.v1" as const;

export type AgentUISessionStatus =
  | "unknown"
  | "running"
  | "rescheduled"
  | "idle"
  | "terminated"
  | "error";

export type AgentUITurnStatus =
  | "unknown"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface AgentUIMessageItem {
  id: string;
  kind: "message" | "thinking" | "notice";
  role: "user" | "assistant" | "system";
  text: string;
  status: "streaming" | "complete";
  content?: unknown;
  phase?: "commentary" | "final_answer";
}

export interface AgentUIToolItem {
  id: string;
  kind: "tool";
  name?: string;
  title?: string;
  status: ToolStatus;
  rawInput?: unknown;
  rawOutput?: unknown;
  outputs: ToolOutputData[];
  error?: string;
  reason?: string;
}

export type AgentUITimelineItem = AgentUIMessageItem | AgentUIToolItem;

export interface AgentUIWorkItemState {
  id: string;
  kind: WorkItemKind;
  status: WorkItemStatus;
  title?: string;
  progress?: number;
  output: unknown[];
  result?: unknown;
  error?: string;
  reason?: string;
  startedAt?: string;
  endedAt?: string;
  missingStart?: boolean;
  missingTerminal?: boolean;
}

export interface AgentUIPlanState {
  id: string;
  representation: PlanRepresentation;
  status: "active" | "completed";
  entries: CanonicalPlanEntry[];
}

export interface AgentUICallbackState {
  id: string;
  category: CallbackCategory;
  method: string;
  status: "pending" | "completed" | "failed" | "notification";
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

export interface AgentUIUsageState {
  snapshot: unknown;
  budget?: unknown;
  updatedAt: string;
}

export interface AgentUIOutcomeState {
  id: string;
  status: string;
  description?: string;
  rubric?: unknown;
  maxIterations?: number | null;
  iteration?: number;
  explanation?: string;
  usage?: unknown;
  updatedAt: string;
}

export interface AgentUISessionInfoState {
  title?: string | null;
  updatedAt?: string | null;
}

export interface AgentUITurnState {
  id: string;
  status: AgentUITurnStatus;
  items: AgentUITimelineItem[];
  error?: string;
  reason?: string;
  startedAt?: string;
  endedAt?: string;
}

export interface AgentUIState {
  version: typeof AGENT_UI_STATE_VERSION;
  sessionId: string;
  status: AgentUISessionStatus;
  sessionInfo: AgentUISessionInfoState;
  commands: unknown[];
  capabilities: Record<string, unknown>;
  activeTurnId?: string;
  turnOrder: string[];
  turns: Record<string, AgentUITurnState>;
  workItemOrder: string[];
  workItems: Record<string, AgentUIWorkItemState>;
  planOrder: string[];
  plans: Record<string, AgentUIPlanState>;
  callbackOrder: string[];
  callbacks: Record<string, AgentUICallbackState>;
  usage?: AgentUIUsageState;
  outcomeOrder: string[];
  outcomes: Record<string, AgentUIOutcomeState>;
  seenEventIds: Record<string, true>;
  lastError?: string;
}

export function createAgentUIState(sessionId: string): AgentUIState {
  return {
    version: AGENT_UI_STATE_VERSION,
    sessionId,
    status: "unknown",
    sessionInfo: {},
    commands: [],
    capabilities: {},
    turnOrder: [],
    turns: {},
    workItemOrder: [],
    workItems: {},
    planOrder: [],
    plans: {},
    callbackOrder: [],
    callbacks: {},
    outcomeOrder: [],
    outcomes: {},
    seenEventIds: {},
  };
}

function eventData(event: OpenMAEvent): MessageEventData {
  return event.data && typeof event.data === "object"
    ? event.data as MessageEventData
    : {};
}

function cloneState(state: AgentUIState): AgentUIState {
  return {
    ...state,
    sessionInfo: { ...state.sessionInfo },
    commands: [...state.commands],
    capabilities: { ...state.capabilities },
    turnOrder: [...state.turnOrder],
    turns: Object.fromEntries(
      Object.entries(state.turns).map(([id, turn]) => [
        id,
        {
          ...turn,
          items: turn.items.map((item) => item.kind === "tool"
            ? { ...item, outputs: item.outputs.map((output) => ({ ...output })) }
            : { ...item }),
        },
      ]),
    ),
    workItemOrder: [...state.workItemOrder],
    workItems: Object.fromEntries(
      Object.entries(state.workItems).map(([id, item]) => [
        id,
        { ...item, output: [...item.output] },
      ]),
    ),
    planOrder: [...state.planOrder],
    plans: Object.fromEntries(
      Object.entries(state.plans).map(([id, plan]) => [
        id,
        { ...plan, entries: plan.entries.map((entry) => ({ ...entry })) },
      ]),
    ),
    callbackOrder: [...state.callbackOrder],
    callbacks: Object.fromEntries(
      Object.entries(state.callbacks).map(([id, callback]) => [
        id,
        { ...callback },
      ]),
    ),
    ...(state.usage ? { usage: { ...state.usage } } : {}),
    outcomeOrder: [...state.outcomeOrder],
    outcomes: Object.fromEntries(
      Object.entries(state.outcomes).map(([id, outcome]) => [id, { ...outcome }]),
    ),
    seenEventIds: { ...state.seenEventIds },
  };
}

function toWorkItemSnapshot(item: AgentUIWorkItemState): WorkItemSnapshot {
  return {
    id: item.id,
    kind: item.kind,
    status: item.status,
    output: [...item.output],
    ...(item.title !== undefined ? { title: item.title } : {}),
    ...(item.progress !== undefined ? { progress: item.progress } : {}),
    ...(item.result !== undefined ? { result: item.result } : {}),
    ...(item.error !== undefined ? { error: item.error } : {}),
    ...(item.reason !== undefined ? { reason: item.reason } : {}),
    ...(item.startedAt !== undefined ? { started_at: item.startedAt } : {}),
    ...(item.endedAt !== undefined ? { ended_at: item.endedAt } : {}),
    ...(item.missingStart !== undefined ? { missing_start: item.missingStart } : {}),
    ...(item.missingTerminal !== undefined
      ? { missing_terminal: item.missingTerminal }
      : {}),
  };
}

function toAgentUIWorkItem(item: WorkItemSnapshot): AgentUIWorkItemState {
  return {
    id: item.id,
    kind: item.kind,
    status: item.status,
    output: [...item.output],
    ...(item.title !== undefined ? { title: item.title } : {}),
    ...(item.progress !== undefined ? { progress: item.progress } : {}),
    ...(item.result !== undefined ? { result: item.result } : {}),
    ...(item.error !== undefined ? { error: item.error } : {}),
    ...(item.reason !== undefined ? { reason: item.reason } : {}),
    ...(item.started_at !== undefined ? { startedAt: item.started_at } : {}),
    ...(item.ended_at !== undefined ? { endedAt: item.ended_at } : {}),
    ...(item.missing_start !== undefined ? { missingStart: item.missing_start } : {}),
    ...(item.missing_terminal !== undefined
      ? { missingTerminal: item.missing_terminal }
      : {}),
  };
}

function applyWorkItemProjection(
  state: AgentUIState,
  previous: AgentUIState,
  event: OpenMAEvent,
): void {
  const registry = reduceWorkItemEvent(
    {
      items: new Map(
        Object.entries(previous.workItems).map(([id, item]) => [
          id,
          toWorkItemSnapshot(item),
        ]),
      ),
      seen_event_ids: new Set(Object.keys(previous.seenEventIds)),
    },
    event,
  );
  const ids = [...registry.items.keys()];
  const present = new Set(ids);
  state.workItemOrder = previous.workItemOrder.filter((id) => present.has(id));
  for (const id of ids) {
    if (!state.workItemOrder.includes(id)) state.workItemOrder.push(id);
  }
  state.workItems = Object.fromEntries(
    [...registry.items].map(([id, item]) => [id, toAgentUIWorkItem(item)]),
  );
}

function planId(event: OpenMAEvent): string | undefined {
  if (!event.data || typeof event.data !== "object") return undefined;
  const value = (event.data as { plan_id?: unknown }).plan_id;
  return typeof value === "string" && value.length > 0
    ? value
    : event.turn_id;
}

function mergePlanEntries(
  previous: readonly CanonicalPlanEntry[],
  incoming: readonly CanonicalPlanEntry[],
): CanonicalPlanEntry[] {
  const merged = previous.map((entry) => ({ ...entry }));
  for (const entry of incoming) {
    const index = entry.id
      ? merged.findIndex((candidate) => candidate.id === entry.id)
      : -1;
    if (index >= 0) merged[index] = { ...merged[index], ...entry };
    else merged.push({ ...entry });
  }
  return merged;
}

function applyPlanProjection(state: AgentUIState, event: OpenMAEvent): void {
  const id = planId(event);
  if (!id) return;
  if (event.type === "plan.updated") {
    const data = event.data as PlanUpdatedData;
    if (data.representation !== "items"
      && data.representation !== "markdown"
      && data.representation !== "file") {
      return;
    }
    const previous = state.plans[id];
    const incoming = data.entries ?? [];
    state.plans[id] = {
      id,
      representation: data.representation,
      status: "active",
      entries: data.update_mode === "merge" && previous
        ? mergePlanEntries(previous.entries, incoming)
        : incoming.map((entry) => ({ ...entry })),
    };
    if (!state.planOrder.includes(id)) state.planOrder.push(id);
  } else if (event.type === "plan.completed") {
    const previous = state.plans[id];
    if (previous) state.plans[id] = { ...previous, status: "completed" };
  } else if (event.type === "plan.removed") {
    delete state.plans[id];
    state.planOrder = state.planOrder.filter((planId) => planId !== id);
  }
}

function applyCallbackProjection(state: AgentUIState, event: OpenMAEvent): void {
  if (
    event.type !== "callback.requested"
    && event.type !== "callback.completed"
    && event.type !== "callback.failed"
    && event.type !== "callback.notification"
  ) {
    return;
  }
  if (!event.data || typeof event.data !== "object") return;
  const data = event.data as CallbackLifecycleData;
  const callbackId = (
    typeof data.callback_id === "string" && data.callback_id.length > 0
  ) || typeof data.callback_id === "number"
    ? String(data.callback_id)
    : data.callback_id === null
      ? "null"
    : event.type === "callback.notification"
      ? event.event_id
      : undefined;
  if (!callbackId) {
    return;
  }
  if (typeof data.method !== "string" || data.method.length === 0) return;
  const id = callbackId;
  const previous = state.callbacks[id];
  const callback: AgentUICallbackState = {
    id,
    category: data.category,
    method: data.method,
    status: event.type === "callback.requested"
      ? "pending"
      : event.type === "callback.failed"
        ? "failed"
        : event.type === "callback.notification"
          ? "notification"
          : "completed",
    ...(previous?.params !== undefined ? { params: previous.params } : {}),
    ...(data.params !== undefined ? { params: data.params } : {}),
    ...(data.result !== undefined ? { result: data.result } : {}),
    ...(data.error !== undefined ? { error: data.error } : {}),
  };
  state.callbacks[id] = callback;
  if (!state.callbackOrder.includes(id)) state.callbackOrder.push(id);
}

function applyOutcomeProjection(state: AgentUIState, event: OpenMAEvent): void {
  if (
    event.type !== "outcome.defined"
    && event.type !== "outcome.evaluation_started"
    && event.type !== "outcome.evaluation_progress"
    && event.type !== "outcome.evaluation_completed"
  ) {
    return;
  }
  if (!event.data || typeof event.data !== "object") return;
  const data = event.data as OutcomeDefinedData & OutcomeEvaluationData;
  const id = typeof data.outcome_id === "string" && data.outcome_id.length > 0
    ? data.outcome_id
    : event.event_id;
  const previous = state.outcomes[id];
  const status = event.type === "outcome.defined"
    ? "defined"
    : event.type === "outcome.evaluation_completed"
      ? data.result ?? "completed"
      : "evaluating";
  state.outcomes[id] = {
    id,
    status,
    ...(previous?.description !== undefined
      ? { description: previous.description }
      : {}),
    ...(previous?.rubric !== undefined ? { rubric: previous.rubric } : {}),
    ...(previous?.maxIterations !== undefined
      ? { maxIterations: previous.maxIterations }
      : {}),
    ...(data.description !== undefined ? { description: data.description } : {}),
    ...(data.rubric !== undefined ? { rubric: data.rubric } : {}),
    ...(data.max_iterations !== undefined
      ? { maxIterations: data.max_iterations }
      : {}),
    ...(data.iteration !== undefined ? { iteration: data.iteration } : {}),
    ...(data.explanation !== undefined ? { explanation: data.explanation } : {}),
    ...(data.usage !== undefined ? { usage: data.usage } : {}),
    updatedAt: event.occurred_at,
  };
  if (!state.outcomeOrder.includes(id)) state.outcomeOrder.push(id);
}

function requireTurn(state: AgentUIState, event: OpenMAEvent): AgentUITurnState | undefined {
  const turnId = event.turn_id;
  if (!turnId) return undefined;
  const existing = state.turns[turnId];
  if (existing) return existing;
  const created: AgentUITurnState = {
    id: turnId,
    status: "unknown",
    items: [],
  };
  state.turns[turnId] = created;
  state.turnOrder.push(turnId);
  return created;
}

function upsertMessage(
  turn: AgentUITurnState,
  event: OpenMAEvent,
  input: {
    kind: AgentUIMessageItem["kind"];
    role: AgentUIMessageItem["role"];
    streaming: boolean;
  },
): void {
  const data = eventData(event);
  const id = typeof data.message_id === "string" && data.message_id.length > 0
    ? data.message_id
    : event.event_id;
  const text = typeof data.text === "string" ? data.text : "";
  const existing = turn.items.find(
    (item): item is AgentUIMessageItem =>
      item.kind !== "tool" && item.id === id,
  );
  if (existing) {
    existing.kind = input.kind;
    existing.role = input.role;
    existing.text = input.streaming ? `${existing.text}${text}` : text;
    existing.status = input.streaming ? "streaming" : "complete";
    if (data.content !== undefined) existing.content = data.content;
    if (data.phase !== undefined) existing.phase = data.phase;
    return;
  }
  turn.items.push({
    id,
    kind: input.kind,
    role: input.role,
    text,
    status: input.streaming ? "streaming" : "complete",
    ...(data.content !== undefined ? { content: data.content } : {}),
    ...(data.phase !== undefined ? { phase: data.phase } : {}),
  });
}

function upsertTool(
  turn: AgentUITurnState,
  event: OpenMAEvent,
  status: ToolStatus,
): void {
  if (!event.data || typeof event.data !== "object") return;
  const data = event.data as ToolLifecycleData;
  if (typeof data.tool_call_id !== "string" || data.tool_call_id.length === 0) {
    return;
  }
  let item = turn.items.find(
    (candidate): candidate is AgentUIToolItem =>
      candidate.kind === "tool" && candidate.id === data.tool_call_id,
  );
  if (!item) {
    item = {
      id: data.tool_call_id,
      kind: "tool",
      status,
      outputs: [],
    };
    turn.items.push(item);
  }
  item.status = status;
  if (data.tool_name !== undefined) item.name = data.tool_name;
  if (data.title !== undefined) item.title = data.title;
  if (data.raw_input !== undefined) item.rawInput = data.raw_input;
  if (data.raw_output !== undefined) item.rawOutput = data.raw_output;
  if (data.error !== undefined) item.error = data.error;
  if (data.reason !== undefined) item.reason = data.reason;
  if (data.output !== undefined) {
    if (data.output.append) item.outputs.push(data.output);
    else item.outputs = [data.output];
  }
}

function errorMessage(event: OpenMAEvent): string | undefined {
  if (!event.data || typeof event.data !== "object") return undefined;
  const data = event.data as { error?: unknown; message?: unknown; reason?: unknown };
  for (const value of [data.error, data.message, data.reason]) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function stopReasonType(event: OpenMAEvent): string | undefined {
  if (!event.data || typeof event.data !== "object") return undefined;
  const stopReason = (event.data as { stop_reason?: unknown }).stop_reason;
  if (typeof stopReason === "string") return stopReason;
  if (!stopReason || typeof stopReason !== "object") return undefined;
  const type = (stopReason as { type?: unknown }).type;
  return typeof type === "string" ? type : undefined;
}

export function reduceAgentUIEvent(
  state: AgentUIState,
  event: OpenMAEvent,
): AgentUIState {
  if (event.session_id !== state.sessionId || state.seenEventIds[event.event_id]) {
    return state;
  }

  const next = cloneState(state);
  applyWorkItemProjection(next, state, event);
  applyPlanProjection(next, event);
  applyCallbackProjection(next, event);
  applyOutcomeProjection(next, event);
  next.seenEventIds[event.event_id] = true;
  const turn = requireTurn(next, event);

  switch (event.type) {
    case "session.updated": {
      const data = event.data as { title?: string | null; updated_at?: string | null };
      next.sessionInfo = {
        ...next.sessionInfo,
        ...(Object.prototype.hasOwnProperty.call(data, "title")
          ? { title: data.title }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(data, "updated_at")
          ? { updatedAt: data.updated_at }
          : {}),
      };
      break;
    }
    case "command_catalog.updated": {
      const data = event.data as { commands?: unknown };
      if (Array.isArray(data.commands)) next.commands = [...data.commands];
      break;
    }
    case "capability.updated": {
      const data = event.data as { capability?: unknown; value?: unknown };
      if (typeof data.capability === "string" && data.capability.length > 0) {
        next.capabilities[data.capability] = data.value;
      }
      break;
    }
    case "session.running":
      next.status = "running";
      if (turn) {
        turn.status = "running";
        turn.startedAt ??= event.occurred_at;
        next.activeTurnId = turn.id;
      }
      break;
    case "session.rescheduled":
      next.status = "rescheduled";
      break;
    case "session.idle": {
      next.status = "idle";
      const idleTurn = turn
        ?? (next.activeTurnId ? next.turns[next.activeTurnId] : undefined);
      if (idleTurn && stopReasonType(event) === "end_turn") {
        idleTurn.status = "completed";
        idleTurn.endedAt = event.occurred_at;
      }
      next.activeTurnId = undefined;
      break;
    }
    case "session.terminated":
      next.status = "terminated";
      next.activeTurnId = undefined;
      break;
    case "session.error": {
      const message = errorMessage(event);
      const failedTurn = turn
        ?? (next.activeTurnId ? next.turns[next.activeTurnId] : undefined);
      next.status = "error";
      next.lastError = message;
      if (failedTurn) {
        failedTurn.status = "failed";
        failedTurn.error = message;
        failedTurn.endedAt = event.occurred_at;
      }
      next.activeTurnId = undefined;
      break;
    }
    case "usage.updated": {
      const data = event.data as { usage?: unknown; budget?: unknown };
      if (data.usage !== undefined) {
        next.usage = {
          snapshot: data.usage,
          ...(data.budget !== undefined ? { budget: data.budget } : {}),
          updatedAt: event.occurred_at,
        };
      }
      break;
    }
    case "turn.queued":
      if (turn) turn.status = "queued";
      break;
    case "turn.completed":
      if (turn) {
        turn.status = "completed";
        turn.endedAt = event.occurred_at;
      }
      if (next.activeTurnId === event.turn_id) next.activeTurnId = undefined;
      break;
    case "turn.failed":
      if (turn) {
        turn.status = "failed";
        turn.error = errorMessage(event);
        turn.endedAt = event.occurred_at;
      }
      if (next.activeTurnId === event.turn_id) next.activeTurnId = undefined;
      break;
    case "turn.cancelled":
      if (turn) {
        turn.status = "cancelled";
        turn.reason = errorMessage(event);
        turn.endedAt = event.occurred_at;
      }
      if (next.activeTurnId === event.turn_id) next.activeTurnId = undefined;
      break;
    case "user.message_chunk":
      if (turn) {
        if (turn.status === "unknown") turn.status = "queued";
        upsertMessage(turn, event, {
          kind: "message",
          role: "user",
          streaming: true,
        });
      }
      break;
    case "user.message":
      if (turn) {
        if (turn.status === "unknown") turn.status = "queued";
        upsertMessage(turn, event, {
          kind: "message",
          role: "user",
          streaming: false,
        });
      }
      break;
    case "agent.message_chunk":
      if (turn) {
        if (turn.status === "unknown" || turn.status === "queued") {
          turn.status = "running";
        }
        upsertMessage(turn, event, {
          kind: "message",
          role: "assistant",
          streaming: true,
        });
      }
      break;
    case "agent.message":
      if (turn) {
        upsertMessage(turn, event, {
          kind: "message",
          role: "assistant",
          streaming: false,
        });
      }
      break;
    case "agent.thinking":
      if (turn) {
        upsertMessage(turn, event, {
          kind: "thinking",
          role: "assistant",
          streaming: false,
        });
      }
      break;
    case "system.message":
      if (turn) {
        upsertMessage(turn, event, {
          kind: "message",
          role: "system",
          streaming: false,
        });
      }
      break;
    case "system.notice":
      if (turn) {
        upsertMessage(turn, event, {
          kind: "notice",
          role: "system",
          streaming: false,
        });
      }
      break;
    case "tool.started":
      if (turn) upsertTool(turn, event, "in_progress");
      break;
    case "tool.progress":
      if (turn) upsertTool(turn, event, "in_progress");
      break;
    case "tool.completed":
      if (turn) upsertTool(turn, event, "completed");
      break;
    case "tool.failed":
      if (turn) upsertTool(turn, event, "failed");
      break;
    case "tool.cancelled":
      if (turn) upsertTool(turn, event, "cancelled");
      break;
  }

  return next;
}

export function replayAgentUIEvents(
  sessionId: string,
  events: readonly OpenMAEvent[],
): AgentUIState {
  const ordered = events
    .map((event, index) => ({ event, index }))
    .sort((left, right) => {
      if (left.event.seq === undefined && right.event.seq === undefined) {
        return left.index - right.index;
      }
      if (left.event.seq === undefined) return 1;
      if (right.event.seq === undefined) return -1;
      return left.event.seq - right.event.seq || left.index - right.index;
    });
  return ordered.reduce(
    (state, entry) => reduceAgentUIEvent(state, entry.event),
    createAgentUIState(sessionId),
  );
}

export interface AgentUIStore {
  getState(): AgentUIState;
  dispatch(event: OpenMAEvent): AgentUIState;
  subscribe(listener: (state: AgentUIState) => void): () => void;
}

export function createAgentUIStore(sessionId: string): AgentUIStore {
  let state = createAgentUIState(sessionId);
  const listeners = new Set<(state: AgentUIState) => void>();
  return {
    getState: () => state,
    dispatch: (event) => {
      const next = reduceAgentUIEvent(state, event);
      if (next !== state) {
        state = next;
        for (const listener of listeners) listener(state);
      }
      return state;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
