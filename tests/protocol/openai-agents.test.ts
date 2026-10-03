import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decodeOpenAIAgentsItem,
  decodeOpenAIAgentsPendingActions,
  decodeOpenAIAgentsStreamEvent,
  decodeOpenAIAgentsTurn,
  type OpenAIAgentsDecodeContext,
  type OpenAIAgentsItem,
  type OpenAIAgentsSessionSnapshot,
  type OpenAIAgentsStreamEvent,
  type OpenAIAgentsTurn,
} from "../../src/protocol/openai-agents/index.js";
import type { OpenMAEvent } from "../../src/session-events/openma.js";
import { loadBackchatOracle, type BackchatWrappedEvent } from "./openai-agents-oracle.js";

const NOW = "2026-04-13T18:30:00.000Z";
const SESSION = "sess_1";
const oracle = loadBackchatOracle();

function context(sessionId = SESSION): OpenAIAgentsDecodeContext {
  return { sessionId, now: () => NOW };
}

function canonicalOf(wrapped: BackchatWrappedEvent): OpenMAEvent {
  return wrapped.canonical;
}

describe("OpenAI Agents decoder matches backchat 64fd74d", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("publishes ./protocol/openai-agents the same way as ./protocol/managed", () => {
    const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../package.json"), "utf8")) as {
      exports?: Record<string, unknown>;
    };
    expect(pkg.exports?.["./protocol/openai-agents"]).toEqual({
      types: "./dist/protocol/openai-agents/index.d.ts",
      import: "./dist/protocol/openai-agents/index.js",
    });
    expect(pkg.exports?.["./protocol/managed"]).toEqual({
      types: "./dist/protocol/managed/index.d.ts",
      import: "./dist/protocol/managed/index.js",
    });
  });

  it("anchors a user message to the backchat field layout", () => {
    const item: OpenAIAgentsItem = {
      type: "message",
      id: "msg_user",
      turn_id: "turn_1",
      role: "user",
      status: "completed",
      content: [{ type: "input_text", text: "Hello" }],
    };
    const expected = {
      schema: "oma.event.v1",
      schema_version: "oma.event.v1",
      event_id: "item:msg_user:completed",
      session_id: SESSION,
      turn_id: "turn_1",
      source: { kind: "harness", harness: "openai-agents" },
      occurred_at: NOW,
      type: "user.message",
      data: {
        message_id: "msg_user",
        text: "Hello",
        content: [{ type: "input_text", text: "Hello" }],
      },
    };
    expect(canonicalOf(oracle.item(SESSION, item))).toEqual(expected);
    expect(decodeOpenAIAgentsItem(item, context())).toEqual(expected);
  });

  it("maps an assistant message and joins content text with an empty separator", () => {
    const item: OpenAIAgentsItem = {
      type: "message",
      id: "msg_agent",
      turn_id: "turn_1",
      role: "assistant",
      status: "completed",
      phase: "final_answer",
      content: [
        { type: "output_text", text: "Hello" },
        { type: "output_text", text: " there" },
        { type: "input_image", image_url: "https://example.test/a.png" },
      ],
    };
    const event = decodeOpenAIAgentsItem(item, context());
    expect(event).toEqual(canonicalOf(oracle.item(SESSION, item)));
    expect(event).toMatchObject({
      event_id: "item:msg_agent:completed",
      type: "agent.message",
      data: { message_id: "msg_agent", text: "Hello there" },
    });
  });

  it("uses turn_id:user when a legacy user message has no id", () => {
    const item: OpenAIAgentsItem = {
      type: "message",
      id: null,
      turn_id: "turn_9",
      role: "user",
      status: "completed",
      content: "plain",
    };
    const event = decodeOpenAIAgentsItem(item, context());
    expect(event).toEqual(canonicalOf(oracle.item(SESSION, item)));
    expect(event).toMatchObject({
      event_id: "item:turn_9:user:completed",
      data: { message_id: "turn_9:user", text: "plain" },
    });
  });

  it("treats non-string non-array message content as empty text", () => {
    const item: OpenAIAgentsItem = {
      type: "message",
      id: "msg_empty",
      turn_id: "turn_1",
      role: "assistant",
      status: "in_progress",
      content: { text: "ignored" },
    };
    const event = decodeOpenAIAgentsItem(item, context());
    expect(event).toEqual(canonicalOf(oracle.item(SESSION, item)));
    expect(event).toMatchObject({
      event_id: "item:msg_empty:in_progress",
      type: "agent.message",
      data: { text: "" },
    });
  });

  it("maps reasoning without a status suffix", () => {
    const item: OpenAIAgentsItem = {
      type: "reasoning",
      id: "rs_1",
      turn_id: "turn_1",
      status: "completed",
      summary: [
        { type: "summary_text", text: "Look " },
        { type: "summary_text", text: "around" },
      ],
    };
    const event = decodeOpenAIAgentsItem(item, context());
    expect(event).toEqual(canonicalOf(oracle.item(SESSION, item)));
    expect(event).toMatchObject({
      event_id: "item:rs_1",
      type: "agent.thinking",
      data: { message_id: "rs_1", text: "Look around" },
    });
  });

  it.each([
    ["failed", "tool.failed"],
    ["completed", "tool.completed"],
    ["incomplete", "tool.completed"],
  ] as const)("maps function_call_output status %s to %s", (status, type) => {
    const item: OpenAIAgentsItem = {
      type: "function_call_output",
      id: "out_1",
      turn_id: "turn_1",
      call_id: "call_1",
      status,
      output: status === "failed" ? null : "42",
      error: status === "failed" ? "bad args" : null,
    };
    const event = decodeOpenAIAgentsItem(item, context());
    expect(event).toEqual(canonicalOf(oracle.item(SESSION, item)));
    expect(event).toMatchObject({
      event_id: "item:out_1",
      type,
      turn_id: "turn_1",
      data: {
        tool_call_id: "call_1",
        raw_output: item.output,
        error: item.error,
      },
    });
  });

  it.each([
    ["in_progress", "tool.started"],
    ["completed", "tool.completed"],
    ["failed", "tool.failed"],
    ["incomplete", "tool.started"],
  ] as const)("maps function_call status %s to %s", (status, type) => {
    const item: OpenAIAgentsItem = {
      type: "function_call",
      id: "fc_1",
      turn_id: "turn_1",
      status,
      call_id: "call_1",
      name: "lookup",
      arguments: { q: "x" },
    };
    const event = decodeOpenAIAgentsItem(item, context());
    expect(event).toEqual(canonicalOf(oracle.item(SESSION, item)));
    expect(event).toMatchObject({
      event_id: `item:fc_1:${status}`,
      type,
      data: {
        tool_call_id: "call_1",
        tool_name: "lookup",
        title: "lookup",
        raw_input: { q: "x" },
      },
    });
  });

  it.each([
    ["in_progress", "tool.started"],
    ["completed", "tool.completed"],
    ["failed", "tool.failed"],
  ] as const)("maps command_execution status %s using the command as raw input", (status, type) => {
    const item: OpenAIAgentsItem = {
      type: "command_execution",
      id: "cmd_1",
      turn_id: "turn_1",
      status,
      command: "pwd",
      cwd: "/work",
      output: status === "in_progress" ? null : "ok",
    };
    const event = decodeOpenAIAgentsItem(item, context());
    expect(event).toEqual(canonicalOf(oracle.item(SESSION, item)));
    expect(event).toMatchObject({
      event_id: `item:cmd_1:${status}`,
      type,
      data: {
        tool_call_id: "cmd_1",
        tool_name: "command_execution",
        title: "command_execution",
        raw_input: "pwd",
        raw_output: item.output,
      },
    });
  });

  it("keeps an mcp call id-less and preserves its name, arguments, output, and error", () => {
    const item: OpenAIAgentsItem = {
      type: "mcp_call",
      id: "mcp_1",
      turn_id: "turn_1",
      status: "completed",
      name: "search",
      arguments: { q: "ports" },
      output: { rows: 1 },
      error: null,
      server_label: "docs",
    };
    const event = decodeOpenAIAgentsItem(item, context());
    expect(event).toEqual(canonicalOf(oracle.item(SESSION, item)));
    expect(event).toMatchObject({
      event_id: "item:mcp_1:completed",
      type: "tool.completed",
      data: {
        tool_call_id: "mcp_1",
        tool_name: "search",
        raw_input: { q: "ports" },
        raw_output: { rows: 1 },
        error: null,
      },
    });
  });

  it("uses the whole item as raw input when a call has neither arguments nor command", () => {
    const item: OpenAIAgentsItem = {
      type: "web_search_call",
      id: "web_1",
      turn_id: "turn_1",
      status: "in_progress",
      action: null,
    };
    const event = decodeOpenAIAgentsItem(item, context());
    expect(event).toEqual(canonicalOf(oracle.item(SESSION, item)));
    expect(event).toMatchObject({
      type: "tool.started",
      event_id: "item:web_1:in_progress",
      data: {
        tool_call_id: "web_1",
        tool_name: "web_search_call",
        title: "web_search_call",
        raw_input: item,
      },
    });
  });

  it("keeps an unknown item as an agents vendor event", () => {
    const item: OpenAIAgentsItem = {
      type: "agent_message",
      id: "am_1",
      turn_id: "turn_1",
      content: [{ type: "output_text", text: "ping" }],
      sender_agent_id: "agent_a",
      recipient_agent_id: "agent_b",
    };
    const event = decodeOpenAIAgentsItem(item, context());
    expect(event).toEqual(canonicalOf(oracle.item(SESSION, item)));
    expect(event).toMatchObject({
      schema: "oma.event.v1",
      schema_version: "oma.event.v1",
      event_id: "item:am_1",
      type: "vendor.event",
      session_id: SESSION,
      turn_id: "turn_1",
      source: { kind: "harness", harness: "openai-agents" },
      occurred_at: NOW,
      data: {
        kind: "vendor",
        harness: "openai-agents",
        namespace: "agents",
        name: "agent_message",
        data: item,
      },
    });
    expect(event.data).not.toHaveProperty("correlation");
  });

  it("anchors a completed turn, including the seconds-to-ISO clock", () => {
    const turn: OpenAIAgentsTurn = {
      id: "turn_1",
      status: "completed",
      created_at: 1_704_067_200,
      completed_at: 1_704_067_260,
      error: { code: "server_error", message: "boom" },
    };
    const expected = {
      schema: "oma.event.v1",
      schema_version: "oma.event.v1",
      event_id: "turn:turn_1:completed",
      session_id: SESSION,
      turn_id: "turn_1",
      source: { kind: "harness", harness: "openai-agents" },
      occurred_at: "2024-01-01T00:01:00.000Z",
      type: "turn.completed",
      data: { error: turn.error, message: "boom" },
    };
    expect(canonicalOf(oracle.turn(SESSION, turn))).toEqual(expected);
    expect(decodeOpenAIAgentsTurn(turn, context())).toEqual(expected);
  });

  it.each([
    ["completed", "turn.completed"],
    ["failed", "turn.failed"],
    ["cancelled", "turn.cancelled"],
    ["queued", "turn.queued"],
    ["in_progress", "session.running"],
    ["waiting", "session.running"],
  ] as const)("maps turn status %s to %s", (status, type) => {
    const turn: OpenAIAgentsTurn = {
      id: "turn_2",
      status,
      created_at: 1_704_067_200,
      completed_at: status === "queued" || status === "in_progress" || status === "waiting"
        ? null
        : 1_704_067_260,
      error: status === "failed" ? { message: "nope" } : null,
    };
    const event = decodeOpenAIAgentsTurn(turn, context());
    expect(event).toEqual(canonicalOf(oracle.turn(SESSION, turn)));
    expect(event).toMatchObject({
      event_id: `turn:turn_2:${status}`,
      type,
      occurred_at: turn.completed_at == null
        ? "2024-01-01T00:00:00.000Z"
        : "2024-01-01T00:01:00.000Z",
      data: { error: turn.error, message: turn.error?.message },
    });
  });

  it("leaves an unknown turn status unmapped, matching backchat", () => {
    const turn: OpenAIAgentsTurn = {
      id: "turn_x",
      status: "mystery",
      created_at: 1_704_067_200,
      completed_at: null,
      error: null,
    };
    expect(decodeOpenAIAgentsTurn(turn, context())).toEqual(canonicalOf(oracle.turn(SESSION, turn)));
  });

  it("reads the injected clock instead of Date for item events", () => {
    vi.useRealTimers();
    const item: OpenAIAgentsItem = {
      type: "message",
      id: "msg_clock",
      turn_id: "turn_1",
      role: "user",
      status: "completed",
      content: [{ type: "input_text", text: "Hi" }],
    };
    const event = decodeOpenAIAgentsItem(item, {
      sessionId: SESSION,
      now: () => "1999-01-01T00:00:00.000Z",
    });
    expect(event.occurred_at).toBe("1999-01-01T00:00:00.000Z");
  });

  it("does not let the injected clock replace a turn timestamp", () => {
    const turn: OpenAIAgentsTurn = {
      id: "turn_clock",
      status: "queued",
      created_at: 1_704_067_200,
      completed_at: null,
      error: null,
    };
    const event = decodeOpenAIAgentsTurn(turn, {
      sessionId: SESSION,
      now: () => "1999-01-01T00:00:00.000Z",
    });
    expect(event.occurred_at).toBe("2024-01-01T00:00:00.000Z");
    expect(event).toEqual(canonicalOf(oracle.turn(SESSION, turn)));
  });

  it("maps item.added and item.done through the item decoder", () => {
    const item: OpenAIAgentsItem = {
      type: "message",
      id: "msg_user",
      turn_id: "turn_1",
      role: "user",
      status: "completed",
      content: [{ type: "input_text", text: "Hello" }],
    };
    for (const type of [
      "agent.session.turn.item.added",
      "agent.session.turn.item.done",
    ] as const) {
      const event: OpenAIAgentsStreamEvent = {
        type,
        event_id: `evt_${type}`,
        session_id: SESSION,
        turn_id: "turn_1",
        item,
      };
      const decoded = decodeOpenAIAgentsStreamEvent(event, context());
      const expected = oracle.openaiEvent(SESSION, event).map(canonicalOf);
      expect(decoded).toEqual(expected);
      expect(decoded).toEqual([decodeOpenAIAgentsItem(item, context())]);
      expect(decoded[0]?.event_id).toBe("item:msg_user:completed");
    }
  });

  it("maps output text deltas onto the stream event id", () => {
    const withTurn: OpenAIAgentsStreamEvent = {
      type: "agent.session.turn.output_text.delta",
      event_id: "evt_delta",
      delta: "Hel",
      item_id: "msg_agent",
      turn_id: "turn_1",
      session_id: SESSION,
      content_index: 0,
      output_index: 0,
    };
    const decoded = decodeOpenAIAgentsStreamEvent(withTurn, context());
    expect(decoded).toEqual(oracle.openaiEvent(SESSION, withTurn).map(canonicalOf));
    expect(decoded).toMatchObject([{
      event_id: "evt_delta",
      type: "agent.message_chunk",
      turn_id: "turn_1",
      data: { message_id: "msg_agent", text: "Hel" },
    }]);

    const withoutTurn: OpenAIAgentsStreamEvent = { ...withTurn, event_id: "evt_delta_0", turn_id: null };
    const omitted = decodeOpenAIAgentsStreamEvent(withoutTurn, context());
    expect(omitted).toEqual(oracle.openaiEvent(SESSION, withoutTurn).map(canonicalOf));
    expect(omitted[0]).not.toHaveProperty("turn_id");
  });

  it("maps a turn-bearing stream event through the turn decoder", () => {
    const turn: OpenAIAgentsTurn = {
      id: "turn_1",
      status: "failed",
      created_at: 1_704_067_200,
      completed_at: 1_704_067_260,
      error: { message: "nope" },
    };
    const event: OpenAIAgentsStreamEvent = {
      type: "agent.session.turn.failed",
      event_id: "evt_turn",
      session_id: SESSION,
      turn_id: "turn_1",
      turn,
    };
    const decoded = decodeOpenAIAgentsStreamEvent(event, context());
    expect(decoded).toEqual(oracle.openaiEvent(SESSION, event).map(canonicalOf));
    expect(decoded).toEqual([decodeOpenAIAgentsTurn(turn, context())]);
    expect(decoded[0]?.event_id).toBe("turn:turn_1:failed");
  });

  it.each([
    ["idle", "session.idle"],
    ["failed", "session.error"],
    ["in_progress", "session.running"],
    ["requires_action", "session.running"],
  ] as const)("maps session status %s to %s and a required_actions vendor event", (status, type) => {
    const session: OpenAIAgentsSessionSnapshot = {
      id: SESSION,
      status,
      error: status === "failed" ? "session died" : null,
      required_actions: [{
        type: "function_call",
        call_id: "call_9",
        name: "ask",
        arguments: { q: 1 },
        turn_id: "turn_1",
      }],
    };
    const event: OpenAIAgentsStreamEvent = {
      type: status === "failed" ? "agent.session.failed" : "agent.session.idle",
      event_id: `evt_${status}`,
      session,
    };
    if (status === "in_progress") event.type = "agent.session.in_progress";
    if (status === "requires_action") event.type = "agent.session.requires_action";
    const decoded = decodeOpenAIAgentsStreamEvent(event, context());
    expect(decoded).toEqual(oracle.openaiEvent(SESSION, event).map(canonicalOf));
    expect(decoded).toHaveLength(2);
    expect(decoded[0]).toMatchObject({
      event_id: `evt_${status}`,
      type,
      data: { message: session.error },
    });
    expect(decoded[0]).not.toHaveProperty("turn_id");
    expect(decoded[1]).toMatchObject({
      event_id: `evt_${status}:required`,
      type: "vendor.event",
      data: { name: "required_actions", namespace: "agents", data: session.required_actions },
    });
    expect(decoded[1]).not.toHaveProperty("turn_id");
    expect(decoded[1]).toEqual(decodeOpenAIAgentsPendingActions(session, {
      ...context(),
      eventId: `evt_${status}:required`,
    }).event);
  });

  it("keeps an unknown stream event as a vendor event and threads turn_id only when it is present", () => {
    const withTurn: OpenAIAgentsStreamEvent = {
      type: "agent.output.command_execution_output.delta",
      event_id: "evt_cmd",
      delta: "ok",
      item_id: "cmd_1",
      turn_id: "turn_1",
      session_id: SESSION,
    };
    const withTurnDecoded = decodeOpenAIAgentsStreamEvent(withTurn, context());
    expect(withTurnDecoded).toEqual(oracle.openaiEvent(SESSION, withTurn).map(canonicalOf));
    expect(withTurnDecoded[0]).toMatchObject({
      event_id: "evt_cmd",
      type: "vendor.event",
      turn_id: "turn_1",
      data: { name: withTurn.type, namespace: "agents", harness: "openai-agents", data: withTurn },
    });

    const withoutTurn: OpenAIAgentsStreamEvent = {
      type: "error",
      event_id: "evt_err",
      session_id: SESSION,
      error: { message: "nope" },
    };
    const withoutTurnDecoded = decodeOpenAIAgentsStreamEvent(withoutTurn, context());
    expect(withoutTurnDecoded).toEqual(oracle.openaiEvent(SESSION, withoutTurn).map(canonicalOf));
    expect(withoutTurnDecoded[0]).not.toHaveProperty("turn_id");

    const nullTurn: OpenAIAgentsStreamEvent = {
      type: "agent.session.turn.output_text.done",
      event_id: "evt_text_done",
      turn_id: null,
      item_id: "msg_agent",
      session_id: SESSION,
    };
    const nullTurnDecoded = decodeOpenAIAgentsStreamEvent(nullTurn, context());
    expect(nullTurnDecoded).toEqual(oracle.openaiEvent(SESSION, nullTurn).map(canonicalOf));
    expect(nullTurnDecoded[0]).not.toHaveProperty("turn_id");
  });

  it("returns function_call entries beside the required_actions vendor event", () => {
    const functionCall = {
      type: "function_call" as const,
      call_id: "call_1",
      name: "lookup",
      arguments: { q: "x" },
      turn_id: "turn_1",
    };
    const session: OpenAIAgentsSessionSnapshot = {
      required_actions: [
        functionCall,
        { type: "environment_connection", environment_id: "env_1" },
      ],
    };
    const result = decodeOpenAIAgentsPendingActions(session, {
      ...context(),
      eventId: "required:fixed",
    });
    expect(result.event).toEqual(canonicalOf(oracle.pending(SESSION, "required:fixed", session)));
    expect(result.functionCalls).toEqual([functionCall]);
    expect(JSON.stringify(result)).not.toContain("custom_result");
    expect(result.event).toMatchObject({
      event_id: "required:fixed",
      data: {
        kind: "vendor",
        harness: "openai-agents",
        namespace: "agents",
        name: "required_actions",
        data: session.required_actions,
      },
    });
  });

  it("preserves an empty or missing required_actions list", () => {
    for (const session of [
      { required_actions: [] },
      {},
    ] satisfies OpenAIAgentsSessionSnapshot[]) {
      const result = decodeOpenAIAgentsPendingActions(session, {
        ...context(),
        eventId: "required:none",
      });
      expect(result.event).toEqual(canonicalOf(oracle.pending(SESSION, "required:none", session)));
      expect(result.functionCalls).toEqual([]);
      expect(result.event).toMatchObject({
        data: { name: "required_actions", data: [] },
      });
    }
  });
});
