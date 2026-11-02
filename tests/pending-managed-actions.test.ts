import { describe, expect, it } from "vitest";

import {
  pendingManagedActions,
  projectCanonicalChat,
  type WireSessionEvent,
} from "../src/session-events/managed.js";

function ev(
  type: string,
  fields: Record<string, unknown> = {},
): WireSessionEvent {
  return { type, ...fields };
}

describe("pendingManagedActions", () => {
  it("classifies always_ask tool_use as confirmation and custom_tool_use as custom_result", () => {
    const events = [
      ev("agent.tool_use", {
        id: "tool",
        name: "bash",
        input: { command: "deploy" },
        evaluated_permission: "ask",
      }),
      ev("agent.custom_tool_use", {
        id: "question",
        name: "Question",
        input: { question: "Which branch?" },
      }),
      ev("session.status_idle", {
        id: "idle",
        stop_reason: {
          type: "requires_action",
          event_ids: ["tool", "question"],
          action_type: "tool_confirmation",
        },
      }),
    ];
    expect(pendingManagedActions(events)).toMatchObject([
      { id: "tool", type: "confirmation" },
      { id: "question", type: "custom_result" },
    ]);
  });

  it("drops confirmation after user.tool_confirmation and clears on running", () => {
    const events = [
      ev("agent.tool_use", { id: "tool", name: "bash", input: { command: "ls" } }),
      ev("agent.custom_tool_use", { id: "question", name: "Question", input: {} }),
      ev("session.status_idle", {
        stop_reason: { type: "requires_action", event_ids: ["tool", "question"] },
      }),
    ];
    expect(
      pendingManagedActions([
        ...events,
        ev("user.tool_confirmation", { tool_use_id: "tool", result: "deny" }),
      ]),
    ).toMatchObject([{ id: "question" }]);
    expect(pendingManagedActions([...events, ev("session.status_running")])).toEqual(
      [],
    );
  });

  it("prefers an explicit pendingActions array when present", () => {
    const actions = [
      {
        id: "tool",
        type: "confirmation" as const,
        event: ev("agent.tool_use", { id: "tool", name: "bash" }),
      },
    ];
    expect(
      pendingManagedActions([
        ev("agent.tool_use", { id: "ignored", name: "other" }),
        ev("session.status_idle", {
          pendingActions: actions,
          stop_reason: { type: "requires_action", event_ids: ["ignored"] },
        }),
      ]),
    ).toEqual(actions);
  });
});

describe("projectCanonicalChat awaiting tool status", () => {
  it("keeps always_ask tools pending while requires_action, not completed", () => {
    const events = [
      ev("user.message", {
        id: "u1",
        content: [{ type: "text", text: "run deploy" }],
      }),
      ev("session.status_running"),
      ev("agent.tool_use", {
        id: "tool_ask",
        name: "bash",
        input: { command: "deploy" },
        evaluated_permission: "ask",
      }),
      ev("session.status_idle", {
        stop_reason: {
          type: "requires_action",
          event_ids: ["tool_ask"],
          action_type: "tool_confirmation",
        },
      }),
    ];
    const projection = projectCanonicalChat(events, { sessionStatus: "idle" });
    expect(projection.sessionState).toBe("requires_action");
    expect(projection.turns.map((t) => t.status)).toEqual(["awaiting"]);
    expect(projection.awaitingToolCallIds).toEqual(["tool_ask"]);
    const tool = projection.turns[0]!.render.tools.find(
      (t) => t.toolCallId === "tool_ask",
    );
    expect(tool?.status).toBe("pending");
    expect(tool?.status).not.toBe("completed");
    expect(tool?.status).not.toBe("in_progress");
  });
});
