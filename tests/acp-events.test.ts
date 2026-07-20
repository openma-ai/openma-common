import { describe, expect, it } from "vitest";

import { parseAcpEvent, reduceTurn, sanitizeThoughtText } from "../src/session-events/acp.js";

const render = (...payloads: unknown[]) => reduceTurn(payloads.map((payload) => ({ payload })));

describe("ACP event adapter", () => {
  it("follows the v1 session/update message and tool lifecycle", () => {
    const out = render(
      {
        sessionId: "acp-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "m1",
          content: { type: "text", text: "Before " },
        },
      },
      {
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        title: "Read notes.md",
        kind: "read",
        status: "pending",
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-1",
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: "done" } }],
      },
      {
        sessionUpdate: "agent_message_chunk",
        messageId: "m1",
        content: { type: "text", text: "after." },
      },
    );

    expect(out.assistantText).toBe("Before after.");
    expect(out.tools).toEqual([
      expect.objectContaining({ toolCallId: "tool-1", status: "completed" }),
    ]);
    expect(out.timeline).toEqual([
      { kind: "assistant_text", text: "Before " },
      { kind: "tool", toolCallId: "tool-1" },
      { kind: "assistant_text", text: "after." },
    ]);
  });

  it("preserves adapter metadata and routes system notices away from the answer", () => {
    const warning =
      "Warning: Skill descriptions were shortened to fit the 2% skills context budget. " +
      "Codex can still see every skill, but some descriptions are shorter.";
    expect(parseAcpEvent({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: warning },
    })).toMatchObject({ kind: "notice", notice: warning });

    const out = render(
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: warning } },
      {
        sessionUpdate: "tool_call",
        toolCallId: "child",
        _meta: { claudeCode: { toolName: "Read", parentToolUseId: "parent" } },
      },
    );
    expect(out.assistantText).toBe("");
    expect(out.tools[0]).toMatchObject({
      toolName: "Read",
      parentToolUseId: "parent",
      meta: { claudeCode: { parentToolUseId: "parent" } },
    });
  });

  it("sanitizes placeholder-only thought chunks", () => {
    expect(sanitizeThoughtText("Planning\n<!-- -->\nNext")).toBe("Planning\n\nNext");
    expect(render({
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "<!-- -->" },
    }).thoughtText).toBe("");
  });
});
