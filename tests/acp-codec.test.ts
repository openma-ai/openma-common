import { describe, expect, it } from "vitest";

import * as acpEvents from "../src/protocol/acp/index.js";
import type { OpenMAEvent } from "../src/session-events/openma.js";

type DecodeAcpSessionNotification = (
  notification: {
    sessionId: string;
    update: { sessionUpdate: string; [key: string]: unknown };
  },
  context: {
    eventId: string;
    occurredAt: string;
    ingestedAt?: string;
    turnId?: string;
    seq?: number;
    harness?: string;
  },
) => {
  fidelity: "exact" | "lossy" | "unsupported";
  event: OpenMAEvent;
  diagnostics: Array<{ code: string; message: string }>;
};

type EncodeAcpInput = (
  event: OpenMAEvent,
  context?: { requestId?: string | number | null },
) => {
  fidelity: "exact" | "lossy" | "unsupported";
  message?: Record<string, unknown>;
  diagnostics: Array<{ code: string; message: string }>;
};

type DecodeAcpAgentRequest = (
  request: {
    id: string | number | null;
    method: string;
    params?: unknown;
  },
  context: {
    sessionId: string;
    eventId: string;
    occurredAt: string;
    ingestedAt?: string;
    turnId?: string;
    seq?: number;
  },
) => {
  fidelity: "exact" | "lossy" | "unsupported";
  event: OpenMAEvent;
  diagnostics: Array<{ code: string; message: string }>;
};

type DecodeAcpAgentNotification = (
  notification: { method: string; params?: unknown },
  context: {
    sessionId: string;
    eventId: string;
    occurredAt: string;
    ingestedAt?: string;
    turnId?: string;
    seq?: number;
  },
) => ReturnType<DecodeAcpAgentRequest>;

type DecodeAcpClientResponse = (
  response: {
    id: string | number | null;
    result?: unknown;
    error?: unknown;
  },
  context: {
    sessionId: string;
    method: string;
    eventId: string;
    occurredAt: string;
    ingestedAt?: string;
    turnId?: string;
    seq?: number;
  },
) => ReturnType<DecodeAcpAgentRequest>;

type DecodeAcpAgentResponse = DecodeAcpClientResponse;

const decodeAcpSessionNotification = (
  acpEvents as unknown as {
    decodeAcpSessionNotification: DecodeAcpSessionNotification;
  }
).decodeAcpSessionNotification;

const decodeAcpSessionUpdate = (
  acpEvents as unknown as {
    decodeAcpSessionUpdate: (
      sessionId: string,
      update: unknown,
      context: {
        eventId: string;
        occurredAt: string;
        turnId?: string;
        seq?: number;
        harness?: string;
      },
    ) => ReturnType<DecodeAcpSessionNotification>;
  }
).decodeAcpSessionUpdate;

const encodeAcpInput = (
  acpEvents as unknown as { encodeAcpInput: EncodeAcpInput }
).encodeAcpInput;

const decodeAcpAgentRequest = (
  acpEvents as unknown as { decodeAcpAgentRequest: DecodeAcpAgentRequest }
).decodeAcpAgentRequest;

const decodeAcpAgentNotification = (
  acpEvents as unknown as {
    decodeAcpAgentNotification: DecodeAcpAgentNotification;
  }
).decodeAcpAgentNotification;

const decodeAcpClientResponse = (
  acpEvents as unknown as {
    decodeAcpClientResponse: DecodeAcpClientResponse;
  }
).decodeAcpClientResponse;

const decodeAcpAgentResponse = (
  acpEvents as unknown as {
    decodeAcpAgentResponse: DecodeAcpAgentResponse;
  }
).decodeAcpAgentResponse;

