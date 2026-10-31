import { describe, expect, it } from "vitest";

import { decodeManagedSessionEvent } from "../src/protocol/managed/index.js";
import { projectCanonicalChat, type WireSessionEvent } from "../src/session-events/managed.js";

// Hosts (Console) ingest CMA wire through decodeManagedSessionEvent and then
// project the OpenMA events. Lifecycle (session.running/idle) and tool
// (tool.started/completed/failed) must close turns exactly like the wire names.
const T = "2026-10-31T10:36:27.000Z";
const wire: Record<string, unknown>[] = [
  { type: "user.message", id: "m1", processed_at: T, content: [{ type: "text", text: "first" }] },
  { type: "session.status_running", id: "r1", processed_at: T },
  { type: "session.status_idle", id: "i1", processed_at: T, stop_reason: { type: "end_turn" } },
  { type: "user.interrupt", id: "x1", processed_at: T },
  { type: "user.message", id: "m2", processed_at: T, content: [{ type: "text", text: "second" }] },
  { type: "session.status_running", id: "r2", processed_at: T },
  { type: "agent.custom_tool_use", id: "tu1", processed_at: T, name: "write_file", input: { p: 1 } },
  { type: "agent.tool_result", id: "tr1", processed_at: T, tool_use_id: "tu1", is_error: true,
    content: [{ type: "text", text: "Cancelled by user" }] },
  { type: "session.status_idle", id: "i2", processed_at: T, stop_reason: { type: "end_turn" } },
  { type: "user.interrupt", id: "x2", processed_at: T },
  { type: "user.message", id: "m3", processed_at: T, content: [{ type: "text", text: "third" }] },
  { type: "session.status_running", id: "r3", processed_at: T },
  { type: "agent.message", id: "a3", processed_at: T, content: [{ type: "text", text: "ok" }] },
  { type: "session.status_idle", id: "i3", processed_at: T, stop_reason: { type: "end_turn" } },
];

const gui = (openma: { type: string; event_id: string; data?: unknown }): WireSessionEvent => {
  const data = (openma.data ?? {}) as Record<string, unknown>;
  return { type: openma.type, id: openma.event_id, data, ...(data.content !== undefined ? { content: data.content } : {}) };
};

describe("projection over decoded OpenMA events", () => {
  it("interrupt + follow-ups do not leave processed messages queued", () => {
    const events = wire.map((w) => decodeManagedSessionEvent(w as never, { sessionId: "s" })).filter(Boolean)
      .map((d) => gui(d!.event as never));
    expect(events.map((e) => e.type)).toContain("session.idle");
    const { turns, queued } = projectCanonicalChat(events);
    expect(queued).toEqual([]);
    expect(turns.map((t) => [t.userText, t.status])).toEqual([
      ["first", "completed"], ["second", "completed"], ["third", "completed"],
    ]);
    const tool = turns[1]!.render.tools[0];
    expect(tool).toMatchObject({ toolCallId: "tu1", toolName: "write_file", status: "failed" });
  });
});
