import { describe, expect, it } from "vitest";

import { projectConversation, normalizeSessionEvent, type WireSessionEvent } from "../src/session-events/managed.js";
import { managedSendRejection, decodeOmaQueueCancelResponse } from "../src/protocol/managed/index.js";

const ev = (type: string, fields: Record<string, unknown> = {}): WireSessionEvent => ({ type, ...fields });
const msg = (id: string, text: string, processed_at: string | null = "2026-11-01T00:00:00.000Z") =>
  ev("user.message", { id, content: [{ type: "text", text }], processed_at });
const err = (retry_status: string, message = "boom") =>
  ev("session.error", { error: { type: "unknown_error", message, retry_status } });

describe("official CMA wire mappings (PR #399 server alignment)", () => {
  it("session.error: structured message; retrying = warning, exhausted/terminal = error", () => {
    expect(normalizeSessionEvent(err("retrying", "flaky"))).toMatchObject({ kind: "notice", tone: "warning", message: "flaky", retryStatus: "retrying" });
    expect(normalizeSessionEvent(err("exhausted"))).toMatchObject({ tone: "error", retryStatus: "exhausted", message: "boom" });
    expect(normalizeSessionEvent(err("terminal"))).toMatchObject({ tone: "error", retryStatus: "terminal" });
    expect(normalizeSessionEvent(ev("session.error", { error: "legacy string" }))).toMatchObject({ tone: "error", message: "legacy string" });
  });

  it("retrying does not error the turn; exhausted + idle retries_exhausted does", () => {
    const p = projectConversation([
      msg("u1", "go"), ev("session.status_running"),
      err("retrying"), ev("session.status_rescheduled"), ev("session.status_running"),
      err("exhausted"), ev("session.status_idle", { stop_reason: { type: "retries_exhausted" } }),
    ]);
    expect(p.turns[0]!.status).toBe("errored");
    expect(p.turns[0]!.stopReason).toBe("retries_exhausted");
    const mid = projectConversation([msg("u1", "go"), ev("session.status_running"), err("retrying"), ev("session.status_rescheduled")]);
    expect(mid.turns[0]!.status).toBe("running");
  });

  it("queued rows after retries_exhausted are retained (not flushed) and marked non-withdrawable", () => {
    const p = projectConversation([
      msg("u1", "go"), ev("session.status_running"), msg("u2", "mid", null),
      err("exhausted"), ev("session.status_idle", { stop_reason: { type: "retries_exhausted" } }),
    ]);
    expect(p.sessionState).toBe("idle");
    expect(p.queued).toMatchObject([{ id: "u2", reason: "pending", retained: true }]);
    const normal = projectConversation([msg("u1", "go"), ev("session.status_running"), msg("u2", "mid", null)]);
    expect(normal.queued[0]!.retained).toBeUndefined();
  });

  it("requires_action uses event_ids; a legacy action_type is ignored", () => {
    const p = projectConversation([
      msg("u1", "go"), ev("session.status_running"),
      ev("agent.custom_tool_use", { id: "ctu_1", name: "t", input: {} }),
      ev("session.status_idle", { stop_reason: { type: "requires_action", event_ids: ["ctu_1"], action_type: "custom_tool_result" } }),
    ]);
    expect(p.sessionState).toBe("requires_action");
    expect(p.awaitingToolCallIds).toEqual(["ctu_1"]);
    expect(normalizeSessionEvent(ev("session.status_idle", { stop_reason: { type: "requires_action", action_type: "x" } })))
      .toEqual({ kind: "turn_complete", stopReason: "requires_action", raw: expect.anything() });
  });

  it("terminal error then status_terminated => terminated", () => {
    const p = projectConversation([msg("u1", "go"), ev("session.status_running"), err("terminal"), ev("session.status_terminated")]);
    expect(p.sessionState).toBe("terminated");
    expect(p.turns[0]!.status).toBe("terminated");
  });

  it("user.message 400 during requires_action is surfaced as a settle-only rejection", () => {
    const r = managedSendRejection(400, { type: "error", error: { type: "invalid_request_error", message: "Session is waiting on requires_action; only settle events are accepted" } });
    expect(r).toMatchObject({ status: 400, type: "invalid_request_error", settleOnly: true });
    expect(managedSendRejection(202, {})).toBeNull();
    expect(managedSendRejection(500, null)).toMatchObject({ settleOnly: false });
  });

  it("queue cancel accepts held_after_exhausted (cannot withdraw)", () => {
    expect(decodeOmaQueueCancelResponse({ cancelled: false, reason: "held_after_exhausted", id: "u2" }))
      .toMatchObject({ cancelled: false, reason: "held_after_exhausted" });
  });
});
