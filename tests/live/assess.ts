/**
 * Assertions for one Cloud Agents run stream.
 *
 * Documented event names match the decoder switch in
 * src/protocol/cursor-cloud/index.ts and the Stream A Run section of
 * https://cursor.com/docs/cloud-agent/api/endpoints. `heartbeat` and `done`
 * are the only events that decoder intentionally drops. Any other event
 * that produces nothing is a silent drop. An event name outside the
 * documented set is unrecognized even when it is preserved as a vendor event.
 */
import type { CursorCloudSseEvent } from "../../src/protocol/cursor-cloud/index.js";
import type { OpenMAEvent } from "../../src/session-events/openma.js";

export const DOCUMENTED_SSE_EVENTS = new Set([
  "status",
  "assistant",
  "thinking",
  "tool_call",
  "interaction_update",
  "heartbeat",
  "result",
  "error",
  "done",
]);

export const SILENT_SSE_EVENTS = new Set(["heartbeat", "done"]);

const EXPECTED_DATA_KEYS: Record<string, ReadonlySet<string>> = {
  status: new Set(["runId", "status"]),
  assistant: new Set(["text"]),
  thinking: new Set(["text"]),
  tool_call: new Set(["callId", "name", "status", "args", "result", "truncated"]),
  result: new Set(["runId", "status", "text", "durationMs", "git"]),
  error: new Set(["code", "message"]),
  heartbeat: new Set(),
  done: new Set(),
};

export interface DecodedFrame {
  raw: CursorCloudSseEvent;
  events: OpenMAEvent[];
  error?: string;
}

export interface LiveAssessment {
  ok: boolean;
  failures: string[];
  shapeNotes: string[];
  eventCount: number;
  eventNameCounts: Record<string, number>;
  canonicalTypes: string[];
  vendorNames: string[];
  unrecognized: string[];
}

