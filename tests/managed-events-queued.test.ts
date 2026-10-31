import { describe, expect, it } from "vitest";

import {
  projectCanonicalChat,
  projectCanonicalChatTurns,
  projectConversation,
  type WireSessionEvent,
} from "../src/session-events/managed.js";

const ev = (type: string, fields: Record<string, unknown> = {}): WireSessionEvent => ({ type, ...fields });
const msg = (id: string, text: string, processed_at: string | null = "2026-10-31T00:00:00.000Z") =>
  ev("user.message", { id, content: [{ type: "text", text }], processed_at });
const texts = (turns: ReturnType<typeof projectCanonicalChatTurns>) => turns.map((turn) => [turn.userText, turn.render.assistantText, turn.status]);

describe("queued user messages (official processed_at semantics)", () => {
  it("keeps a processed_at:null message out of the running turn", () => {
    const projection = projectCanonicalChat([
      msg("u1", "first"),
      ev("session.status_running"),
      msg("u2", "second", null),
      ev("agent.message", { id: "a1", content: "reply one" }),
    ]);
    expect(texts(projection.turns)).toEqual([["first", "reply one", "running"]]);
    expect(projection.queued).toMatchObject([{ id: "u2", text: "second", reason: "pending" }]);
  });

  it("starts the queued message's own turn once the same id is stamped", () => {
    const projection = projectCanonicalChat([
      msg("u1", "first"),
      ev("session.status_running"),
      msg("u2", "second", null),
      ev("agent.message", { id: "a1", content: "reply one" }),
      ev("session.status_idle", { stop_reason: { type: "end_turn" } }),
      msg("u2", "second"),
      ev("session.status_running"),
      ev("agent.message", { id: "a2", content: "reply two" }),
      ev("session.status_idle", { stop_reason: { type: "end_turn" } }),
    ]);
    expect(projection.queued).toEqual([]);
    expect(texts(projection.turns)).toEqual([
      ["first", "reply one", "completed"],
      ["second", "reply two", "completed"],
    ]);
  });

  it("legacy accept-time stamping: a mid-turn message waits for the running turn to end", () => {
    const events = [
      msg("u1", "first"),
      ev("session.status_running"),
      msg("u2", "second"),
      ev("agent.message", { id: "a1", content: "reply one" }),
    ];
    const running = projectCanonicalChat(events);
    expect(texts(running.turns)).toEqual([["first", "reply one", "running"]]);
    expect(running.queued).toMatchObject([{ id: "u2", reason: "deferred" }]);

    // Idle reached but the next turn has not produced events yet: still queued.
    const idle = projectCanonicalChat([...events, ev("session.status_idle")]);
    expect(texts(idle.turns)).toEqual([["first", "reply one", "completed"]]);
    expect(idle.queued.map((item) => item.id)).toEqual(["u2"]);

    const done = projectCanonicalChat([
      ...events,
      ev("session.status_idle"),
      ev("session.status_running"),
      ev("agent.message", { id: "a2", content: "reply two" }),
      ev("session.status_idle"),
    ]);
    expect(done.queued).toEqual([]);
    expect(texts(done.turns)).toEqual([
      ["first", "reply one", "completed"],
      ["second", "reply two", "completed"],
    ]);
  });

  it("preserves FIFO order for several deferred messages", () => {
    const { turns, queued } = projectConversation([
      msg("u1", "first"),
      ev("session.status_running"),
      msg("u2", "second"),
      msg("u3", "third"),
      ev("session.status_idle"),
      ev("session.status_running"),
      ev("agent.message", { id: "a2", content: "two" }),
      ev("session.status_idle"),
    ]);
    expect(turns.map((turn) => turn.id)).toEqual(["u1", "u2"]);
    expect(queued.map((item) => item.id)).toEqual(["u3"]);
  });

  it("interrupt ends the turn and the next message starts a new one", () => {
    const turns = projectCanonicalChatTurns([
      msg("u1", "long task"),
      ev("session.status_running"),
      ev("user.interrupt", { id: "i1" }),
      ev("session.status_idle", { stop_reason: { type: "end_turn" } }),
      msg("u2", "next"),
      ev("session.status_running"),
      ev("agent.message", { id: "a2", content: "ok" }),
      ev("session.status_idle", { stop_reason: { type: "end_turn" } }),
    ]);
    expect(texts(turns)).toEqual([["long task", "", "completed"], ["next", "ok", "completed"]]);
  });

  it("can opt out of the legacy fallback", () => {
    const { turns, queued } = projectConversation([
      msg("u1", "first"),
      ev("session.status_running"),
      msg("u2", "steer"),
      ev("agent.message", { id: "a1", content: "reply" }),
    ], { deferMidTurnUserMessages: false });
    expect(queued).toEqual([]);
    expect(turns.map((turn) => turn.id)).toEqual(["u1", "u2"]);
  });
});
