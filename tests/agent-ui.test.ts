import { describe, expect, it } from "vitest";

import {
  createAgentUIStore,
  replayAgentUIEvents,
} from "../src/agent-ui/index.js";
import {
  createOpenMAEvent,
  type OpenMAEvent,
} from "../src/session-events/openma.js";

const source = { kind: "harness" as const, harness: "managed-agents" };

function event(
  eventId: string,
  type: string,
  seq: number,
  data: unknown,
  turnId?: string,
): OpenMAEvent {
  return createOpenMAEvent({
    event_id: eventId,
    type,
    session_id: "session-1",
    ...(turnId ? { turn_id: turnId } : {}),
    source,
    occurred_at: `2026-08-26T10:00:0${seq}.000Z`,
    seq,
    data,
  }) as OpenMAEvent;
}

describe("OpenMA headless Agent UI state", () => {
  it("projects protocol-neutral session metadata, commands, and capabilities", () => {
    const state = replayAgentUIEvents("session-1", [
      event("session-info", "session.updated", 1, {
        title: "API refactor",
        updated_at: "2026-08-26T10:00:01.000Z",
      }),
      event("commands", "command_catalog.updated", 2, {
        commands: [{ name: "review", description: "Review changes" }],
      }),
      event("mode", "capability.updated", 3, {
        capability: "session.mode",
        value: { current_mode_id: "architect" },
      }),
    ]);

    expect(state.sessionInfo).toEqual({
      title: "API refactor",
      updatedAt: "2026-08-26T10:00:01.000Z",
    });
    expect(state.commands).toEqual([
      { name: "review", description: "Review changes" },
    ]);
    expect(state.capabilities).toEqual({
      "session.mode": { current_mode_id: "architect" },
    });
  });

  it("records the terminal timestamp for a completed turn", () => {
    const state = replayAgentUIEvents("session-1", [
      event("turn-running", "session.running", 1, {}, "turn-complete"),
      event("turn-completed-at", "turn.completed", 2, {
        stop_reason: "end_turn",
      }, "turn-complete"),
    ]);

    expect(state.turns["turn-complete"]).toMatchObject({
      status: "completed",
      startedAt: "2026-08-26T10:00:01.000Z",
      endedAt: "2026-08-26T10:00:02.000Z",
    });
  });

  it("retains tool presentation fields and raw canonical evidence", () => {
    const state = replayAgentUIEvents("session-1", [
      event("tool", "tool.started", 1, {
        tool_call_id: "tool-1",
        title: "Read runtime.ts",
        kind: "read",
        content: [{ type: "terminal", terminalId: "term-1" }],
        locations: [{ path: "/tmp/runtime.ts", line: 12 }],
        adapter_meta: { acp_meta: { codex: { toolName: "read_file" } } },
      }, "turn-tool"),
      event("raw", "raw.event", 2, {
        kind: "raw",
        source: "acp",
        event_type: "clash.canvas.patch",
        payload: { op: "add_node" },
        received_at: "2026-08-26T10:00:02.000Z",
        reason: "unsupported",
      }, "turn-tool"),
    ]);

    expect(state.turns["turn-tool"]?.items).toMatchObject([
      {
        id: "tool-1",
        kind: "tool",
        title: "Read runtime.ts",
        toolKind: "read",
        content: [{ type: "terminal", terminalId: "term-1" }],
        locations: [{ path: "/tmp/runtime.ts", line: 12 }],
        adapterMeta: { acp_meta: { codex: { toolName: "read_file" } } },
      },
      {
        id: "raw",
        kind: "raw",
        event: { type: "raw.event" },
      },
    ]);
  });

  it("deep-merges tool adapter metadata across lifecycle updates", () => {
    const state = replayAgentUIEvents("session-1", [
      event("tool-start", "tool.started", 1, {
        tool_call_id: "tool-meta",
        adapter_meta: {
          claudeCode: { toolName: "Edit", parentToolUseId: "parent-1" },
        },
      }, "turn-tool-meta"),
      event("tool-fail", "tool.failed", 2, {
        tool_call_id: "tool-meta",
        adapter_meta: {
          claudeCode: {
            nonExecutionKind: "user-rejected",
            userFeedback: "Use a different file.",
          },
        },
      }, "turn-tool-meta"),
    ]);

    expect(state.turns["turn-tool-meta"]?.items[0]).toMatchObject({
      adapterMeta: {
        claudeCode: {
          toolName: "Edit",
          parentToolUseId: "parent-1",
          nonExecutionKind: "user-rejected",
          userFeedback: "Use a different file.",
        },
      },
    });
  });

  it("closes a Managed turn when session.idle reports end_turn", () => {
    const state = replayAgentUIEvents("session-1", [
      event("managed-running", "session.running", 1, {}, "managed-turn"),
      event("managed-idle", "session.idle", 2, {
        stop_reason: { type: "end_turn" },
      }, "managed-turn"),
    ]);

    expect(state.status).toBe("idle");
    expect(state.activeTurnId).toBeUndefined();
    expect(state.turns["managed-turn"]).toMatchObject({
      status: "completed",
      startedAt: "2026-08-26T10:00:01.000Z",
      endedAt: "2026-08-26T10:00:02.000Z",
    });
  });

  it("keeps a Managed turn open when idle requires client action", () => {
    const state = replayAgentUIEvents("session-1", [
      event("managed-running-action", "session.running", 1, {}, "action-turn"),
      event("managed-idle-action", "session.idle", 2, {
        stop_reason: { type: "requires_action" },
      }, "action-turn"),
    ]);

    expect(state.status).toBe("idle");
    expect(state.activeTurnId).toBeUndefined();
    expect(state.turns["action-turn"]).toMatchObject({
      status: "running",
      startedAt: "2026-08-26T10:00:01.000Z",
    });
    expect(state.turns["action-turn"]?.endedAt).toBeUndefined();
  });

  it("fails the active Managed turn when session.error is the only terminal event", () => {
    const state = replayAgentUIEvents("session-1", [
      event("managed-running-error", "session.running", 1, {}, "failed-turn"),
      event("managed-session-error", "session.error", 2, {
        message: "Model request failed",
      }, "failed-turn"),
    ]);

    expect(state.status).toBe("error");
    expect(state.turns["failed-turn"]).toMatchObject({
      status: "failed",
      error: "Model request failed",
      endedAt: "2026-08-26T10:00:02.000Z",
    });
  });

  it("accumulates canonical user message chunks by message id", () => {
    const state = replayAgentUIEvents("session-1", [
      event("user-chunk-1", "user.message_chunk", 1, {
        message_id: "user-stream-1",
        text: "Please inspect ",
      }, "turn-user-stream"),
      event("user-chunk-2", "user.message_chunk", 2, {
        message_id: "user-stream-1",
        text: "the API",
      }, "turn-user-stream"),
    ]);

    expect(state.turns["turn-user-stream"]?.items).toEqual([{
      id: "user-stream-1",
      kind: "message",
      role: "user",
      text: "Please inspect the API",
      status: "streaming",
    }]);
  });

  it("replays ordered, idempotent message events into one completed turn", () => {
    const assistantChunk = event(
      "assistant-chunk-1",
      "agent.message_chunk",
      4,
      { message_id: "assistant-1", text: "Hello " },
      "turn-1",
    );
    const state = replayAgentUIEvents("session-1", [
      event("session-idle", "session.idle", 8, {}),
      event("assistant-final", "agent.message", 6, {
        message_id: "assistant-1",
        text: "Hello world",
      }, "turn-1"),
      event("turn-completed", "turn.completed", 7, {}, "turn-1"),
      assistantChunk,
      event("session-started", "session.started", 1, {}),
      event("user-message", "user.message", 2, {
        message_id: "user-1",
        text: "Say hello",
      }, "turn-1"),
      event("session-running", "session.running", 3, {}, "turn-1"),
      event("assistant-chunk-2", "agent.message_chunk", 5, {
        message_id: "assistant-1",
        text: "world",
      }, "turn-1"),
      assistantChunk,
    ]);

    expect(state).toMatchObject({
      sessionId: "session-1",
      status: "idle",
      turnOrder: ["turn-1"],
    });
    expect(state.activeTurnId).toBeUndefined();
    expect(state.turns["turn-1"]).toEqual({
      id: "turn-1",
      status: "completed",
      startedAt: "2026-08-26T10:00:03.000Z",
      endedAt: "2026-08-26T10:00:07.000Z",
      items: [
        {
          id: "user-1",
          kind: "message",
          role: "user",
          text: "Say hello",
          status: "complete",
        },
        {
          id: "assistant-1",
          kind: "message",
          role: "assistant",
          text: "Hello world",
          status: "complete",
        },
      ],
    });
    expect(Object.keys(state.seenEventIds)).toHaveLength(8);
  });

  it("projects turn and session failures with stable lifecycle timestamps", () => {
    const state = replayAgentUIEvents("session-1", [
      event("turn-queued", "turn.queued", 1, {}, "turn-2"),
      event("session-running", "session.running", 2, {}, "turn-2"),
      event("turn-failed", "turn.failed", 3, {
        message: "Tool execution failed",
      }, "turn-2"),
      event("session-error", "session.error", 4, {
        message: "Session stopped after the failed turn",
      }),
    ]);

    expect(state).toMatchObject({
      status: "error",
      lastError: "Session stopped after the failed turn",
    });
    expect(state.activeTurnId).toBeUndefined();
    expect(state.turns["turn-2"]).toEqual({
      id: "turn-2",
      status: "failed",
      items: [],
      error: "Tool execution failed",
      startedAt: "2026-08-26T10:00:02.000Z",
      endedAt: "2026-08-26T10:00:03.000Z",
    });
  });

  it("reduces a tool lifecycle into one timeline item with ordered output", () => {
    const state = replayAgentUIEvents("session-1", [
      event("tool-started", "tool.started", 1, {
        tool_call_id: "tool-1",
        tool_name: "web_search",
        title: "Search the web",
        raw_input: { query: "OpenMA" },
      }, "turn-3"),
      event("tool-progress", "tool.progress", 2, {
        tool_call_id: "tool-1",
        output: {
          kind: "text",
          data: "Searching…",
          append: true,
        },
      }, "turn-3"),
      event("tool-completed", "tool.completed", 3, {
        tool_call_id: "tool-1",
        raw_output: { hits: 2 },
        output: {
          kind: "structured",
          data: { hits: 2 },
          append: true,
        },
      }, "turn-3"),
    ]);

    expect(state.turns["turn-3"]?.items).toEqual([
      {
        id: "tool-1",
        kind: "tool",
        name: "web_search",
        title: "Search the web",
        status: "completed",
        rawInput: { query: "OpenMA" },
        rawOutput: { hits: 2 },
        outputs: [
          { kind: "text", data: "Searching…", append: true },
          { kind: "structured", data: { hits: 2 }, append: true },
        ],
      },
    ]);
  });

  it("projects canonical work items into serializable UI snapshots", () => {
    const state = replayAgentUIEvents("session-1", [
      event("work-started", "work_item.started", 1, {
        kind: "agent",
        title: "Research adapters",
      }, "turn-4"),
      event("work-progress", "work_item.progress", 2, {
        progress: 0.5,
        output: "halfway",
      }, "turn-4"),
      event("work-completed", "work_item.completed", 3, {
        result: "done",
      }, "turn-4"),
    ].map((item): OpenMAEvent => ({ ...item, work_item_id: "work-1" })));

    expect(state.workItemOrder).toEqual(["work-1"]);
    expect(state.workItems).toEqual({
      "work-1": {
        id: "work-1",
        kind: "agent",
        status: "completed",
        title: "Research adapters",
        progress: 0.5,
        output: ["halfway"],
        result: "done",
        startedAt: "2026-08-26T10:00:01.000Z",
        endedAt: "2026-08-26T10:00:03.000Z",
      },
    });
    expect(() => JSON.stringify(state)).not.toThrow();
  });

  it("merges stable plan entries and records plan completion", () => {
    const state = replayAgentUIEvents("session-1", [
      event("plan-created", "plan.updated", 1, {
        plan_id: "plan-1",
        representation: "items",
        update_mode: "replace",
        entries: [
          { id: "a", content: "Inspect API", status: "in_progress" },
          { id: "b", content: "Build reducer", status: "pending" },
        ],
      }, "turn-5"),
      event("plan-merged", "plan.updated", 2, {
        plan_id: "plan-1",
        representation: "items",
        update_mode: "merge",
        entries: [
          { id: "a", content: "Inspect API", status: "completed" },
          { id: "c", content: "Verify consumers", status: "pending" },
        ],
      }, "turn-5"),
      event("plan-completed", "plan.completed", 3, {
        plan_id: "plan-1",
      }, "turn-5"),
    ]);

    expect(state.planOrder).toEqual(["plan-1"]);
    expect(state.plans["plan-1"]).toEqual({
      id: "plan-1",
      representation: "items",
      status: "completed",
      entries: [
        { id: "a", content: "Inspect API", status: "completed" },
        { id: "b", content: "Build reducer", status: "pending" },
        { id: "c", content: "Verify consumers", status: "pending" },
      ],
    });
  });

  it("correlates host callback requests with their terminal result", () => {
    const state = replayAgentUIEvents("session-1", [
      event("permission-requested", "callback.requested", 1, {
        callback_id: "permission-1",
        category: "permission",
        method: "session/request_permission",
        params: { tool_call_id: "tool-9" },
      }, "turn-6"),
      event("permission-completed", "callback.completed", 2, {
        callback_id: "permission-1",
        category: "permission",
        method: "session/request_permission",
        result: { outcome: "selected", option_id: "allow_once" },
      }, "turn-6"),
    ]);

    expect(state.callbackOrder).toEqual(["permission-1"]);
    expect(state.callbacks).toEqual({
      "permission-1": {
        id: "permission-1",
        category: "permission",
        method: "session/request_permission",
        status: "completed",
        params: { tool_call_id: "tool-9" },
        result: { outcome: "selected", option_id: "allow_once" },
      },
    });
  });

  it("uses a numeric ACP JSON-RPC callback id as a stable UI-state key", () => {
    const state = replayAgentUIEvents("session-1", [
      event("permission-requested-42", "callback.requested", 1, {
        callback_id: 42,
        category: "permission",
        method: "session/request_permission",
        params: { toolCall: { toolCallId: "tool-42" } },
      }, "turn-42"),
      event("permission-completed-42", "callback.completed", 2, {
        callback_id: 42,
        category: "permission",
        method: "session/request_permission",
        result: { outcome: "selected", optionId: "allow-once" },
      }, "turn-42"),
    ]);

    expect(state.callbackOrder).toEqual(["42"]);
    expect(state.callbacks["42"]).toMatchObject({
      id: "42",
      status: "completed",
      params: { toolCall: { toolCallId: "tool-42" } },
      result: { outcome: "selected", optionId: "allow-once" },
    });
  });

  it("distinguishes session recovery from terminal shutdown", () => {
    const recovering = replayAgentUIEvents("session-1", [
      event("session-rescheduled", "session.rescheduled", 1, {}),
    ]);
    const terminated = replayAgentUIEvents("session-1", [
      event("session-terminated", "session.terminated", 1, {}),
    ]);

    expect(recovering.status).toBe("rescheduled");
    expect(terminated.status).toBe("terminated");
  });

  it("projects system.message into the conversation timeline as a system role", () => {
    const state = replayAgentUIEvents("session-1", [
      event("system-message", "system.message", 1, {
        message_id: "system-1",
        text: "Use staging",
        content: [{ type: "text", text: "Use staging" }],
      }, "turn-7"),
    ]);

    expect(state.turns["turn-7"]?.items).toEqual([
      {
        id: "system-1",
        kind: "message",
        role: "system",
        text: "Use staging",
        content: [{ type: "text", text: "Use staging" }],
        status: "complete",
      },
    ]);
  });

  it("projects a contentless thinking signal without inventing display copy", () => {
    const state = replayAgentUIEvents("session-1", [
      event("thinking-signal", "agent.thinking", 1, {
        message_id: "thinking-1",
        adapter_meta: { progress_signal: true },
      }, "turn-8"),
    ]);

    expect(state.turns["turn-8"]?.items).toEqual([
      {
        id: "thinking-1",
        kind: "thinking",
        role: "assistant",
        text: "",
        status: "complete",
      },
    ]);
  });

  it("stores the latest usage snapshot without flattening its dimensions", () => {
    const state = replayAgentUIEvents("session-1", [
      event("usage-updated", "usage.updated", 1, {
        usage: {
          input_tokens: 1_000,
          output_tokens: 250,
          list_cost: { currency: "USD", amount: "0.42" },
        },
        budget: { currency: "USD", max_list_cost: "2.00" },
      }),
    ]);

    expect(state.usage).toEqual({
      snapshot: {
        input_tokens: 1_000,
        output_tokens: 250,
        list_cost: { currency: "USD", amount: "0.42" },
      },
      budget: { currency: "USD", max_list_cost: "2.00" },
      updatedAt: "2026-08-26T10:00:01.000Z",
    });
  });

  it("keeps a failed tool in place with its terminal error and output", () => {
    const state = replayAgentUIEvents("session-1", [
      event("tool-start", "tool.started", 1, {
        tool_call_id: "tool-failed-1",
        tool_name: "bash",
        raw_input: { command: "exit 1" },
      }, "turn-9"),
      event("tool-failed", "tool.failed", 2, {
        tool_call_id: "tool-failed-1",
        raw_output: [{ type: "text", text: "permission denied" }],
        error: "permission denied",
        output: {
          kind: "structured",
          data: [{ type: "text", text: "permission denied" }],
        },
      }, "turn-9"),
    ]);

    expect(state.turns["turn-9"]?.items).toEqual([
      {
        id: "tool-failed-1",
        kind: "tool",
        name: "bash",
        status: "failed",
        rawInput: { command: "exit 1" },
        rawOutput: [{ type: "text", text: "permission denied" }],
        outputs: [
          {
            kind: "structured",
            data: [{ type: "text", text: "permission denied" }],
          },
        ],
        error: "permission denied",
      },
    ]);
  });

  it("correlates a failed host callback without dropping its request params", () => {
    const state = replayAgentUIEvents("session-1", [
      event("callback-request", "callback.requested", 1, {
        callback_id: "callback-2",
        category: "mcp",
        method: "mcp/call",
        params: { name: "search" },
      }, "turn-10"),
      event("callback-failed", "callback.failed", 2, {
        callback_id: "callback-2",
        category: "mcp",
        method: "mcp/call",
        error: { code: -32000, message: "server unavailable" },
      }, "turn-10"),
    ]);

    expect(state.callbacks["callback-2"]).toEqual({
      id: "callback-2",
      category: "mcp",
      method: "mcp/call",
      status: "failed",
      params: { name: "search" },
      error: { code: -32000, message: "server unavailable" },
    });
  });

  it("removes a plan snapshot from both lookup and display order", () => {
    const state = replayAgentUIEvents("session-1", [
      event("plan-created-2", "plan.updated", 1, {
        plan_id: "plan-2",
        representation: "items",
        entries: [{ id: "a", content: "Temporary plan" }],
      }),
      event("plan-removed-2", "plan.removed", 2, {
        plan_id: "plan-2",
      }),
    ]);

    expect(state.planOrder).toEqual([]);
    expect(state.plans).toEqual({});
  });

  it("records turn cancellation as a terminal state with its reason", () => {
    const state = replayAgentUIEvents("session-1", [
      event("turn-running-11", "session.running", 1, {}, "turn-11"),
      event("turn-cancelled-11", "turn.cancelled", 2, {
        reason: "interrupted by user",
      }, "turn-11"),
    ]);

    expect(state.activeTurnId).toBeUndefined();
    expect(state.turns["turn-11"]).toEqual({
      id: "turn-11",
      status: "cancelled",
      items: [],
      reason: "interrupted by user",
      startedAt: "2026-08-26T10:00:01.000Z",
      endedAt: "2026-08-26T10:00:02.000Z",
    });
  });

  it("projects tool cancellation onto the existing tool timeline item", () => {
    const state = replayAgentUIEvents("session-1", [
      event("tool-start-12", "tool.started", 1, {
        tool_call_id: "tool-cancelled-1",
        tool_name: "browser",
      }, "turn-12"),
      event("tool-cancelled-12", "tool.cancelled", 2, {
        tool_call_id: "tool-cancelled-1",
        reason: "turn interrupted",
      }, "turn-12"),
    ]);

    expect(state.turns["turn-12"]?.items).toEqual([
      {
        id: "tool-cancelled-1",
        kind: "tool",
        name: "browser",
        status: "cancelled",
        outputs: [],
        reason: "turn interrupted",
      },
    ]);
  });

  it("keeps an uncorrelated callback notification addressable by event id", () => {
    const state = replayAgentUIEvents("session-1", [
      event("callback-notification-1", "callback.notification", 1, {
        category: "extension",
        method: "extension/status",
        params: { status: "ready" },
      }),
    ]);

    expect(state.callbackOrder).toEqual(["callback-notification-1"]);
    expect(state.callbacks["callback-notification-1"]).toEqual({
      id: "callback-notification-1",
      category: "extension",
      method: "extension/status",
      status: "notification",
      params: { status: "ready" },
    });
  });

  it("projects a system notice into the active turn timeline", () => {
    const state = replayAgentUIEvents("session-1", [
      event("system-notice-1", "system.notice", 1, {
        message_id: "notice-1",
        text: "Retrying model request",
      }, "turn-13"),
    ]);

    expect(state.turns["turn-13"]?.items).toEqual([
      {
        id: "notice-1",
        kind: "notice",
        role: "system",
        text: "Retrying model request",
        status: "complete",
      },
    ]);
  });

  it("reduces an outcome definition and evaluation into one verdict snapshot", () => {
    const state = replayAgentUIEvents("session-1", [
      event("outcome-defined", "outcome.defined", 1, {
        outcome_id: "outc_1",
        description: "All tests pass",
        rubric: { type: "text", content: "No failures" },
        max_iterations: 3,
      }),
      event("outcome-evaluation-start", "outcome.evaluation_started", 2, {
        outcome_id: "outc_1",
        iteration: 0,
      }),
      event("outcome-evaluation-end", "outcome.evaluation_completed", 3, {
        outcome_id: "outc_1",
        iteration: 0,
        result: "satisfied",
        explanation: "All criteria met",
        usage: { input_tokens: 100, output_tokens: 20 },
      }),
    ]);

    expect(state.outcomeOrder).toEqual(["outc_1"]);
    expect(state.outcomes).toEqual({
      outc_1: {
        id: "outc_1",
        status: "satisfied",
        description: "All tests pass",
        rubric: { type: "text", content: "No failures" },
        maxIterations: 3,
        iteration: 0,
        explanation: "All criteria met",
        usage: { input_tokens: 100, output_tokens: 20 },
        updatedAt: "2026-08-26T10:00:03.000Z",
      },
    });
  });

  it("provides a headless store that dispatches canonical events", () => {
    const store = createAgentUIStore("session-1");

    expect(store.getState().status).toBe("unknown");
    const next = store.dispatch(
      event("store-session-running", "session.running", 1, {}),
    );

    expect(next.status).toBe("running");
    expect(store.getState()).toBe(next);
  });

  it("notifies store subscribers only when dispatch changes state", () => {
    const store = createAgentUIStore("session-1");
    const statuses: string[] = [];
    const unsubscribe = store.subscribe((state) => statuses.push(state.status));
    const running = event("store-running-once", "session.running", 1, {});

    store.dispatch(running);
    store.dispatch(running);
    unsubscribe();
    store.dispatch(event("store-idle", "session.idle", 2, {}));

    expect(statuses).toEqual(["running"]);
    expect(store.getState().status).toBe("idle");
  });
});
