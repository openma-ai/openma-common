import { describe, expect, it } from "vitest";

import { projectAcpChatTurn } from "../src/chat-ui/acp.js";

describe("ACP chat turn projection", () => {
  it("patches one standard compaction entity in place, including summary reset and replay", () => {
    const event = (payload: unknown) => ({ payload });
    const events = [
      event({ sessionUpdate: "compaction_summary_chunk", compactionId: "c", content: { type: "text", text: "old" } }),
      event({ sessionUpdate: "agent_message_chunk", messageId: "m", content: { type: "text", text: "After boundary" } }),
      event({ sessionUpdate: "compaction_update", compactionId: "c", status: "completed", summary: [{ type: "text", text: "replacement" }], _meta: { keep: true } }),
      event({ sessionUpdate: "compaction_summary_chunk", compactionId: "c", content: { type: "text", text: " tail" } }),
    ];
    const project = (extra: unknown[] = []) => projectAcpChatTurn({ id: "t", promptText: "", status: "running", events: [...events, ...extra.map(event)] });
    const first = project();
    expect(first.items.map(item => item.kind)).toEqual(["message", "message"]);
    expect(first.items[0]).toMatchObject({ content: { compaction: { id: "c", status: "completed", summary: [{ type: "text", text: "replacement" }, { type: "text", text: " tail" }], meta: { keep: true } } } });
    expect(project([{ sessionUpdate: "compaction_update", compactionId: "c", status: "failed", summary: null, _meta: null, error: "failure" }]).items[0]).toMatchObject({ content: { compaction: { status: "failed", summary: undefined, meta: undefined, error: "failure" } } });
    expect(project([{ sessionUpdate: "compaction_update", compactionId: "c", status: "_future", error: null }]).items[0]).toMatchObject({ content: { compaction: { status: "_future", error: undefined } } });
    expect(project([{ sessionUpdate: "compaction_update", compactionId: "c", status: "cancelled", summary: [] }]).items[0]).toMatchObject({ content: { compaction: { status: "cancelled", summary: [] } } });
  });

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


describe("injected steering rich input", () => {
  it("retains the structured attachment and input identity without inventing a new turn", () => {
    const image = { id: "image-1", name: "screen.png", kind: "image", mimeType: "image/png", uri: "file:///tmp/screen.png", path: "/tmp/screen.png", data: "aW1hZ2U=" };
    const event = { schema: "oma.event.v1", event_id: "steer-event", session_id: "session", turn_id: "steer-turn", source: { kind: "user" }, occurred_at: "2026-10-23T05:00:00.000Z", type: "user.message", data: { text: "Look here", client_id: "client-steer", input_kind: "steering", outcome: "injected", active_turn_id: "active-turn", attachments: [image] } };
    const projected = projectAcpChatTurn({ id: "active-turn", promptText: "Original request", status: "running", events: [{ payload: event, receivedAt: 1792731600000 }] });
    expect(projected.id).toBe("active-turn");
    expect(projected.status).toBe("running");
    expect(projected.items.filter(item => item.kind === "user_input")).toEqual([{
      id: "active-turn:user-input:steer-turn", kind: "user_input", text: "Look here", clientId: "steer-turn",
      attachments: [image], startedAt: "2026-10-23T05:00:00.000Z",
    }]);
  });
});