export function assessDecodedFrames(
  frames: readonly DecodedFrame[],
  sawDone: boolean,
  options: { requireUserMessage?: boolean } = {},
): LiveAssessment {
  const failures: string[] = [];
  const unrecognized: string[] = [];
  const eventNameCounts: Record<string, number> = {};

  for (const frame of frames) {
    eventNameCounts[frame.raw.event] = (eventNameCounts[frame.raw.event] ?? 0) + 1;
    if (frame.error) failures.push(`${frame.raw.event} threw: ${frame.error}`);
    if (!DOCUMENTED_SSE_EVENTS.has(frame.raw.event)) {
      unrecognized.push(frame.raw.event);
      const reported = frame.events.map((event) => event.type).join(", ") || "none";
      failures.push(`unrecognized SSE event ${JSON.stringify(frame.raw.event)} (decoded: ${reported})`);
    }
    if (frame.events.length === 0 && !SILENT_SSE_EVENTS.has(frame.raw.event)) {
      failures.push(`SSE event ${JSON.stringify(frame.raw.event)} was dropped without an OpenMA event`);
    }
  }

  const flat = frames.flatMap((frame) => frame.events);
  const canonicalTypes = flat.filter((event) => event.type !== "vendor.event").map((event) => event.type);
  const vendorNames = flat.filter((event) => event.type === "vendor.event").map(vendorName);
  const startAt = canonicalTypes.findIndex((type) => type === "turn.queued" || type === "turn.started");
  const messageAt = canonicalTypes.findIndex((type) => type === "agent.message_chunk");
  const completedAt = canonicalTypes.findIndex((type) => type === "turn.completed");

  if (startAt < 0) failures.push("missing start event (turn.queued or turn.started)");
  if (messageAt < 0) failures.push("missing assistant message (agent.message_chunk)");
  else if (startAt >= 0 && messageAt < startAt) failures.push("assistant message occurred before the start event");
  if (completedAt < 0) failures.push("missing completion (turn.completed)");
  else if (messageAt >= 0 && completedAt < messageAt) failures.push("completion occurred before the assistant message");
  if (!sawDone) failures.push("stream ended without a done event");
  const userAt = canonicalTypes.findIndex((type) => type === "user.message");
  if (options.requireUserMessage && userAt < 0) failures.push("missing user message (user.message)");
  if (userAt >= 0 && messageAt >= 0 && userAt > messageAt) {
    failures.push("user.message occurred after the assistant message");
  }
  if (frames.some((frame) => interactionType(frame.raw) === "user-message-appended") && userAt < 0) {
    failures.push("user-message-appended did not decode to user.message");
  }

  const toolFrames = frames.filter((frame) => frame.raw.event === "tool_call");
  if (toolFrames.length > 0) {
    const statuses = new Set(toolFrames.map((frame) => toolStatus(frame.raw)));
    const toolTypes = new Set(toolFrames.flatMap((frame) => frame.events.map((event) => event.type)));
    if (statuses.has("running") && !toolTypes.has("tool.started")) {
      failures.push("tool_call status running did not decode to tool.started");
    }
    if (statuses.has("completed") && !toolTypes.has("tool.completed")) {
      failures.push("tool_call status completed did not decode to tool.completed");
    }
    const unexpected = [...statuses].filter((status) => status !== "running" && status !== "completed" && status !== "");
    if (unexpected.length > 0) {
      failures.push(`tool_call status outside running|completed: ${unexpected.join(", ")}`);
    }
    if (![...toolTypes].some((type) => type === "tool.started" || type === "tool.completed")) {
      failures.push(`saw ${toolFrames.length} tool_call events and none decoded to a tool event`);
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    shapeNotes: shapeNotes(frames),
    eventCount: frames.length,
    eventNameCounts,
    canonicalTypes,
    vendorNames,
    unrecognized: [...new Set(unrecognized)],
  };
}

function shapeNotes(frames: readonly DecodedFrame[]): string[] {
  const extras = new Map<string, Set<string>>();
  const observed = new Map<string, Set<string>>();
  const nonObjects = new Set<string>();

  for (const frame of frames) {
    const body = record(frame.raw.data);
    if (!body) {
      if (frame.raw.data !== "") nonObjects.add(`${frame.raw.event} data is ${describeValue(frame.raw.data)}`);
      continue;
    }
    const expected = EXPECTED_DATA_KEYS[frame.raw.event];
    if (expected) {
      for (const key of Object.keys(body)) {
        if (!expected.has(key)) {
          const keys = extras.get(frame.raw.event) ?? new Set<string>();
          keys.add(key);
          extras.set(frame.raw.event, keys);
        }
      }
    }
    remember(observed, `${frame.raw.event} keys`, Object.keys(body).sort().join(",") || "(empty)");
    if (frame.raw.event === "interaction_update" && typeof body.type === "string") {
      remember(observed, "interaction_update.type", body.type);
    }
    if ((frame.raw.event === "status" || frame.raw.event === "tool_call" || frame.raw.event === "result") && typeof body.status === "string") {
      remember(observed, `${frame.raw.event}.status`, body.status);
    }
  }

  const notes: string[] = [];
  for (const [event, keys] of extras) {
    notes.push(`${event} has undocumented fields: ${[...keys].sort().join(", ")}`);
  }
  for (const [name, values] of observed) {
    notes.push(`${name}: ${[...values].sort().join(" | ")}`);
  }
  for (const note of nonObjects) notes.push(note);
  return notes;
}

function remember(target: Map<string, Set<string>>, key: string, value: string): void {
  const values = target.get(key) ?? new Set<string>();
  values.add(value);
  target.set(key, values);
}

export function assessRunBoundaries(
  sessionId: string,
  runs: readonly { label: string; turnId: string; frames: readonly DecodedFrame[] }[],
): string[] {
  const failures: string[] = [];
  const turnIds = runs.map((run) => run.turnId);
  if (new Set(turnIds).size !== turnIds.length) failures.push("runs do not have distinct turn ids");
  const seen = new Map<string, string>();
  for (const run of runs) {
    for (const frame of run.frames) {
      for (const event of frame.events) {
        if (event.session_id !== sessionId) {
          failures.push(`${run.label} event ${event.event_id} session_id ${event.session_id} is not ${sessionId}`);
        }
        if (event.turn_id !== run.turnId) {
          failures.push(`${run.label} event ${event.event_id} turn_id ${String(event.turn_id)} is not ${run.turnId}`);
        }
        const previous = seen.get(event.event_id);
        if (previous !== undefined && previous !== run.turnId) {
          failures.push(`event_id ${event.event_id} from turn ${previous} repeated in turn ${run.turnId}`);
        }
        seen.set(event.event_id, run.turnId);
      }
    }
  }
  return failures;
}

export function userMessageTexts(frames: readonly DecodedFrame[]): string[] {
  const texts: string[] = [];
  for (const frame of frames) {
    for (const event of frame.events) {
      if (event.type !== "user.message") continue;
      const data = record(event.data);
      if (typeof data?.text === "string") texts.push(data.text);
    }
  }
  return texts;
}

function interactionType(event: CursorCloudSseEvent): string {
  const body = record(event.data);
  return typeof body?.type === "string" ? body.type : "";
}

function toolStatus(event: CursorCloudSseEvent): string {
  const body = record(event.data);
  return typeof body?.status === "string" ? body.status : "";
}

function vendorName(event: OpenMAEvent): string {
  const data = record(event.data);
  return typeof data?.name === "string" ? data.name : "vendor.event";
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