describe("ACP ↔ OpenMA event codec", () => {
  it("encodes a canonical user message as an official ACP prompt request", () => {
    const result = encodeAcpInput({
      schema_version: "oma.event.v1",
      event_id: "user-input-1",
      type: "user.message",
      session_id: "session-1",
      source: { kind: "user" },
      occurred_at: "2026-08-26T10:59:00.000Z",
      data: {
        message_id: "user-input-1",
        text: "Inspect the API",
        content: [{ type: "text", text: "Inspect the API" }],
      },
    }, { requestId: "rpc-1" });

    expect(result).toEqual({
      fidelity: "exact",
      diagnostics: [],
      message: {
        id: "rpc-1",
        method: "session/prompt",
        params: {
          sessionId: "session-1",
          prompt: [{ type: "text", text: "Inspect the API" }],
        },
      },
    });
  });

  it("encodes a canonical interrupt as ACP's session-scoped cancel notification", () => {
    const result = encodeAcpInput({
      schema_version: "oma.event.v1",
      event_id: "interrupt-1",
      type: "user.interrupt",
      session_id: "session-1",
      source: { kind: "user" },
      occurred_at: "2026-08-26T10:59:01.000Z",
      data: {},
    });

    expect(result).toEqual({
      fidelity: "exact",
      diagnostics: [],
      message: {
        method: "session/cancel",
        params: { sessionId: "session-1" },
      },
    });
  });

  it("preserves Backchat's Codex phase, harness identity, and ACP metadata", () => {
    const result = decodeAcpSessionNotification(
      {
        sessionId: "session-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "answer-1",
          content: { type: "text", text: "Checking" },
          _meta: { codex: { phase: "commentary" }, trace: "trace-1" },
        },
      },
      {
        eventId: "answer-event-1",
        occurredAt: "2026-08-27T00:00:00.000Z",
        turnId: "turn-1",
        harness: "codex-acp",
      },
    );

    expect(result.event).toMatchObject({
      source: { kind: "harness", harness: "codex-acp" },
      type: "agent.message_chunk",
      data: {
        text: "Checking",
        message_id: "answer-1",
        phase: "commentary",
        adapter_meta: { codex: { phase: "commentary" }, trace: "trace-1" },
      },
    });
  });

  it("decodes the runtime's direct ACP update without a product parser", () => {
    const result = decodeAcpSessionUpdate(
      "session-1",
      {
        type: "agent_thought_chunk",
        messageId: "thought-1",
        content: { type: "text", text: "Planning" },
      },
      {
        eventId: "thought-event-1",
        occurredAt: "2026-08-27T00:00:01.000Z",
        turnId: "turn-1",
        harness: "codex-acp",
      },
    );

    expect(result).toMatchObject({
      fidelity: "exact",
      event: {
        event_id: "thought-event-1",
        type: "agent.thinking",
        session_id: "session-1",
        turn_id: "turn-1",
        source: { harness: "codex-acp" },
        data: { message_id: "thought-1", text: "Planning" },
      },
    });
  });

  it("passes an OpenMA event straight into Agent UI instead of re-parsing it", () => {
    const canonical = {
      schema_version: "oma.event.v1",
      event_id: "canonical-1",
      type: "agent.message_chunk",
      session_id: "session-1",
      turn_id: "turn-1",
      source: { kind: "harness", harness: "managed-agents" },
      occurred_at: "2026-08-27T00:00:02.000Z",
      data: { text: "Done" },
    } satisfies OpenMAEvent;

    expect(
      decodeAcpSessionUpdate("session-1", canonical, {
        eventId: "ignored",
        occurredAt: "2026-08-27T00:00:03.000Z",
      }),
    ).toEqual({ fidelity: "exact", event: canonical, diagnostics: [] });
  });

  it("decodes an ACP permission request as a correlated host callback", () => {
    const result = decodeAcpAgentRequest(
      {
        id: 42,
        method: "session/request_permission",
        params: {
          sessionId: "session-1",
          toolCall: {
            toolCallId: "tool-1",
            title: "Deploy production",
          },
          options: [
            { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
            { optionId: "reject-once", name: "Reject", kind: "reject_once" },
          ],
        },
      },
      {
        sessionId: "session-1",
        eventId: "callback-request-1",
        occurredAt: "2026-08-26T10:59:02.000Z",
        turnId: "turn-1",
        seq: 2,
      },
    );

    expect(result).toMatchObject({
      fidelity: "exact",
      diagnostics: [],
      event: {
        type: "callback.requested",
        session_id: "session-1",
        turn_id: "turn-1",
        work_item_id: "tool-1",
        data: {
          callback_id: 42,
          method: "session/request_permission",
          category: "permission",
          params: {
            sessionId: "session-1",
            toolCall: { toolCallId: "tool-1", title: "Deploy production" },
            options: [
              { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
              { optionId: "reject-once", name: "Reject", kind: "reject_once" },
            ],
          },
        },
      },
    });
  });

  it("encodes a canonical permission choice as the ACP callback response", () => {
    const result = encodeAcpInput({
      schema_version: "oma.event.v1",
      event_id: "permission-response-42",
      type: "user.permission_response",
      session_id: "session-1",
      turn_id: "turn-1",
      source: { kind: "user" },
      occurred_at: "2026-08-26T10:59:03.000Z",
      data: {
        callback_id: 42,
        tool_call_id: "tool-1",
        decision: "allow",
        option_id: "allow-once",
      },
    });

    expect(result).toEqual({
      fidelity: "exact",
      diagnostics: [],
      message: {
        id: 42,
        result: {
          outcome: {
            outcome: "selected",
            optionId: "allow-once",
          },
        },
      },
    });
  });

  it("preserves a malformed known ACP callback as raw evidence instead of throwing", () => {
    const result = decodeAcpAgentRequest(
      {
        id: "rpc-malformed",
        method: "session/request_permission",
        params: { sessionId: "session-1", options: [] },
      },
      {
        sessionId: "session-1",
        eventId: "callback-malformed-1",
        occurredAt: "2026-08-26T10:59:04.000Z",
      },
    );

    expect(result).toMatchObject({
      fidelity: "unsupported",
      diagnostics: [{
        code: "acp_callback_malformed",
        message: "Malformed ACP callback request: session/request_permission",
      }],
      event: {
        type: "raw.event",
        data: {
          method: "session/request_permission",
          reason: "malformed",
          payload: {
            id: "rpc-malformed",
            method: "session/request_permission",
            params: { sessionId: "session-1", options: [] },
          },
        },
      },
    });
  });

  it("decodes an ACP host notification as a callback notification", () => {
    const result = decodeAcpAgentNotification(
      {
        method: "elicitation/complete",
        params: { elicitationId: "elicitation-1" },
      },
      {
        sessionId: "session-1",
        eventId: "callback-notification-1",
        occurredAt: "2026-08-26T10:59:05.000Z",
        seq: 5,
      },
    );

    expect(result).toMatchObject({
      fidelity: "exact",
      diagnostics: [],
      event: {
        type: "callback.notification",
        data: {
          method: "elicitation/complete",
          category: "elicitation",
          params: { elicitationId: "elicitation-1" },
        },
      },
    });
  });

  it("decodes an observed ACP host response as the callback terminal fact", () => {
    const result = decodeAcpClientResponse(
      {
        id: 42,
        result: {
          outcome: { outcome: "selected", optionId: "allow-once" },
        },
      },
      {
        sessionId: "session-1",
        method: "session/request_permission",
        eventId: "callback-completed-1",
        occurredAt: "2026-08-26T10:59:06.000Z",
        turnId: "turn-1",
        seq: 6,
      },
    );

    expect(result).toMatchObject({
      fidelity: "exact",
      diagnostics: [],
      event: {
        type: "callback.completed",
        data: {
          callback_id: 42,
          method: "session/request_permission",
          category: "permission",
          result: {
            outcome: { outcome: "selected", optionId: "allow-once" },
          },
        },
      },
    });
  });

  it("decodes an ACP prompt response as the terminal turn fact", () => {
    const result = decodeAcpAgentResponse(
      {
        id: "prompt-rpc-1",
        result: {
          stopReason: "end_turn",
          usage: { totalTokens: 321, inputTokens: 200, outputTokens: 121 },
        },
      },
      {
        sessionId: "session-1",
        method: "session/prompt",
        eventId: "turn-terminal-1",
        occurredAt: "2026-08-26T10:59:07.000Z",
        turnId: "turn-1",
        seq: 7,
      },
    );

    expect(result).toMatchObject({
      fidelity: "exact",
      diagnostics: [],
      event: {
        type: "turn.completed",
        turn_id: "turn-1",
        data: {
          request_id: "prompt-rpc-1",
          stop_reason: "end_turn",
          usage: { totalTokens: 321, inputTokens: 200, outputTokens: 121 },
        },
      },
    });
  });

  it("decodes an official agent message chunk without inventing transport metadata", () => {
    const result = decodeAcpSessionNotification(
      {
        sessionId: "session-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "message-1",
          content: { type: "text", text: "Working" },
        },
      },
      {
        eventId: "acp-event-7",
        occurredAt: "2026-08-26T11:00:00.000Z",
        ingestedAt: "2026-08-26T11:00:00.010Z",
        turnId: "turn-1",
        seq: 7,
      },
    );

    expect(result).toEqual({
      fidelity: "exact",
      diagnostics: [],
      event: {
        schema: "oma.event.v1",
        schema_version: "oma.event.v1",
        event_id: "acp-event-7",
        type: "agent.message_chunk",
        session_id: "session-1",
        turn_id: "turn-1",
        source: {
          kind: "harness",
          harness: "acp",
          adapter: "acp-events",
        },
        occurred_at: "2026-08-26T11:00:00.000Z",
        ingested_at: "2026-08-26T11:00:00.010Z",
        seq: 7,
        data: {
          message_id: "message-1",
          text: "Working",
          content: { type: "text", text: "Working" },
        },
      },
    });
  });

  it("keeps ACP user chunks streaming instead of pretending each chunk is a final message", () => {
    const result = decodeAcpSessionNotification(
      {
        sessionId: "session-1",
        update: {
          sessionUpdate: "user_message_chunk",
          messageId: "user-message-1",
          content: { type: "text", text: "Please inspect " },
        },
      },
      {
        eventId: "acp-event-8",
        occurredAt: "2026-08-26T11:00:01.000Z",
        turnId: "turn-1",
        seq: 8,
      },
    );

    expect(result).toMatchObject({
      fidelity: "exact",
      diagnostics: [],
      event: {
        event_id: "acp-event-8",
        type: "user.message_chunk",
        session_id: "session-1",
        turn_id: "turn-1",
        source: {
          kind: "user",
          harness: "acp",
          adapter: "acp-events",
        },
        data: {
          message_id: "user-message-1",
          text: "Please inspect ",
          content: { type: "text", text: "Please inspect " },
        },
      },
    });
  });

  it("decodes thought chunks while preserving a non-text ACP content block", () => {
    const result = decodeAcpSessionNotification(
      {
        sessionId: "session-1",
        update: {
          sessionUpdate: "agent_thought_chunk",
          messageId: "thought-1",
          content: {
            type: "resource_link",
            name: "evidence",
            uri: "file:///workspace/evidence.md",
          },
        },
      },
      {
        eventId: "acp-event-9",
        occurredAt: "2026-08-26T11:00:02.000Z",
        turnId: "turn-1",
        seq: 9,
      },
    );

    expect(result).toMatchObject({
      fidelity: "exact",
      diagnostics: [],
      event: {
        type: "agent.thinking",
        data: {
          message_id: "thought-1",
          content: {
            type: "resource_link",
            name: "evidence",
            uri: "file:///workspace/evidence.md",
          },
        },
      },
    });
    expect((result.event.data as { text?: string }).text).toBeUndefined();
  });

  it("decodes an official ACP tool call into the canonical tool lifecycle", () => {
    const result = decodeAcpSessionNotification(
      {
        sessionId: "session-1",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "tool-1",
          title: "Run tests",
          name: "shell",
          kind: "execute",
          status: "in_progress",
          rawInput: { command: "pnpm test" },
          content: [{ type: "terminal", terminalId: "terminal-1" }],
          locations: [{ path: "/workspace/package.json", line: 7 }],
        },
      },
      {
        eventId: "acp-event-10",
        occurredAt: "2026-08-26T11:00:03.000Z",
        turnId: "turn-1",
        seq: 10,
      },
    );

    expect(result).toMatchObject({
      fidelity: "exact",
      diagnostics: [],
      event: {
        type: "tool.started",
        work_item_id: "tool-1",
        data: {
          tool_call_id: "tool-1",
          title: "Run tests",
          tool_name: "shell",
          kind: "execute",
          status: "in_progress",
          raw_input: { command: "pnpm test" },
          content: [{ type: "terminal", terminalId: "terminal-1" }],
          locations: [{ path: "/workspace/package.json", line: 7 }],
        },
      },
    });
  });

  it("correlates an ACP terminal tool update with the original tool call", () => {
    const result = decodeAcpSessionNotification(
      {
        sessionId: "session-1",
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "tool-1",
          status: "completed",
          rawOutput: { passed: 12 },
          content: [{
            type: "content",
            content: { type: "text", text: "12 tests passed" },
          }],
        },
      },
      {
        eventId: "acp-event-11",
        occurredAt: "2026-08-26T11:00:04.000Z",
        turnId: "turn-1",
        seq: 11,
      },
    );

    expect(result).toMatchObject({
      fidelity: "exact",
      diagnostics: [],
      event: {
        type: "tool.completed",
        work_item_id: "tool-1",
        data: {
          tool_call_id: "tool-1",
          status: "completed",
          raw_output: { passed: 12 },
          content: [{
            type: "content",
            content: { type: "text", text: "12 tests passed" },
          }],
        },
      },
    });
  });

  it("keeps ACP item, Markdown, and removal plan representations distinct", () => {
    const decode = (
      update: { sessionUpdate: string; [key: string]: unknown },
      seq: number,
    ) => decodeAcpSessionNotification(
      { sessionId: "session-1", update },
      {
        eventId: `acp-plan-${seq}`,
        occurredAt: `2026-08-26T11:01:0${seq}.000Z`,
        turnId: "turn-1",
        seq,
      },
    );

    expect(decode({
      sessionUpdate: "plan",
      entries: [{ content: "Inspect API", priority: "high", status: "in_progress" }],
    }, 1)).toMatchObject({
      fidelity: "exact",
      event: {
        type: "plan.updated",
        data: {
          representation: "items",
          update_mode: "replace",
          entries: [{ content: "Inspect API", priority: "high", status: "in_progress" }],
        },
      },
    });

    expect(decode({
      sessionUpdate: "plan_update",
      plan: {
        type: "markdown",
        planId: "plan-1",
        content: "# Release\n\nShip it",
      },
    }, 2)).toMatchObject({
      fidelity: "exact",
      event: {
        type: "plan.updated",
        data: {
          representation: "markdown",
          plan_id: "plan-1",
          update_mode: "replace",
          document: { id: "plan-1", markdown: "# Release\n\nShip it" },
        },
      },
    });

    expect(decode({
      sessionUpdate: "plan_removed",
      planId: "plan-1",
    }, 3)).toMatchObject({
      fidelity: "exact",
      event: {
        type: "plan.removed",
        data: { plan_id: "plan-1" },
      },
    });
  });

  it("decodes ACP command catalog and usage updates into canonical state facts", () => {
    const commandCatalog = decodeAcpSessionNotification(
      {
        sessionId: "session-1",
        update: {
          sessionUpdate: "available_commands_update",
          availableCommands: [{
            name: "review",
            description: "Review the current change",
            input: { hint: "optional focus" },
          }],
        },
      },
      {
        eventId: "acp-command-1",
        occurredAt: "2026-08-26T11:02:00.000Z",
        seq: 20,
      },
    );
    const usage = decodeAcpSessionNotification(
      {
        sessionId: "session-1",
        update: {
          sessionUpdate: "usage_update",
          used: 8_000,
          size: 200_000,
          cost: { amount: 1.25, currency: "USD" },
        },
      },
      {
        eventId: "acp-usage-1",
        occurredAt: "2026-08-26T11:02:01.000Z",
        seq: 21,
      },
    );

    expect(commandCatalog).toMatchObject({
      fidelity: "exact",
      event: {
        type: "command_catalog.updated",
        data: {
          commands: [{
            name: "review",
            description: "Review the current change",
            input: { hint: "optional focus" },
          }],
        },
      },
    });
    expect(usage).toMatchObject({
      fidelity: "exact",
      event: {
        type: "usage.updated",
        data: {
          usage: {
            used: 8_000,
            size: 200_000,
            cost: { amount: 1.25, currency: "USD" },
          },
        },
      },
    });
  });

  it("maps every ACP session capability and metadata update without a UI-specific shape", () => {
    const decode = (
      update: { sessionUpdate: string; [key: string]: unknown },
      seq: number,
    ) => decodeAcpSessionNotification(
      { sessionId: "session-1", update },
      {
        eventId: `acp-capability-${seq}`,
        occurredAt: `2026-08-26T11:03:0${seq}.000Z`,
        seq,
      },
    );

    expect(decode({
      sessionUpdate: "current_mode_update",
      currentModeId: "architect",
    }, 1)).toMatchObject({
      fidelity: "exact",
      event: {
        type: "capability.updated",
        data: {
          capability: "session.mode",
          value: { current_mode_id: "architect" },
        },
      },
    });

    const options = [{
      id: "reasoning",
      name: "Reasoning",
      category: "thought_level",
      type: "boolean",
      currentValue: true,
    }];
    expect(decode({
      sessionUpdate: "config_option_update",
      configOptions: options,
    }, 2)).toMatchObject({
      fidelity: "exact",
      event: {
        type: "capability.updated",
        data: {
          capability: "session.config_options",
          value: options,
        },
      },
    });

    expect(decode({
      sessionUpdate: "session_info_update",
      title: "API refactor",
      updatedAt: "2026-08-26T11:03:03.000Z",
    }, 3)).toMatchObject({
      fidelity: "exact",
      event: {
        type: "session.updated",
        data: {
          title: "API refactor",
          updated_at: "2026-08-26T11:03:03.000Z",
        },
      },
    });
  });

  it("canonicalizes the current ACP wire variants used by Backchat", () => {
    const decode = (update: unknown, seq: number) =>
      decodeAcpSessionUpdate("session-1", update, {
        eventId: `acp-wire-${seq}`,
        occurredAt: `2026-08-26T11:04:0${seq}.000Z`,
        turnId: "turn-1",
        seq,
        harness: "codex-acp",
      });

    expect(decode({
      type: "agent_thought_chunk",
      text: "Inspecting canvas",
      message_id: "thought-1",
    }, 1).event).toMatchObject({
      type: "agent.thinking",
      data: { text: "Inspecting canvas", message_id: "thought-1" },
    });
    expect(decode({
      type: "agent_message_chunk",
      content: "Done",
      message_id: "message-1",
    }, 2).event).toMatchObject({
      type: "agent.message_chunk",
      data: { text: "Done", message_id: "message-1" },
    });
    expect(decode({
      type: "tool_call_update",
      tool_call_id: "tool-2",
      tool_name: "Bash",
      raw_input: { command: "ls" },
      raw_output: "ok",
      status: "completed",
    }, 3).event).toMatchObject({
      type: "tool.completed",
      data: {
        tool_call_id: "tool-2",
        title: "Bash",
        tool_name: "Bash",
        raw_input: { command: "ls" },
        raw_output: "ok",
        status: "completed",
      },
    });
    expect(decode({
      sessionUpdate: "available_commands_update",
      available_commands: [{ name: "review" }],
    }, 4).event).toMatchObject({
      type: "command_catalog.updated",
      data: { commands: [{ name: "review" }] },
    });
    expect(decode({
      sessionUpdate: "plan_update",
      plan: {
        id: "plan-1",
        content: {
          type: "plan",
          entries: [{ content: "Inspect", status: "in_progress" }],
        },
      },
    }, 5).event).toMatchObject({
      type: "plan.updated",
      data: {
        representation: "items",
        plan_id: "plan-1",
        entries: [{ content: "Inspect", status: "in_progress" }],
      },
    });
  });

  it("splits the current Codex skill warning away from same-chunk prose", () => {
    const warning =
      "Warning: Skill descriptions were shortened to fit the skills context budget. " +
      "Codex can still see every skill, but some descriptions are shorter.";
    const mixed = decodeAcpSessionUpdate("session-1", {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: `${warning}\n\nDrink some water.` },
    }, {
      eventId: "acp-warning-mixed",
      occurredAt: "2026-08-26T11:05:00.000Z",
      turnId: "turn-1",
      harness: "codex-acp",
    });
    const standalone = decodeAcpSessionUpdate("session-1", {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: warning },
    }, {
      eventId: "acp-warning-only",
      occurredAt: "2026-08-26T11:05:01.000Z",
      turnId: "turn-1",
      harness: "codex-acp",
    });

    expect(mixed.event).toMatchObject({
      type: "agent.message_chunk",
      data: { text: "Drink some water." },
    });
    expect(standalone.event).toMatchObject({
      type: "system.notice",
      data: { text: warning, tone: "warning" },
    });
  });
});
