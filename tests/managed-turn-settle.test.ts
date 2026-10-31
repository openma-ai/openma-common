import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  orderSessionEventsCausally,
  projectCanonicalChat,
  type WireSessionEvent,
} from "../src/session-events/managed.js";

function fixture(name: string): WireSessionEvent[] {
  const url = new URL(`./fixtures/managed-sessions/${name}.json`, import.meta.url);
  return (JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as { data: WireSessionEvent[] }).data;
}

const statuses = (events: WireSessionEvent[], options = {}) =>
  projectCanonicalChat(events, options).turns.map((turn) => turn.status);

describe("projectCanonicalChat turn settle (real sessions)", () => {
  it("b5c5: tool round-trips stay in one turn; interrupt + same-ms idle settles as interrupted", () => {
    const events = fixture("session_b5c5f215c4bb4ee3a6919192ba1d1805");
    const projection = projectCanonicalChat(events);
    expect(projection.turns.map((t) => t.status)).toEqual(["interrupted", "completed"]);
    expect(projection.turns.every((t) => t.userText.length > 0)).toBe(true);
    // The trailing same-ms agent.message belongs to its prompt's turn.
    expect(projection.turns[1]!.userText).toContain("say Q");
    expect(projection.turns[1]!.render.assistantText).toContain("Q");
    expect(projection.sessionState).toBe("idle");
    expect(projection.activeTurnId).toBeUndefined();
    expect(projection.awaitingToolCallIds).toEqual([]);
  });

  it("e434: parked on requires_action is one awaiting turn with queued messages kept queued", () => {
    const events = fixture("session_e434d0ba91be4541bde691a99938fc10");
    const projection = projectCanonicalChat(events);
    expect(projection.turns.map((t) => t.status)).toEqual(["awaiting"]);
    expect(projection.sessionState).toBe("requires_action");
    expect(projection.activeTurnId).toBe(projection.turns[0]!.id);
    expect(projection.awaitingToolCallIds.length).toBeGreaterThan(0);
    expect(projection.turns[0]!.awaitingToolCallIds).toEqual(projection.awaitingToolCallIds);
    expect(projection.queued.length).toBe(15);
  });

  it("d852: no headless or stale running turns once the session is idle", () => {
    const events = fixture("session_d852b9f8b2634477ac2d87ca7a1ebcd8");
    const projection = projectCanonicalChat(events);
    expect(projection.turns.map((t) => t.status)).toEqual([
      "interrupted", "completed", "completed", "completed", "completed",
    ]);
    expect(projection.turns.every((t) => t.userText.length > 0)).toBe(true);
    expect(projection.activeTurnId).toBeUndefined();
  });
});

describe("projectCanonicalChat ordering and settle", () => {
  const base = (type: string, at: string, extra: Record<string, unknown> = {}): WireSessionEvent => ({
    type, id: `${type}-${at}-${Math.random()}`, processed_at: at, ...extra,
  });

  it("sorts by seq when every event has one", () => {
    const events = [
      { type: "agent.message", id: "m", seq: 3 },
      { type: "user.message", id: "u", seq: 1 },
      { type: "session.status_idle", id: "i", seq: 4, stop_reason: { type: "end_turn" } },
      { type: "session.status_running", id: "r", seq: 2 },
    ];
    expect(orderSessionEventsCausally(events).map((e) => e.id)).toEqual(["u", "r", "m", "i"]);
  });

  it("moves idle after same-ms events without seq", () => {
    const t = "2026-10-31T16:15:34.374Z";
    const events = [
      base("user.message", "2026-10-31T16:15:32.299Z", { content: [{ type: "text", text: "hi" }] }),
      base("session.status_idle", t, { stop_reason: { type: "end_turn" } }),
      base("agent.message", t, { content: [{ type: "text", text: "yo" }] }),
    ];
    const projection = projectCanonicalChat(events);
    expect(projection.turns).toHaveLength(1);
    expect(projection.turns[0]!.status).toBe("completed");
    expect(projection.turns[0]!.render.assistantText).toBe("yo");
  });

  it("host idle status settles a turn still running in the log", () => {
    const events = [
      base("user.message", "2026-10-31T16:00:00.000Z", { content: [{ type: "text", text: "hi" }] }),
      base("session.status_running", "2026-10-31T16:00:00.010Z"),
      base("agent.message", "2026-10-31T16:00:01.000Z", { content: [{ type: "text", text: "partial" }] }),
    ];
    expect(statuses(events)).toEqual(["running"]);
    expect(statuses(events, { sessionStatus: "idle" })).toEqual(["completed"]);
    expect(projectCanonicalChat(events).activeTurnId).toBe(projectCanonicalChat(events).turns[0]!.id);
  });

  it("requires_action then tool result and running resumes the same turn", () => {
    const events = [
      base("user.message", "2026-10-31T16:00:00.000Z", { content: [{ type: "text", text: "go" }] }),
      base("agent.custom_tool_use", "2026-10-31T16:00:01.000Z", { id: "call_1", name: "bash" }),
      base("session.status_idle", "2026-10-31T16:00:01.001Z", { stop_reason: { type: "requires_action", event_ids: ["call_1"] } }),
      base("user.message", "2026-10-31T16:00:01.500Z", { processed_at: null, id: "queued_1", content: [{ type: "text", text: "later" }] }),
    ];
    const parked = projectCanonicalChat(events);
    expect(parked.turns.map((t) => t.status)).toEqual(["awaiting"]);
    expect(parked.awaitingToolCallIds).toEqual(["call_1"]);
    expect(parked.queued.map((q) => q.id)).toEqual(["queued_1"]);
    const resumed = projectCanonicalChat([
      ...events,
      base("agent.tool_result", "2026-10-31T16:00:02.000Z", { tool_use_id: "call_1", content: "ok" }),
      base("session.status_running", "2026-10-31T16:00:02.010Z"),
      base("agent.message", "2026-10-31T16:00:03.000Z", { content: [{ type: "text", text: "done" }] }),
      base("session.status_idle", "2026-10-31T16:00:03.000Z", { stop_reason: { type: "end_turn" } }),
    ]);
    expect(resumed.turns.map((t) => t.status)).toEqual(["completed"]);
    expect(resumed.awaitingToolCallIds).toEqual([]);
  });
});

describe("projectCanonicalChat over OpenMA-decoded events (Console path)", async () => {
  const { decodeManagedSessionEvent } = await import("../src/protocol/managed/index.js");
  const decode = (events: WireSessionEvent[]) => events
    .map((event) => (decodeManagedSessionEvent as (e: unknown, c: unknown) => { event?: unknown } | undefined)(event, { sessionId: "s" })?.event)
    .filter(Boolean) as WireSessionEvent[];
  it.each([
    ["session_b5c5f215c4bb4ee3a6919192ba1d1805", ["interrupted", "completed"], "idle"],
    ["session_e434d0ba91be4541bde691a99938fc10", ["awaiting"], "requires_action"],
    ["session_d852b9f8b2634477ac2d87ca7a1ebcd8", ["interrupted", "completed", "completed", "completed", "completed"], "idle"],
  ])("%s", (name, expected, state) => {
    const projection = projectCanonicalChat(decode(fixture(name)));
    expect(projection.turns.map((t) => t.status)).toEqual(expected);
    expect(projection.sessionState).toBe(state);
  });
});
