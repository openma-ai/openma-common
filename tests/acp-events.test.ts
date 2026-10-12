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

interface RecordedEvent {
  type: string;
  turn_id?: string;
  seq?: number;
  data?: Record<string, unknown>;
}

function recordedEvents(): RecordedEvent[] {
  return JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, "./fixtures/codex-sess-guardian-interleave.anon.json"),
      "utf8",
    ),
  ) as RecordedEvent[];
}

function routedTurnId(event: RecordedEvent): string | undefined {
  const data = event.data ?? {};
  const turnId =
    event.type === "user.message" && data.input_kind === "steering"
      ? data.active_turn_id
      : event.turn_id;
  return typeof turnId === "string" ? turnId : undefined;
}

function recordedTimelineOrder(events: readonly RecordedEvent[]) {
  const order: Array<Record<string, unknown>> = [];
  const seenTools = new Set<string>();
  let open:
    | { kind: "thought" | "assistant_text"; messageId?: string; phase?: string }
    | undefined;

  for (const event of events) {
    const data = event.data ?? {};
    if (
      event.type === "user.message" &&
      data.input_kind === "steering" &&
      data.outcome === "injected"
    ) {
      order.push({
        kind: "user_input",
        clientId: event.turn_id,
      });
      open = undefined;
      continue;
    }
    if (event.type === "tool.started") {
      const id = data.tool_call_id;
      if (typeof id === "string" && !seenTools.has(id)) {
        seenTools.add(id);
        order.push({ kind: "tool", toolCallId: id });
        open = undefined;
      }
      continue;
    }

    const kind =
      event.type === "agent.thinking"
        ? "thought"
        : event.type === "agent.message_chunk"
          ? "assistant_text"
          : undefined;
    if (!kind || typeof data.text !== "string" || data.text.length === 0) continue;
    const messageId =
      typeof data.message_id === "string" && data.message_id.length > 0
        ? data.message_id
        : undefined;
    const phase =
      kind === "assistant_text" &&
      (data.phase === "commentary" || data.phase === "final_answer")
        ? data.phase
        : undefined;
    if (
      open?.kind === kind &&
      open.messageId === messageId &&
      open.phase === phase
    ) {
      continue;
    }
    order.push({
      kind,
      segmentId: order.length,
      ...(kind === "thought" && messageId ? { messageId } : {}),
      ...(phase ? { phase } : {}),
    });
    open = { kind, messageId, phase };
  }
  return order;
}

