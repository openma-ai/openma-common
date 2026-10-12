import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createTurnProjector,
  parseAcpEvent,
  reduceTurn,
  sanitizeThoughtText,
} from "../src/session-events/acp.js";

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
      { kind: "assistant_text", segmentId: 0, text: "Before " },
      { kind: "tool", toolCallId: "tool-1" },
      { kind: "assistant_text", segmentId: 2, text: "after." },
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

describe("incremental ACP turn projection", () => {
  it("T2 appends chunks only to the open segment with a matching message and phase", () => {
    const out = render(
      {
        sessionUpdate: "agent_message_chunk",
        messageId: "message-1",
        phase: "commentary",
        content: { type: "text", text: "Before " },
      },
      {
        sessionUpdate: "agent_message_chunk",
        messageId: "message-1",
        phase: "commentary",
        content: { type: "text", text: "tooling. " },
      },
      {
        sessionUpdate: "agent_message_chunk",
        messageId: "message-2",
        phase: "commentary",
        content: { type: "text", text: "Between." },
      },
      {
        sessionUpdate: "agent_message_chunk",
        messageId: "message-1",
        phase: "commentary",
        content: { type: "text", text: "Reopened." },
      },
      {
        sessionUpdate: "agent_message_chunk",
        messageId: "message-1",
        phase: "final_answer",
        content: { type: "text", text: "After." },
      },
      {
        sessionUpdate: "agent_message_chunk",
        messageId: "message-1",
        phase: "final_answer",
        content: { type: "text", text: " answer." },
      },
      {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "First thought. " },
      },
      {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "Second thought." },
      },
    );

    expect(out.timeline).toEqual([
      { kind: "assistant_text", segmentId: 0, text: "Before tooling. ", phase: "commentary" },
      { kind: "assistant_text", segmentId: 1, text: "Between.", phase: "commentary" },
      { kind: "assistant_text", segmentId: 2, text: "Reopened.", phase: "commentary" },
      { kind: "assistant_text", segmentId: 3, text: "After. answer.", phase: "final_answer" },
      { kind: "thought", segmentId: 4, text: "First thought. Second thought." },
    ]);
  });

  it("T3 patches known tools in place without closing the open thought segment", () => {
    const projector = createTurnProjector();
    const apply = (payload: unknown) => projector.apply({ payload });
    apply({
      sessionUpdate: "agent_thought_chunk",
      messageId: "thought-before",
      content: { type: "text", text: "Before tool." },
    });
    apply({
      sessionUpdate: "tool_call",
      toolCallId: "tool-1",
      title: "First title",
      status: "in_progress",
    });
    apply({
      sessionUpdate: "agent_thought_chunk",
      messageId: "thought-after",
      content: { type: "text", text: "Still " },
    });
    const firstSnapshot = projector.snapshot();

    apply({
      sessionUpdate: "tool_call",
      toolCallId: "tool-1",
      title: "Updated title",
      status: "in_progress",
    });
    apply({
      sessionUpdate: "tool_call_update",
      toolCallId: "tool-1",
      status: "completed",
    });
    apply({
      sessionUpdate: "agent_thought_chunk",
      messageId: "thought-after",
      content: { type: "text", text: "open." },
    });
    const secondSnapshot = projector.snapshot();

    expect(secondSnapshot.timeline).toEqual([
      { kind: "thought", segmentId: 0, text: "Before tool.", messageId: "thought-before" },
      { kind: "tool", toolCallId: "tool-1" },
      { kind: "thought", segmentId: 2, text: "Still open.", messageId: "thought-after" },
    ]);
    expect(secondSnapshot.tools).toHaveLength(1);
    expect(secondSnapshot.tools[0]).toMatchObject({
      toolCallId: "tool-1",
      title: "Updated title",
      status: "completed",
    });
    expect(firstSnapshot.tools[0]?.status).toBe("in_progress");
    expect(firstSnapshot.timeline).not.toBe(secondSnapshot.timeline);
    expect(firstSnapshot.tools).not.toBe(secondSnapshot.tools);
  });

  it("T4 starts a new segment when a closed message id returns", () => {
    const out = render(
      {
        sessionUpdate: "agent_thought_chunk",
        messageId: "thought-1",
        content: { type: "text", text: "First segment." },
      },
      {
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        title: "Read",
        status: "in_progress",
      },
      {
        sessionUpdate: "agent_thought_chunk",
        messageId: "thought-1",
        content: { type: "text", text: "Second segment." },
      },
    );

    expect(out.timeline).toEqual([
      { kind: "thought", segmentId: 0, text: "First segment.", messageId: "thought-1" },
      { kind: "tool", toolCallId: "tool-1" },
      { kind: "thought", segmentId: 2, text: "Second segment.", messageId: "thought-1" },
    ]);
    expect(out.currentThoughtText).toBe("Second segment.");
  });

  it("T6 projects only injected steering messages as inline user inputs", () => {
    const out = render(
      {
        schema_version: "oma.event.v1",
        type: "agent.message",
        turn_id: "turn-a",
        data: { text: "Working." },
      },
      {
        schema: "oma.event.v1",
        type: "user.message",
        turn_id: "client-turn-1",
        data: {
          text: "Please check the cache.",
          input_kind: "steering",
          outcome: "injected",
          active_turn_id: "turn-a",
        },
      },
      {
        schema_version: "oma.event.v1",
        type: "user.message",
        turn_id: "client-turn-2",
        data: {
          text: "A normal prompt.",
          input_kind: "prompt",
          outcome: "injected",
        },
      },
    );

    expect(out.timeline).toEqual([
      { kind: "assistant_text", segmentId: 0, text: "Working." },
      {
        kind: "user_input",
        text: "Please check the cache.",
        clientId: "client-turn-1",
      },
    ]);
  });

  it("structurally shares unchanged timeline items across snapshots", () => {
    const projector = createTurnProjector();
    const apply = (payload: unknown) => projector.apply({ payload });
    apply({
      sessionUpdate: "agent_message_chunk",
      messageId: "message-before",
      content: { type: "text", text: "Earlier." },
    });
    apply({
      sessionUpdate: "agent_thought_chunk",
      messageId: "thought-live",
      content: { type: "text", text: "Draft" },
    });
    const firstSnapshot = projector.snapshot();

    expect(projector.snapshot().timeline).toBe(firstSnapshot.timeline);
    apply({
      sessionUpdate: "agent_thought_chunk",
      messageId: "thought-live",
      content: { type: "text", text: " updated" },
    });
    const secondSnapshot = projector.snapshot();

    expect(secondSnapshot.timeline).not.toBe(firstSnapshot.timeline);
    expect(secondSnapshot.timeline[0]).toBe(firstSnapshot.timeline[0]);
    expect(secondSnapshot.timeline[1]).not.toBe(firstSnapshot.timeline[1]);
    expect(firstSnapshot.timeline[1]).toMatchObject({
      segmentId: 1,
      text: "Draft",
    });
    expect(secondSnapshot.timeline[1]).toMatchObject({
      segmentId: 1,
      text: "Draft updated",
    });
  });

  it("preserves first-arrival order and deduplicates interleaved Codex Guardian tools", () => {
    const fixture = JSON.parse(
      readFileSync(
        resolve(import.meta.dirname, "./fixtures/codex-guardian-interleave.json"),
        "utf8",
      ),
    ) as unknown[];
    const out = render(...fixture);

    expect(out.timeline.map((item) =>
      item.kind === "tool" ? item.toolCallId : item.kind,
    )).toEqual([
      "thought",
      "assistant_text",
      "guardian_assessment:r0",
      "c1",
      "guardian_assessment:r1",
      "c2",
      "guardian_assessment:r2",
      "thought",
      "guardian_assessment:orphan",
      "assistant_text",
    ]);
    expect(out.timeline.filter((item) => item.kind === "tool")).toHaveLength(6);
    expect(out.tools.map((tool) => tool.toolCallId)).toEqual([
      "guardian_assessment:r0",
      "c1",
      "guardian_assessment:r1",
      "c2",
      "guardian_assessment:r2",
      "guardian_assessment:orphan",
    ]);
    expect(out.tools.at(-1)).toMatchObject({
      toolCallId: "guardian_assessment:orphan",
      kind: "think",
      title: "Guardian Review",
      status: "completed",
    });
    expect(out.timeline.at(-1)).toMatchObject({
      kind: "assistant_text",
      phase: "final_answer",
      text: "Everything is ready. The tests passed.",
    });
  });

  it("T7 keeps per-event projection cost linear from 4.5k to 45k events", () => {
    const buildEvents = (cycles: number) => {
      const events: Array<{ payload: unknown }> = [];
      for (let cycle = 0; cycle < cycles; cycle += 1) {
        for (let chunk = 0; chunk < 20; chunk += 1) {
          events.push({
            payload: {
              sessionUpdate: "agent_thought_chunk",
              content: {
                type: "text",
                text: `think ${cycle} ${chunk} `,
              },
            },
          });
        }
        const toolCallId = `tool-${cycle}`;
        events.push({
          payload: {
            sessionUpdate: "tool_call",
            toolCallId,
            title: `Run step ${cycle}`,
            kind: "execute",
            status: "pending",
          },
        });
        for (let update = 0; update < 3; update += 1) {
          events.push({
            payload: {
              sessionUpdate: "tool_call_update",
              toolCallId,
              status: "in_progress",
              content: [{
                type: "content",
                content: { type: "text", text: "line\n".repeat(40) },
              }],
            },
          });
        }
        events.push({
          payload: {
            sessionUpdate: "tool_call_update",
            toolCallId,
            status: "completed",
          },
        });
        for (let chunk = 0; chunk < 20; chunk += 1) {
          events.push({
            payload: {
              sessionUpdate: "agent_message_chunk",
              content: {
                type: "text",
                text: `| col ${chunk} | **md** \`code\` |\n`,
              },
            },
          });
        }
      }
      return events;
    };
    const measurePerEvent = (events: readonly { payload: unknown }[]) => {
      const projector = createTurnProjector();
      const start = performance.now();
      for (const event of events) projector.apply(event);
      projector.snapshot();
      return (performance.now() - start) / events.length;
    };

    const smallEvents = buildEvents(100);
    const largeEvents = buildEvents(1000);
    measurePerEvent(smallEvents);
    const smallPerEvent = measurePerEvent(smallEvents);
    const largePerEvent = measurePerEvent(largeEvents);

    expect(smallEvents).toHaveLength(4_500);
    expect(largeEvents).toHaveLength(45_000);
    expect(largePerEvent / smallPerEvent).toBeLessThan(3);
  });
});
