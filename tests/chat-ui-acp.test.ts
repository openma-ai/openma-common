import { describe, expect, it } from "vitest";

import { projectAcpChatTurn } from "../src/chat-ui/acp.js";

describe("ACP chat turn projection", () => {
  it("uses positional ids when a host supplies legacy timeline items without segment ids", () => {
    const turn = projectAcpChatTurn({
      id: "turn-positional",
      promptText: "",
      status: "complete",
      events: [],
    }, {
      rendered: {
        thoughtText: "Thought.",
        currentThoughtText: "",
        assistantText: "Answer.",
        tools: [],
        plan: [],
        hasPlanLifecycle: false,
        notes: [],
        timeline: [
          { kind: "assistant_text", text: "Answer." },
          { kind: "thought", text: "Thought." },
          { kind: "user_input", text: "Steer." },
        ],
      },
    });

    expect(turn.items.map((item) => item.id)).toEqual([
      "turn-positional:assistant:0",
      "turn-positional:thought:1",
      "turn-positional:user-input:2",
    ]);
    expect(turn.items[2]).toMatchObject({
      kind: "user_input",
      text: "Steer.",
    });
  });

  it("projects chronological thought, tool, and final-answer parts", () => {
    const turn = projectAcpChatTurn({
      id: "turn-1",
      promptText: "Inspect it",
      status: "running",
      startedAt: 1_000,
      events: [
        {
          payload: {
            sessionUpdate: "agent_thought_chunk",
            messageId: "thought-1",
            content: { type: "text", text: "Planning" },
          },
        },
        {
          payload: {
            sessionUpdate: "tool_call",
            toolCallId: "read-1",
            kind: "read",
            status: "completed",
            title: "Read file",
          },
        },
        {
          payload: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Done" },
            _meta: { codex: { phase: "final_answer" } },
          },
        },
      ],
    });

    expect(turn.status).toBe("running");
    expect(turn.items.map((item) => item.kind)).toEqual([
      "message",
      "thinking",
      "tool",
      "message",
    ]);
    expect(turn.items.at(-1)).toMatchObject({
      role: "assistant",
      text: "Done",
      status: "streaming",
    });
  });

  it("settles unfinished tools when their turn is no longer running", () => {
    const turn = projectAcpChatTurn({
      id: "turn-2",
      promptText: "Run it",
      status: "complete",
      events: [{
        payload: {
          sessionUpdate: "tool_call",
          toolCallId: "run-1",
          status: "in_progress",
        },
      }],
    });

    expect(turn.items.at(-1)).toMatchObject({
      kind: "tool",
      status: "cancelled",
    });
  });
});
