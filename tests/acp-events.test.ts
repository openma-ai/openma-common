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

  it("routes structured Pi warning and error notifications to notices", () => {
    for (const level of ["warning", "error"]) {
      expect(parseAcpEvent({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: `Pi ${level}` },
        _meta: { piAcp: { notify: { level } } },
      })).toMatchObject({ kind: "notice", notice: `Pi ${level}` });
    }

    expect(parseAcpEvent({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Pi informational update" },
      _meta: { piAcp: { notify: { level: "info" } } },
    })).toMatchObject({ kind: "text", text: "Pi informational update" });
  });

  it("exposes Claude parentToolUseId on nested message chunks", () => {
    expect(parseAcpEvent({
      sessionUpdate: "agent_message_chunk",
      _meta: { claudeCode: { parentToolUseId: "task-parent" } },
      content: { type: "text", text: "child output" },
    })).toMatchObject({
      kind: "text",
      text: "child output",
      parentToolUseId: "task-parent",
    });
  });

  it("reads a canonical message phase without adapter metadata", () => {
    expect(parseAcpEvent({
      schema_version: "oma.event.v1",
      event_id: "message-phase-1",
      type: "agent.message_chunk",
      session_id: "session-phase",
      source: { kind: "harness", harness: "codex-acp", adapter: "codex" },
      occurred_at: "2026-08-05T00:00:00.000Z",
      data: {
        text: "Inspecting files",
        message_id: "message-commentary",
        phase: "commentary",
      },
    })).toMatchObject({
      kind: "text",
      text: "Inspecting files",
      messageId: "message-commentary",
      phase: "commentary",
    });
  });

  it("accumulates adapter terminal output metadata in the existing tool output", () => {
    const out = render(
      {
        sessionUpdate: "tool_call",
        toolCallId: "shell-1",
        title: "pnpm test",
        kind: "execute",
        status: "in_progress",
        content: [{ type: "terminal", terminalId: "shell-1" }],
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "shell-1",
        _meta: {
          terminal_output: { terminal_id: "shell-1", data: "12 tests " },
        },
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "shell-1",
        _meta: {
          terminal_output_delta: { terminal_id: "shell-1", data: "passed\n" },
        },
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "shell-1",
        _meta: {
          terminal_exit: {
            terminal_id: "shell-1",
            exit_code: 0,
            signal: null,
          },
        },
      },
    );

    expect(out.tools).toEqual([
      expect.objectContaining({
        toolCallId: "shell-1",
        status: "completed",
        rawOutput: "12 tests passed\n",
      }),
    ]);
  });

  it("accumulates Codex MCP progress metadata in the existing tool output", () => {
    const out = render(
      {
        sessionUpdate: "tool_call",
        toolCallId: "mcp-1",
        title: "mcp.docs.search",
        status: "in_progress",
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "mcp-1",
        _meta: { mcp_output_delta: { data: "Searching index" } },
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "mcp-1",
        _meta: { mcp_output_delta: { data: "Reading result" } },
      },
    );

    expect(out.tools[0]).toMatchObject({
      toolCallId: "mcp-1",
      rawOutput: "Searching index\nReading result",
    });
  });

  it("sanitizes placeholder-only thought chunks", () => {
    expect(sanitizeThoughtText("Planning\n<!-- -->\nNext")).toBe("Planning\n\nNext");
    expect(render({
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "<!-- -->" },
    }).thoughtText).toBe("");
  });

  it("keeps a Markdown plan document separate from task-list entries", () => {
    const markdown = "# Release plan\n\n1. Prepare\n2. Ship";
    const parsed = parseAcpEvent({
      sessionUpdate: "plan_update",
      plan: {
        id: "plan-1",
        content: { markdown },
      },
    });
    const out = render({
      sessionUpdate: "plan_update",
      plan: {
        id: "plan-1",
        content: { markdown },
      },
    });

    expect(parsed).toMatchObject({
      kind: "plan_document",
      document: { id: "plan-1", markdown },
    });
    expect(out.plan).toEqual([]);
    expect(out.planDocument).toEqual({ id: "plan-1", markdown });
  });

  it("preserves the planId from the current ACP Markdown plan shape", () => {
    const markdown = "# Current ACP plan\n\nShip it";
    const update = {
      sessionUpdate: "plan_update",
      plan: {
        type: "markdown",
        planId: "plan-markdown-1",
        content: markdown,
      },
    };

    expect(parseAcpEvent(update)).toMatchObject({
      kind: "plan_document",
      document: {
        id: "plan-markdown-1",
        markdown,
      },
    });
    expect(render(update).planDocument).toMatchObject({
      id: "plan-markdown-1",
      markdown,
    });
  });

  it("preserves the planId from the current ACP item plan shape", () => {
    expect(parseAcpEvent({
      sessionUpdate: "plan_update",
      plan: {
        type: "items",
        planId: "plan-items-1",
        entries: [{
          content: "Implement the adapter",
          priority: "high",
          status: "in_progress",
        }],
      },
    })).toMatchObject({
      kind: "plan",
      planId: "plan-items-1",
      plan: [{
        content: "Implement the adapter",
        priority: "high",
        status: "in_progress",
      }],
    });
  });

  it("preserves a current ACP file plan as a typed document reference", () => {
    expect(parseAcpEvent({
      sessionUpdate: "plan_update",
      plan: {
        type: "file",
        planId: "plan-file-1",
        uri: "file:///repo/PLAN.md",
      },
    })).toMatchObject({
      kind: "plan_document",
      document: {
        id: "plan-file-1",
        type: "file",
        uri: "file:///repo/PLAN.md",
      },
    });
  });

  it("removes only the canonical item plan whose planId matches", () => {
    const plan = (planId: string, content: string) => ({
      schema_version: "oma.event.v1",
      type: "plan.updated",
      data: {
        representation: "items",
        plan_id: planId,
        entries: [{ content, status: "in_progress" }],
      },
    });
    const removed = (planId: string) => ({
      schema_version: "oma.event.v1",
      type: "plan.removed",
      data: { plan_id: planId },
    });

    expect(render(plan("plan-1", "First"), removed("plan-1")).plan).toEqual([]);
    expect(render(
      plan("plan-1", "First"),
      plan("plan-2", "Second"),
      removed("plan-1"),
    ).plan).toEqual([
      { content: "Second", status: "in_progress", priority: undefined },
    ]);
  });

  it("merges canonical plan deltas by stable entry id without dropping untouched items", () => {
    expect(render(
      {
        schema_version: "oma.event.v1",
        type: "plan.updated",
        data: {
          representation: "items",
          plan_id: "cursor-todos",
          update_mode: "replace",
          entries: [
            { id: "todo-1", content: "Audit inputs", status: "in_progress" },
            { id: "todo-2", content: "Wire outputs", status: "pending" },
          ],
        },
      },
      {
        schema_version: "oma.event.v1",
        type: "plan.updated",
        data: {
          representation: "items",
          plan_id: "cursor-todos",
          update_mode: "merge",
          entries: [
            { id: "todo-1", content: "Audit inputs", status: "completed" },
            { id: "todo-3", content: "Verify replay", status: "pending" },
          ],
        },
      },
    ).plan).toEqual([
      {
        id: "todo-1",
        content: "Audit inputs",
        status: "completed",
        priority: undefined,
      },
      {
        id: "todo-2",
        content: "Wire outputs",
        status: "pending",
        priority: undefined,
      },
      {
        id: "todo-3",
        content: "Verify replay",
        status: "pending",
        priority: undefined,
      },
    ]);
  });

  it("preserves a canonical cancelled plan-entry status", () => {
    expect(parseAcpEvent({
      schema_version: "oma.event.v1",
      type: "plan.updated",
      data: {
        representation: "items",
        entries: [
          { id: "todo-cancelled", content: "Superseded work", status: "cancelled" },
        ],
      },
    })).toMatchObject({
      kind: "plan",
      plan: [{
        id: "todo-cancelled",
        content: "Superseded work",
        status: "cancelled",
      }],
    });
  });

  it("projects canonical message and thought content blocks into text", () => {
    expect(parseAcpEvent({
      schema_version: "oma.event.v1",
      type: "agent.message",
      data: {
        content: [
          { type: "text", text: "v2 answer" },
          { type: "text", text: " continued" },
        ],
      },
    })).toMatchObject({ kind: "text", text: "v2 answer continued" });
    expect(parseAcpEvent({
      schema_version: "oma.event.v1",
      type: "agent.thinking",
      data: {
        content: [{ type: "text", text: "v2 thought" }],
      },
    })).toMatchObject({ kind: "thought", text: "v2 thought" });
  });
});
