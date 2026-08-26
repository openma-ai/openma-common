import { describe, expect, it } from "vitest";

import { projectAcpChatTurn } from "../src/chat-ui/acp.js";

describe("ACP chat turn projection", () => {
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