function timelineOrder(timeline: ReturnType<typeof reduceTurn>["timeline"]) {
  return timeline.map((item) => {
    if (item.kind === "tool") {
      return { kind: item.kind, toolCallId: item.toolCallId };
    }
    if (item.kind === "user_input") {
      return { kind: item.kind, clientId: item.clientId };
    }
    return {
      kind: item.kind,
      segmentId: item.segmentId,
      ...(item.kind === "assistant_text" && item.phase
        ? { phase: item.phase }
        : {}),
      ...(item.kind === "thought" && item.messageId
        ? { messageId: item.messageId }
        : {}),
    };
  });
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

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
    expect(parseAcpEvent({
      schema: "oma.event.v1",
      type: "user.message",
      turn_id: "client-turn-1",
      data: {
        text: "Please check the cache.",
        input_kind: "steering",
        outcome: "injected",
      },
    })).toMatchObject({
      kind: "user_input",
      text: "Please check the cache.",
      clientId: "client-turn-1",
    });
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

  it("shares tool and plan snapshots while copy-on-writing changed entries", () => {
    const projector = createTurnProjector();
    for (const toolCallId of ["tool-a", "tool-b", "tool-c"]) {
      projector.apply({
        payload: {
          sessionUpdate: "tool_call",
          toolCallId,
          status: "in_progress",
        },
      });
    }
    projector.apply({
      payload: {
        sessionUpdate: "plan_update",
        plan: {
          type: "items",
          planId: "plan-1",
          entries: [{ id: "item-1", content: "Old plan", status: "pending" }],
        },
      },
    });
    const first = projector.snapshot();
    expect(projector.snapshot().tools).toBe(first.tools);
    expect(projector.snapshot().plan).toBe(first.plan);

    projector.apply({
      payload: {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-b",
        status: "completed",
      },
    });
    const second = projector.snapshot();
    expect(second.tools).not.toBe(first.tools);
    expect(second.tools[0]).toBe(first.tools[0]);
    expect(second.tools[1]).not.toBe(first.tools[1]);
    expect(second.tools[2]).toBe(first.tools[2]);
    expect(first.tools[1]?.status).toBe("in_progress");
    expect(projector.snapshot().tools).toBe(second.tools);
    expect(second.plan).toBe(first.plan);

    projector.apply({
      payload: {
        sessionUpdate: "plan_update",
        plan: {
          type: "items",
          planId: "plan-1",
          entries: [{ id: "item-1", content: "Updated plan", status: "pending" }],
        },
      },
    });
    const third = projector.snapshot();
    expect(third.plan).not.toBe(second.plan);
    expect(third.plan[0]).not.toBe(second.plan[0]);
    expect(second.plan[0]?.content).toBe("Old plan");
    expect(projector.snapshot().plan).toBe(third.plan);
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

  it("projects the recorded stream in first-arrival order and routes steering to its active turn", () => {
    const events = recordedEvents();
    const groups = new Map<string, RecordedEvent[]>();
    for (const event of events) {
      const turnId = routedTurnId(event);
      if (!turnId) continue;
      const group = groups.get(turnId) ?? [];
      group.push(event);
      groups.set(turnId, group);
    }
    const promptTurnIds = new Set(
      events
        .filter((event) =>
          event.type === "user.message" && event.data?.input_kind === "prompt",
        )
        .map((event) => event.turn_id)
        .filter((turnId): turnId is string => typeof turnId === "string"),
    );
    expect(groups.size).toBe(promptTurnIds.size);

    for (const turnId of promptTurnIds) {
      const group = groups.get(turnId);
      expect(group).toBeDefined();
      const projection = reduceTurn((group ?? []).map((payload) => ({ payload })));
      expect(timelineOrder(projection.timeline)).toEqual(recordedTimelineOrder(group ?? []));
    }

    const steering = events.filter(
      (event) =>
        event.type === "user.message" &&
        event.data?.input_kind === "steering" &&
        event.data.outcome === "injected",
    );
    expect(steering).toHaveLength(2);
    const activeTurnId = routedTurnId(steering[0]!);
    expect(activeTurnId).toBeDefined();
    const runningTurn = groups.get(activeTurnId!) ?? [];
    const runningProjection = reduceTurn(runningTurn.map((payload) => ({ payload })));
    const userInputs = runningProjection.timeline.filter(
      (item) => item.kind === "user_input",
    );
    expect(userInputs.map((item) => item.clientId)).toEqual(
      steering.map((event) => event.turn_id),
    );
    expect(runningProjection.timeline.filter((item) => item.kind === "tool")).toHaveLength(
      runningTurn.filter((event) => event.type === "tool.started").length,
    );

    const toolTurnEvents = [...groups.values()].find((group) => {
      const starts = group.filter((event) => event.type === "tool.started");
      const guardianIds = new Set(
        starts
          .filter((event) => event.data?.title === "Guardian Review")
          .map((event) => event.data?.tool_call_id as string),
      );
      const startIndexes = new Map(
        starts.map((event, index) => [event.data?.tool_call_id as string, index]),
      );
      const completions = group
        .filter((event) =>
          ["tool.completed", "tool.failed"].includes(event.type) &&
          !guardianIds.has(event.data?.tool_call_id as string),
        )
        .map((event) => startIndexes.get(event.data?.tool_call_id as string) ?? -1);
      return completions.some((index, i) =>
        completions.slice(i + 1).some((later) => later < index),
      );
    });
    expect(toolTurnEvents).toBeDefined();
    const toolEvents = toolTurnEvents ?? [];
    const toolStarts = toolEvents.filter((event) => event.type === "tool.started");
    const toolStartOrder = toolStarts.map((event) => event.data?.tool_call_id as string);
    const guardianIds = new Set(
      toolStarts
        .filter((event) => event.data?.title === "Guardian Review")
        .map((event) => event.data?.tool_call_id as string),
    );
    const terminalRealIds = toolEvents
      .filter((event) =>
        ["tool.completed", "tool.failed"].includes(event.type) &&
        !guardianIds.has(event.data?.tool_call_id as string),
      )
      .map((event) => event.data?.tool_call_id as string);
    const startIndex = new Map(toolStartOrder.map((id, index) => [id, index]));
    const terminalStartIndexes = terminalRealIds.map((id) => startIndex.get(id) ?? -1);
    expect(
      terminalStartIndexes.some((index, i) =>
        terminalStartIndexes.slice(i + 1).some((later) => later < index),
      ),
    ).toBe(true);

    const projector = createTurnProjector();
    const firstTimelineItems = new Map<string, { index: number; item: unknown }>();
    for (const event of toolEvents) {
      projector.apply({ payload: event });
      if (event.type === "tool.started") {
        const id = event.data?.tool_call_id as string;
        const timeline = projector.snapshot().timeline;
        const index = timeline.findIndex(
          (item) => item.kind === "tool" && item.toolCallId === id,
        );
        firstTimelineItems.set(id, { index, item: timeline[index] });
      }
    }
    const finalSnapshot = projector.snapshot();
    for (const [id, first] of firstTimelineItems) {
      expect(finalSnapshot.timeline[first.index]).toBe(first.item);
      expect(finalSnapshot.tools[toolStartOrder.indexOf(id)]?.toolCallId).toBe(id);
    }
    expect(
      finalSnapshot.tools
        .filter((tool) => tool.title === "Guardian Review")
        .every((tool) => tool.status === "completed"),
    ).toBe(true);
  });

  it("keeps incremental snapshots equal to the reducer after every routed real event", () => {
    const events = recordedEvents();
    const prefixes = new Map<string, RecordedEvent[]>();
    const projectors = new Map<string, ReturnType<typeof createTurnProjector>>();

    for (const event of events) {
      const turnId = routedTurnId(event);
      if (!turnId) continue;
      const prefix = prefixes.get(turnId) ?? [];
      prefix.push(event);
      prefixes.set(turnId, prefix);
      const projector =
        projectors.get(turnId) ?? createTurnProjector();
      projectors.set(turnId, projector);
      projector.apply({ payload: event });
      expect(projector.snapshot()).toEqual(
        reduceTurn(prefix.map((payload) => ({ payload }))),
      );
    }
    expect([...prefixes.values()].reduce((count, prefix) => count + prefix.length, 0)).toBe(
      events.length,
    );
  });

  it("preserves tool order and final states across seeded cross-tool update permutations", () => {
    const events = recordedEvents();
    const turnId = events
      .filter((event) => event.type === "user.message" && event.data?.input_kind === "prompt")
      .map((event) => event.turn_id)
      .find((id): id is string => typeof id === "string");
    const turnEvents = events.filter((event) => event.turn_id === turnId);
    const starts = turnEvents.filter((event) => event.type === "tool.started");
    const updates = turnEvents.filter((event) =>
      ["tool.progress", "tool.completed", "tool.failed"].includes(event.type),
    );
    const startsById = new Set(starts.map((event) => event.data?.tool_call_id));
    const updatesById = new Map<string, RecordedEvent[]>();
    for (const event of updates) {
      const id = event.data?.tool_call_id;
      if (typeof id !== "string") continue;
      const lane = updatesById.get(id) ?? [];
      lane.push(event);
      updatesById.set(id, lane);
    }
    expect(starts.length).toBeGreaterThan(1);
    expect([...updatesById.keys()].every((id) => startsById.has(id))).toBe(true);

    const startOrder = starts.map((event) => event.data?.tool_call_id as string);
    const baseline = reduceTurn([...starts, ...updates].map((payload) => ({ payload })));
    const random = seededRandom(0x79c0ffee);
    for (let permutation = 0; permutation < 200; permutation += 1) {
      const lanes = [...updatesById.values()].map((lane) => ({
        lane,
        index: 0,
      }));
      const interleaved: RecordedEvent[] = [];
      while (lanes.some(({ lane, index }) => index < lane.length)) {
        const available = lanes.filter(({ lane, index }) => index < lane.length);
        const next = available[Math.floor(random() * available.length)]!;
        interleaved.push(next.lane[next.index]!);
        next.index += 1;
      }
      const projection = reduceTurn([...starts, ...interleaved].map((payload) => ({ payload })));
      expect(
        projection.timeline.map((item) =>
          item.kind === "tool" ? item.toolCallId : item.kind,
        ),
      ).toEqual(startOrder);
      expect(projection.tools).toEqual(baseline.tools);
    }
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
