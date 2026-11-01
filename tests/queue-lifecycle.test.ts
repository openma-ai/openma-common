import { describe, expect, it } from "vitest";

import { decodeManagedSessionEvent } from "../src/protocol/managed/index.js";
import { projectCanonicalChat } from "../src/session-events/managed.js";
import { isOpenMAEvent } from "../src/session-events/openma.js";

const ctx = { sessionId: "sesn_1", ingestedAt: "2026-10-31T08:00:00.000Z" };

describe("OMA server-queue frames decode into OpenMA queue lifecycle", () => {
  it("maps system.user_message_cancelled to turn.cancelled for that message", () => {
    const decoded = decodeManagedSessionEvent({
      type: "system.user_message_cancelled",
      event_id: "sevt_q1",
      pending_seq: 3,
      session_thread_id: "sthr_primary",
      cancelled_at: Date.parse("2026-10-31T08:01:00.000Z"),
    }, ctx);
    expect(decoded.fidelity).toBe("exact");
    expect(isOpenMAEvent(decoded.event)).toBe(true);
    expect(decoded.event).toMatchObject({
      type: "turn.cancelled",
      event_id: "oma:cancelled:sevt_q1",
      occurred_at: "2026-10-31T08:01:00.000Z",
      data: { message_id: "sevt_q1", reason: "removed_from_queue" },
    });
  });

  it("maps system.user_message_steered to turn.steered", () => {
    const decoded = decodeManagedSessionEvent({
      type: "system.user_message_steered",
      event_id: "sevt_q2",
      steered_at: Date.parse("2026-10-31T08:02:00.000Z"),
    }, ctx);
    expect(decoded.event).toMatchObject({
      type: "turn.steered",
      data: { message_id: "sevt_q2" },
    });
  });

  it("leaves pending/promoted frames raw (redundant with the CMA re-emit)", () => {
    const decoded = decodeManagedSessionEvent({ type: "system.user_message_pending", event_id: "sevt_q3" }, ctx);
    expect(decoded.event.type).not.toBe("turn.queued");
  });
});

describe("projectCanonicalChat applies queue lifecycle", () => {
  const user = (id: string, text: string, processed: boolean) => ({
    type: processed ? "user.message" : "turn.queued",
    id,
    content: [{ type: "text", text }],
    delivery: processed ? "processed" : "queued",
  });

  it("drops a queued message once turn.cancelled names it", () => {
    const events = [
      user("m1", "first", true),
      { type: "session.status_running", id: "r1" },
      user("m2", "queued then removed", false),
      user("m3", "still queued", false),
      { type: "turn.cancelled", id: "oma:cancelled:m2", data: { message_id: "m2" } },
    ];
    const projection = projectCanonicalChat(events as never);
    expect(projection.queued.map((q) => q.id)).toEqual(["m3"]);
    expect(projection.turns).toHaveLength(1);
  });

  it("renders a steered message inside the running turn, not as a new turn", () => {
    const events = [
      user("m1", "write a long answer", true),
      { type: "agent.message", id: "a1", content: [{ type: "text", text: "part one" }] },
      { type: "turn.steered", id: "oma:steered:m2", data: { message_id: "m2" } },
      user("m2", "make it shorter", true),
      { type: "agent.message", id: "a2", content: [{ type: "text", text: "short" }] },
      { type: "session.status_idle", id: "i1", stop_reason: { type: "end_turn" } },
    ];
    const projection = projectCanonicalChat(events as never);
    expect(projection.queued).toEqual([]);
    expect(projection.turns).toHaveLength(1);
    expect(projection.turns[0]!.userText).toBe("write a long answer");
    expect(projection.turns[0]!.render.timeline).toContainEqual(
      expect.objectContaining({ kind: "user_input", text: "make it shorter" }),
    );
  });
});

import {
  decodeOmaQueueCancelResponse,
  encodeOmaQueueCancelResponse,
} from "../src/protocol/managed/index.js";

describe("OMA queue cancel HTTP response (enter-edit / remove)", () => {
  it("encodes success so the client can allow the edit immediately", () => {
    expect(encodeOmaQueueCancelResponse({
      cancelled: true,
      id: "sevt_1",
      cancelledAt: "2026-10-31T08:00:00.000Z",
    })).toEqual({
      cancelled: true,
      id: "sevt_1",
      cancelled_at: "2026-10-31T08:00:00.000Z",
    });
  });

  it("encodes already_processing so the client abandons the edit", () => {
    expect(encodeOmaQueueCancelResponse({
      cancelled: false,
      id: "sevt_2",
      reason: "already_processing",
      processedAt: "2026-10-31T08:00:01.000Z",
    })).toEqual({
      cancelled: false,
      reason: "already_processing",
      id: "sevt_2",
      processed_at: "2026-10-31T08:00:01.000Z",
    });
  });

  it("decodes both shapes and rejects malformed bodies", () => {
    expect(decodeOmaQueueCancelResponse({
      cancelled: true, id: "a", cancelled_at: "t",
    })).toEqual({ cancelled: true, id: "a", cancelled_at: "t" });
    expect(decodeOmaQueueCancelResponse({
      cancelled: false, reason: "already_processing", id: "b",
    })).toMatchObject({ cancelled: false, reason: "already_processing", id: "b" });
    expect(decodeOmaQueueCancelResponse({ cancelled: false, reason: "nope", id: "c" })).toBeNull();
    expect(decodeOmaQueueCancelResponse({ cancelled: true, id: "d" })).toBeNull();
  });
});
