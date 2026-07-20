import { describe, expect, it } from "vitest";

import {
  normalizeSessionEvent,
  projectCanonicalChatTurns,
  projectConversationTurns,
  type WireSessionEvent,
} from "../src/session-events/managed.js";

const ev = (type: string, fields: Record<string, unknown> = {}): WireSessionEvent => ({ type, ...fields });

describe("Managed Agents event adapter", () => {
  it("normalizes messages, tool families, and lifecycle events", () => {
    expect(normalizeSessionEvent(ev("agent.message_chunk", { message_id: "m1", delta: "Hi" }))).toMatchObject({
      kind: "assistant_delta",
      id: "m1",
      text: "Hi",
    });
    expect(normalizeSessionEvent(ev("agent.custom_tool_use", { id: "t1", name: "deploy" }))).toMatchObject({
      kind: "tool_use",
      tool: { id: "t1", family: "custom", name: "deploy" },
    });
    expect(normalizeSessionEvent(ev("session.status_idle"))).toMatchObject({ kind: "turn_complete" });
  });

  it("projects a stable turn and pairs tool calls with results", () => {
    const turns = projectConversationTurns([
      ev("user.message", { id: "u1", content: "Ship it" }),
      ev("agent.tool_use", { id: "t1", name: "bash", input: { cmd: "pnpm test" } }),
      ev("agent.tool_result", { tool_use_id: "t1", content: "passed" }),
      ev("agent.message", { id: "a1", content: "Done" }),
      ev("session.status_idle"),
    ]);

    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ id: "u1", status: "completed" });
    expect(turns[0]?.items).toMatchObject([
      { kind: "message", role: "user", text: "Ship it" },
      { kind: "tool", tool: { id: "t1", status: "completed", output: "passed" } },
      { kind: "message", role: "assistant", text: "Done" },
    ]);
  });

  it("projects Managed events into the same TurnRender model used by Backchat", () => {
    const turns = projectCanonicalChatTurns([
      ev("user.message", { id: "u1", content: "Ship it" }),
      ev("agent.thinking", { id: "th1", content: "Checking" }),
      ev("agent.tool_use", { id: "t1", name: "bash", input: { cmd: "pnpm test" } }),
      ev("agent.tool_result", { tool_use_id: "t1", content: "passed" }),
      ev("agent.message", { id: "a1", content: "Done" }),
      ev("session.status_idle"),
    ]);

    expect(turns[0]).toMatchObject({
      id: "u1",
      status: "completed",
      userText: "Ship it",
      render: {
        thoughtText: "Checking",
        assistantText: "Done",
        tools: [{
          toolCallId: "t1",
          title: "bash",
          status: "completed",
          rawInput: { cmd: "pnpm test" },
          rawOutput: "passed",
        }],
        timeline: [
          { kind: "thought", messageId: "th1", text: "Checking" },
          { kind: "tool", toolCallId: "t1" },
          { kind: "assistant_text", text: "Done" },
        ],
      },
    });
  });
});
