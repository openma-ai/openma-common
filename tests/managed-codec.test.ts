import { describe, expect, it } from "vitest";

import * as managedEvents from "../src/protocol/managed/index.js";
import type { OpenMAEvent } from "../src/session-events/openma.js";

type DecodeManagedSessionEvent = (
  event: { type: string; [key: string]: unknown },
  context: {
    sessionId: string;
    turnId?: string;
    ingestedAt?: string;
    seq?: number;
  },
) => {
  fidelity: "exact" | "lossy" | "unsupported";
  event: OpenMAEvent;
  diagnostics: Array<{ code: string; message: string }>;
};

type EncodeManagedSessionInput = (event: OpenMAEvent) => {
  fidelity: "exact" | "lossy" | "unsupported";
  event?: { type: string; [key: string]: unknown };
  diagnostics: Array<{ code: string; message: string }>;
};

type DecodeManagedStreamEvent = DecodeManagedSessionEvent;

const decodeManagedSessionEvent = (
  managedEvents as unknown as {
    decodeManagedSessionEvent: DecodeManagedSessionEvent;
  }
).decodeManagedSessionEvent;

const encodeManagedSessionInput = (
  managedEvents as unknown as {
    encodeManagedSessionInput: EncodeManagedSessionInput;
  }
).encodeManagedSessionInput;

const decodeManagedStreamEvent = (
  managedEvents as unknown as {
    decodeManagedStreamEvent: DecodeManagedStreamEvent;
  }
).decodeManagedStreamEvent;

describe("Managed Agents ↔ OpenMA event codec", () => {
  it("decodes an official user.message event without discarding structured content", () => {
    const result = decodeManagedSessionEvent(
      {
        id: "event-user-1",
        type: "user.message",
        content: [
          { type: "text", text: "Inspect this" },
          {
            type: "image",
            source: { type: "file", file_id: "file_123" },
          },
        ],
        processed_at: "2026-08-26T10:00:00.000Z",
      },
      {
        sessionId: "session-1",
        ingestedAt: "2026-08-26T10:00:01.000Z",
        seq: 7,
      },
    );

    expect(result).toEqual({
      fidelity: "exact",
      diagnostics: [],
      event: {
        schema: "oma.event.v1",
        schema_version: "oma.event.v1",
        event_id: "event-user-1",
        type: "user.message",
        session_id: "session-1",
        source: {
          kind: "harness",
          harness: "managed-agents",
          adapter: "managed-events",
        },
        occurred_at: "2026-08-26T10:00:00.000Z",
        ingested_at: "2026-08-26T10:00:01.000Z",
        seq: 7,
        data: {
          message_id: "event-user-1",
          text: "Inspect this",
          content: [
            { type: "text", text: "Inspect this" },
            {
              type: "image",
              source: { type: "file", file_id: "file_123" },
            },
          ],
        },
      },
    });
  });

  it("encodes an OpenMA user.message as the official client EventParams shape", () => {
    const result = encodeManagedSessionInput({
      schema_version: "oma.event.v1",
      event_id: "local-user-1",
      type: "user.message",
      session_id: "session-1",
      source: { kind: "user" },
      occurred_at: "2026-08-26T10:00:00.000Z",
      data: {
        message_id: "local-user-1",
        text: "Inspect this",
        content: [
          { type: "text", text: "Inspect this" },
          {
            type: "document",
            source: {
              type: "text",
              media_type: "text/plain",
              data: "contract evidence",
            },
          },
        ],
      },
    });

    expect(result).toEqual({
      fidelity: "exact",
      diagnostics: [],
      event: {
        type: "user.message",
        content: [
          { type: "text", text: "Inspect this" },
          {
            type: "document",
            source: {
              type: "text",
              media_type: "text/plain",
              data: "contract evidence",
            },
          },
        ],
      },
    });
  });

  it("preserves an unknown Managed event as an unsupported raw.event", () => {
    const result = decodeManagedSessionEvent(
      {
        id: "event-future-1",
        type: "agent.future_capability",
        processed_at: "2026-08-26T10:02:00.000Z",
        capability: { name: "telepathy", level: 3 },
        session_thread_id: "thread-9",
      },
      {
        sessionId: "session-1",
        ingestedAt: "2026-08-26T10:02:01.000Z",
        seq: 9,
      },
    );

    expect(result).toEqual({
      fidelity: "unsupported",
      diagnostics: [
        {
          code: "managed_event_unsupported",
          message: "Unsupported Managed Agents event type: agent.future_capability",
        },
      ],
      event: {
        schema: "oma.event.v1",
        schema_version: "oma.event.v1",
        event_id: "event-future-1",
        type: "raw.event",
        session_id: "session-1",
        session_thread_id: "thread-9",
        source: {
          kind: "harness",
          harness: "managed-agents",
          adapter: "managed-events",
        },
        occurred_at: "2026-08-26T10:02:00.000Z",
        ingested_at: "2026-08-26T10:02:01.000Z",
        seq: 9,
        data: {
          kind: "raw",
          source: "adapter",
          event_type: "agent.future_capability",
          payload: {
            id: "event-future-1",
            type: "agent.future_capability",
            processed_at: "2026-08-26T10:02:00.000Z",
            capability: { name: "telepathy", level: 3 },
            session_thread_id: "thread-9",
          },
          received_at: "2026-08-26T10:02:01.000Z",
          reason: "unsupported",
        },
      },
    });
  });

  it("decodes an agent.tool_use event into the canonical tool lifecycle", () => {
    const result = decodeManagedSessionEvent(
      {
        id: "tool-use-1",
        type: "agent.tool_use",
        name: "bash",
        input: { command: "pnpm test" },
        evaluated_permission: "ask",
        session_thread_id: "thread-1",
        processed_at: "2026-08-26T10:03:00.000Z",
      },
      {
        sessionId: "session-1",
        turnId: "turn-1",
        ingestedAt: "2026-08-26T10:03:01.000Z",
        seq: 10,
      },
    );

    expect(result).toEqual({
      fidelity: "exact",
      diagnostics: [],
      event: {
        schema: "oma.event.v1",
        schema_version: "oma.event.v1",
        event_id: "tool-use-1",
        type: "tool.started",
        session_id: "session-1",
        session_thread_id: "thread-1",
        turn_id: "turn-1",
        source: {
          kind: "harness",
          harness: "managed-agents",
          adapter: "managed-events",
        },
        occurred_at: "2026-08-26T10:03:00.000Z",
        ingested_at: "2026-08-26T10:03:01.000Z",
        seq: 10,
        data: {
          tool_call_id: "tool-use-1",
          tool_name: "bash",
          kind: "builtin",
          status: "in_progress",
          raw_input: { command: "pnpm test" },
          adapter_meta: {
            evaluated_permission: "ask",
            managed_event_type: "agent.tool_use",
          },
        },
      },
    });
  });

  it("decodes an errored agent.tool_result as a failed tool lifecycle event", () => {
    const result = decodeManagedSessionEvent(
      {
        id: "tool-result-1",
        type: "agent.tool_result",
        tool_use_id: "tool-use-1",
        content: [{ type: "text", text: "permission denied" }],
        is_error: true,
        processed_at: "2026-08-26T10:04:00.000Z",
      },
      {
        sessionId: "session-1",
        turnId: "turn-1",
        seq: 11,
      },
    );

    expect(result).toEqual({
      fidelity: "exact",
      diagnostics: [],
      event: {
        schema: "oma.event.v1",
        schema_version: "oma.event.v1",
        event_id: "tool-result-1",
        type: "tool.failed",
        session_id: "session-1",
        turn_id: "turn-1",
        source: {
          kind: "harness",
          harness: "managed-agents",
          adapter: "managed-events",
        },
        occurred_at: "2026-08-26T10:04:00.000Z",
        seq: 11,
        data: {
          tool_call_id: "tool-use-1",
          status: "failed",
          raw_output: [{ type: "text", text: "permission denied" }],
          content: [{ type: "text", text: "permission denied" }],
          output: {
            kind: "structured",
            data: [{ type: "text", text: "permission denied" }],
          },
          error: "permission denied",
          adapter_meta: {
            is_error: true,
            managed_event_type: "agent.tool_result",
          },
        },
      },
    });
  });

  it("decodes session.status_idle without erasing its Managed stop reason", () => {
    const result = decodeManagedSessionEvent(
      {
        id: "session-idle-1",
        type: "session.status_idle",
        stop_reason: {
          type: "requires_action",
          event_ids: ["tool-use-1", "custom-tool-use-2"],
        },
        processed_at: "2026-08-26T10:05:00.000Z",
      },
      {
        sessionId: "session-1",
        turnId: "turn-1",
        seq: 12,
      },
    );

    expect(result).toEqual({
      fidelity: "exact",
      diagnostics: [],
      event: {
        schema: "oma.event.v1",
        schema_version: "oma.event.v1",
        event_id: "session-idle-1",
        type: "session.idle",
        session_id: "session-1",
        turn_id: "turn-1",
        source: {
          kind: "harness",
          harness: "managed-agents",
          adapter: "managed-events",
        },
        occurred_at: "2026-08-26T10:05:00.000Z",
        seq: 12,
        data: {
          stop_reason: {
            type: "requires_action",
            event_ids: ["tool-use-1", "custom-tool-use-2"],
          },
          adapter_meta: {
            managed_event_type: "session.status_idle",
          },
        },
      },
    });
  });

  it("decodes an agent.message while retaining redacted content blocks", () => {
    const result = decodeManagedSessionEvent(
      {
        id: "agent-message-1",
        type: "agent.message",
        content: [
          { type: "text", text: "Visible answer" },
          { type: "redacted" },
        ],
        processed_at: "2026-08-26T10:06:00.000Z",
      },
      {
        sessionId: "session-1",
        turnId: "turn-1",
        seq: 13,
      },
    );

    expect(result).toEqual({
      fidelity: "exact",
      diagnostics: [],
      event: {
        schema: "oma.event.v1",
        schema_version: "oma.event.v1",
        event_id: "agent-message-1",
        type: "agent.message",
        session_id: "session-1",
        turn_id: "turn-1",
        source: {
          kind: "harness",
          harness: "managed-agents",
          adapter: "managed-events",
        },
        occurred_at: "2026-08-26T10:06:00.000Z",
        seq: 13,
        data: {
          message_id: "agent-message-1",
          text: "Visible answer",
          content: [
            { type: "text", text: "Visible answer" },
            { type: "redacted" },
          ],
        },
      },
    });
  });

  it("decodes session.status_running as canonical session activity", () => {
    const result = decodeManagedSessionEvent(
      {
        id: "session-running-1",
        type: "session.status_running",
        processed_at: "2026-08-26T10:07:00.000Z",
      },
      {
        sessionId: "session-1",
        turnId: "turn-2",
        seq: 14,
      },
    );

    expect(result).toEqual({
      fidelity: "exact",
      diagnostics: [],
      event: {
        schema: "oma.event.v1",
        schema_version: "oma.event.v1",
        event_id: "session-running-1",
        type: "session.running",
        session_id: "session-1",
        turn_id: "turn-2",
        source: {
          kind: "harness",
          harness: "managed-agents",
          adapter: "managed-events",
        },
        occurred_at: "2026-08-26T10:07:00.000Z",
        seq: 14,
        data: {
          adapter_meta: {
            managed_event_type: "session.status_running",
          },
        },
      },
    });
  });

  it("reports a non-sendable OpenMA event instead of throwing", () => {
    const result = encodeManagedSessionInput({
      schema_version: "oma.event.v1",
      event_id: "agent-message-local",
      type: "agent.message",
      session_id: "session-1",
      source: { kind: "openma" },
      occurred_at: "2026-08-26T10:08:00.000Z",
      data: { message_id: "agent-message-local", text: "not client input" },
    });

    expect(result).toEqual({
      fidelity: "unsupported",
      diagnostics: [
        {
          code: "managed_input_unsupported",
          message: "OpenMA event cannot be sent to Managed Agents: agent.message",
        },
      ],
    });
  });

  it("encodes an OpenMA permission response as user.tool_confirmation", () => {
    const result = encodeManagedSessionInput({
      schema_version: "oma.event.v1",
      event_id: "permission-response-1",
      type: "user.permission_response",
      session_id: "session-1",
      turn_id: "turn-1",
      source: { kind: "user" },
      occurred_at: "2026-08-26T10:09:00.000Z",
      data: {
        tool_call_id: "tool-use-1",
        decision: "deny",
        message: "Do not modify production",
      },
    });

    expect(result).toEqual({
      fidelity: "exact",
      diagnostics: [],
      event: {
        type: "user.tool_confirmation",
        tool_use_id: "tool-use-1",
        result: "deny",
        deny_message: "Do not modify production",
      },
    });
  });

  it("decodes user.tool_confirmation back into a canonical permission response", () => {
    const result = decodeManagedSessionEvent(
      {
        id: "permission-response-server-1",
        type: "user.tool_confirmation",
        tool_use_id: "tool-use-1",
        result: "deny",
        deny_message: "Do not modify production",
        session_thread_id: "thread-1",
        processed_at: "2026-08-26T10:10:00.000Z",
      },
      {
        sessionId: "session-1",
        turnId: "turn-1",
        seq: 15,
      },
    );

    expect(result).toEqual({
      fidelity: "exact",
      diagnostics: [],
      event: {
        schema: "oma.event.v1",
        schema_version: "oma.event.v1",
        event_id: "permission-response-server-1",
        type: "user.permission_response",
        session_id: "session-1",
        session_thread_id: "thread-1",
        turn_id: "turn-1",
        source: {
          kind: "user",
          harness: "managed-agents",
          adapter: "managed-events",
        },
        occurred_at: "2026-08-26T10:10:00.000Z",
        seq: 15,
        data: {
          tool_call_id: "tool-use-1",
          decision: "deny",
          message: "Do not modify production",
          adapter_meta: {
            managed_event_type: "user.tool_confirmation",
          },
        },
      },
    });
  });

  it("decodes session.error while preserving retry semantics", () => {
    const result = decodeManagedSessionEvent(
      {
        id: "session-error-1",
        type: "session.error",
        error: {
          type: "model_request_failed_error",
          message: "Model request failed",
          retry_status: { type: "exhausted" },
        },
        processed_at: "2026-08-26T10:11:00.000Z",
      },
      {
        sessionId: "session-1",
        turnId: "turn-1",
        seq: 16,
      },
    );

    expect(result).toEqual({
      fidelity: "exact",
      diagnostics: [],
      event: {
        schema: "oma.event.v1",
        schema_version: "oma.event.v1",
        event_id: "session-error-1",
        type: "session.error",
        session_id: "session-1",
        turn_id: "turn-1",
        source: {
          kind: "harness",
          harness: "managed-agents",
          adapter: "managed-events",
        },
        occurred_at: "2026-08-26T10:11:00.000Z",
        seq: 16,
        data: {
          message: "Model request failed",
          code: "model_request_failed_error",
          retry_status: { type: "exhausted" },
          error: {
            type: "model_request_failed_error",
            message: "Model request failed",
            retry_status: { type: "exhausted" },
          },
          adapter_meta: {
            managed_event_type: "session.error",
          },
        },
      },
    });
  });

  it("decodes the official event_delta stream shape into an idempotent message chunk", () => {
    const result = decodeManagedStreamEvent(
      {
        type: "event_delta",
        event_id: "agent-message-2",
        delta: {
          type: "content_delta",
          index: 0,
          content: { type: "text", text: "Hello " },
        },
      },
      {
        sessionId: "session-1",
        turnId: "turn-2",
        ingestedAt: "2026-08-26T10:12:00.000Z",
        seq: 17,
      },
    );

    expect(result).toEqual({
      fidelity: "exact",
      diagnostics: [],
      event: {
        schema: "oma.event.v1",
        schema_version: "oma.event.v1",
        event_id: "agent-message-2:delta:17",
        type: "agent.message_chunk",
        session_id: "session-1",
        turn_id: "turn-2",
        source: {
          kind: "harness",
          harness: "managed-agents",
          adapter: "managed-events",
        },
        occurred_at: "2026-08-26T10:12:00.000Z",
        ingested_at: "2026-08-26T10:12:00.000Z",
        seq: 17,
        data: {
          message_id: "agent-message-2",
          text: "Hello ",
          content: { type: "text", text: "Hello " },
          adapter_meta: {
            managed_event_type: "event_delta",
            delta_type: "content_delta",
            index: 0,
          },
        },
      },
    });
  });

  it("preserves custom and MCP tool families instead of collapsing them into built-ins", () => {
    const cases = [
      {
        wire: {
          id: "custom-tool-1",
          type: "agent.custom_tool_use",
          name: "deploy",
          input: { environment: "staging" },
          processed_at: "2026-08-26T10:13:00.000Z",
        },
        expectedData: {
          tool_call_id: "custom-tool-1",
          tool_name: "deploy",
          kind: "custom",
          status: "in_progress",
          raw_input: { environment: "staging" },
          adapter_meta: {
            managed_event_type: "agent.custom_tool_use",
          },
        },
      },
      {
        wire: {
          id: "mcp-tool-1",
          type: "agent.mcp_tool_use",
          name: "search",
          mcp_server_name: "knowledge",
          input: { query: "OpenMA" },
          evaluated_permission: "allow",
          processed_at: "2026-08-26T10:13:01.000Z",
        },
        expectedData: {
          tool_call_id: "mcp-tool-1",
          tool_name: "search",
          kind: "mcp",
          status: "in_progress",
          raw_input: { query: "OpenMA" },
          adapter_meta: {
            managed_event_type: "agent.mcp_tool_use",
            mcp_server_name: "knowledge",
            evaluated_permission: "allow",
          },
        },
      },
    ] as const;

    for (const { wire, expectedData } of cases) {
      const result = decodeManagedSessionEvent(wire, {
        sessionId: "session-1",
        turnId: "turn-2",
      });
      expect(result.fidelity).toBe("exact");
      expect(result.diagnostics).toEqual([]);
      expect(result.event).toMatchObject({
        event_id: wire.id,
        type: "tool.started",
        session_id: "session-1",
        turn_id: "turn-2",
        data: expectedData,
      });
    }
  });

  it("correlates an MCP tool result by mcp_tool_use_id", () => {
    const result = decodeManagedSessionEvent(
      {
        id: "mcp-result-1",
        type: "agent.mcp_tool_result",
        mcp_tool_use_id: "mcp-tool-1",
        content: [{ type: "text", text: "2 matches" }],
        is_error: false,
        processed_at: "2026-08-26T10:14:00.000Z",
      },
      {
        sessionId: "session-1",
        turnId: "turn-2",
        seq: 18,
      },
    );

    expect(result).toMatchObject({
      fidelity: "exact",
      diagnostics: [],
      event: {
        event_id: "mcp-result-1",
        type: "tool.completed",
        session_id: "session-1",
        turn_id: "turn-2",
        data: {
          tool_call_id: "mcp-tool-1",
          status: "completed",
          raw_output: [{ type: "text", text: "2 matches" }],
          output: {
            kind: "mcp",
            data: [{ type: "text", text: "2 matches" }],
          },
          adapter_meta: {
            is_error: false,
            managed_event_type: "agent.mcp_tool_result",
          },
        },
      },
    });
  });

  it("encodes a custom tool completion as user.custom_tool_result", () => {
    const result = encodeManagedSessionInput({
      schema_version: "oma.event.v1",
      event_id: "custom-result-local-1",
      type: "tool.completed",
      session_id: "session-1",
      turn_id: "turn-2",
      source: { kind: "openma" },
      occurred_at: "2026-08-26T10:15:00.000Z",
      data: {
        tool_call_id: "custom-tool-1",
        kind: "custom",
        status: "completed",
        content: [{ type: "text", text: "deployed" }],
      },
    });

    expect(result).toEqual({
      fidelity: "exact",
      diagnostics: [],
      event: {
        type: "user.custom_tool_result",
        custom_tool_use_id: "custom-tool-1",
        content: [{ type: "text", text: "deployed" }],
        is_error: false,
      },
    });
  });

  it("encodes custom failures and self-hosted built-in results with distinct SDK types", () => {
    const cases = [
      {
        canonicalType: "tool.failed",
        data: {
          tool_call_id: "custom-tool-2",
          kind: "custom",
          content: [{ type: "text", text: "deployment failed" }],
        },
        expected: {
          type: "user.custom_tool_result",
          custom_tool_use_id: "custom-tool-2",
          content: [{ type: "text", text: "deployment failed" }],
          is_error: true,
        },
      },
      {
        canonicalType: "tool.completed",
        data: {
          tool_call_id: "builtin-tool-2",
          kind: "builtin",
          content: [{ type: "text", text: "done" }],
        },
        expected: {
          type: "user.tool_result",
          tool_use_id: "builtin-tool-2",
          content: [{ type: "text", text: "done" }],
          is_error: false,
        },
      },
    ] as const;

    for (const [index, item] of cases.entries()) {
      const result = encodeManagedSessionInput({
        schema_version: "oma.event.v1",
        event_id: `tool-terminal-${index}`,
        type: item.canonicalType,
        session_id: "session-1",
        source: { kind: "openma" },
        occurred_at: "2026-08-26T10:16:00.000Z",
        data: item.data,
      });
      expect(result).toEqual({
        fidelity: "exact",
        diagnostics: [],
        event: item.expected,
      });
    }
  });

  it("decodes client-provided tool results into correlated canonical terminal events", () => {
    const cases = [
      {
        wire: {
          id: "custom-result-server-1",
          type: "user.custom_tool_result",
          custom_tool_use_id: "custom-tool-1",
          content: [{ type: "text", text: "deployed" }],
          is_error: false,
          processed_at: "2026-08-26T10:17:00.000Z",
        },
        expectedType: "tool.completed",
        expectedKind: "custom",
        expectedToolCallId: "custom-tool-1",
        expectedStatus: "completed",
      },
      {
        wire: {
          id: "builtin-result-server-1",
          type: "user.tool_result",
          tool_use_id: "builtin-tool-1",
          content: [{ type: "text", text: "failed" }],
          is_error: true,
          processed_at: "2026-08-26T10:17:01.000Z",
        },
        expectedType: "tool.failed",
        expectedKind: "builtin",
        expectedToolCallId: "builtin-tool-1",
        expectedStatus: "failed",
      },
    ] as const;

    for (const item of cases) {
      const result = decodeManagedSessionEvent(item.wire, {
        sessionId: "session-1",
        turnId: "turn-2",
      });
      expect(result).toMatchObject({
        fidelity: "exact",
        diagnostics: [],
        event: {
          event_id: item.wire.id,
          type: item.expectedType,
          source: {
            kind: "user",
            harness: "managed-agents",
            adapter: "managed-events",
          },
          data: {
            tool_call_id: item.expectedToolCallId,
            kind: item.expectedKind,
            status: item.expectedStatus,
            content: item.wire.content,
          },
        },
      });
    }
  });

  it("encodes a thread-scoped interrupt without widening it to the whole session", () => {
    const result = encodeManagedSessionInput({
      schema_version: "oma.event.v1",
      event_id: "interrupt-local-1",
      type: "user.interrupt",
      session_id: "session-1",
      session_thread_id: "thread-7",
      source: { kind: "user" },
      occurred_at: "2026-08-26T10:18:00.000Z",
      data: {},
    });

    expect(result).toEqual({
      fidelity: "exact",
      diagnostics: [],
      event: {
        type: "user.interrupt",
        session_thread_id: "thread-7",
      },
    });
  });

  it("decodes the server echo of an interrupt with its thread target intact", () => {
    const result = decodeManagedSessionEvent(
      {
        id: "interrupt-server-1",
        type: "user.interrupt",
        session_thread_id: "thread-7",
        processed_at: "2026-08-26T10:19:00.000Z",
      },
      {
        sessionId: "session-1",
        seq: 19,
      },
    );

    expect(result).toEqual({
      fidelity: "exact",
      diagnostics: [],
      event: {
        schema: "oma.event.v1",
        schema_version: "oma.event.v1",
        event_id: "interrupt-server-1",
        type: "user.interrupt",
        session_id: "session-1",
        session_thread_id: "thread-7",
        source: {
          kind: "user",
          harness: "managed-agents",
          adapter: "managed-events",
        },
        occurred_at: "2026-08-26T10:19:00.000Z",
        seq: 19,
        data: {
          adapter_meta: {
            managed_event_type: "user.interrupt",
          },
        },
      },
    });
  });

  it("decodes a Managed system.message as conversation content, not a UI notice", () => {
    const result = decodeManagedSessionEvent(
      {
        id: "system-message-1",
        type: "system.message",
        content: [{ type: "text", text: "Use the staging environment" }],
        processed_at: "2026-08-26T10:20:00.000Z",
      },
      {
        sessionId: "session-1",
        turnId: "turn-3",
        seq: 20,
      },
    );

    expect(result).toMatchObject({
      fidelity: "exact",
      diagnostics: [],
      event: {
        event_id: "system-message-1",
        type: "system.message",
        session_id: "session-1",
        turn_id: "turn-3",
        source: {
          kind: "system",
          harness: "managed-agents",
          adapter: "managed-events",
        },
        data: {
          message_id: "system-message-1",
          text: "Use the staging environment",
          content: [{ type: "text", text: "Use the staging environment" }],
        },
      },
    });
  });

  it("encodes canonical system.message content into the official input shape", () => {
    const result = encodeManagedSessionInput({
      schema_version: "oma.event.v1",
      event_id: "system-message-local-1",
      type: "system.message",
      session_id: "session-1",
      source: { kind: "system" },
      occurred_at: "2026-08-26T10:21:00.000Z",
      data: {
        message_id: "system-message-local-1",
        text: "Use the staging environment",
        content: [{ type: "text", text: "Use the staging environment" }],
      },
    });

    expect(result).toEqual({
      fidelity: "exact",
      diagnostics: [],
      event: {
        type: "system.message",
        content: [{ type: "text", text: "Use the staging environment" }],
      },
    });
  });

  it("decodes session.usage without flattening cost and token dimensions", () => {
    const result = decodeManagedSessionEvent(
      {
        id: "usage-1",
        type: "session.usage",
        usage: {
          active_seconds: 12.5,
          input_tokens: 1_000,
          output_tokens: 250,
          cache_read_input_tokens: 400,
          server_tool_use: { web_search_requests: 2 },
          list_cost: { currency: "USD", amount: "0.42" },
        },
        budget: {
          currency: "USD",
          max_list_cost: "2.00",
        },
        processed_at: "2026-08-26T10:22:00.000Z",
      },
      {
        sessionId: "session-1",
        seq: 21,
      },
    );

    expect(result).toMatchObject({
      fidelity: "exact",
      diagnostics: [],
      event: {
        event_id: "usage-1",
        type: "usage.updated",
        session_id: "session-1",
        data: {
          usage: {
            active_seconds: 12.5,
            input_tokens: 1_000,
            output_tokens: 250,
            cache_read_input_tokens: 400,
            server_tool_use: { web_search_requests: 2 },
            list_cost: { currency: "USD", amount: "0.42" },
          },
          budget: {
            currency: "USD",
            max_list_cost: "2.00",
          },
          adapter_meta: {
            managed_event_type: "session.usage",
          },
        },
      },
    });
  });

  it("decodes agent.thinking as a progress signal without inventing hidden text", () => {
    const result = decodeManagedSessionEvent(
      {
        id: "thinking-1",
        type: "agent.thinking",
        processed_at: "2026-08-26T10:23:00.000Z",
      },
      {
        sessionId: "session-1",
        turnId: "turn-3",
        seq: 22,
      },
    );

    expect(result).toMatchObject({
      fidelity: "exact",
      diagnostics: [],
      event: {
        event_id: "thinking-1",
        type: "agent.thinking",
        session_id: "session-1",
        turn_id: "turn-3",
        data: {
          message_id: "thinking-1",
          adapter_meta: {
            managed_event_type: "agent.thinking",
            progress_signal: true,
          },
        },
      },
    });
    expect((result.event.data as { text?: unknown }).text).toBeUndefined();
  });

  it("decodes session.status_terminated as a terminal session fact", () => {
    const result = decodeManagedSessionEvent(
      {
        id: "session-terminated-1",
        type: "session.status_terminated",
        processed_at: "2026-08-26T10:24:00.000Z",
      },
      {
        sessionId: "session-1",
        seq: 23,
      },
    );

    expect(result).toMatchObject({
      fidelity: "exact",
      diagnostics: [],
      event: {
        event_id: "session-terminated-1",
        type: "session.terminated",
        session_id: "session-1",
        data: {
          adapter_meta: {
            managed_event_type: "session.status_terminated",
          },
        },
      },
    });
  });

  it("keeps session rescheduling distinct from ordinary running state", () => {
    const result = decodeManagedSessionEvent(
      {
        id: "session-rescheduled-1",
        type: "session.status_rescheduled",
        processed_at: "2026-08-26T10:25:00.000Z",
      },
      {
        sessionId: "session-1",
        seq: 24,
      },
    );

    expect(result).toMatchObject({
      fidelity: "exact",
      diagnostics: [],
      event: {
        event_id: "session-rescheduled-1",
        type: "session.rescheduled",
        session_id: "session-1",
        data: {
          adapter_meta: {
            managed_event_type: "session.status_rescheduled",
          },
        },
      },
    });
  });

  it("uses ingestion time when an official input echo has no processed_at", () => {
    const result = decodeManagedSessionEvent(
      {
        id: "user-message-null-time",
        type: "user.message",
        content: [{ type: "text", text: "Hello" }],
        processed_at: null,
      },
      {
        sessionId: "session-1",
        ingestedAt: "2026-08-26T10:26:00.000Z",
        seq: 25,
      },
    );

    expect(result).toMatchObject({
      fidelity: "lossy",
      diagnostics: [
        {
          code: "managed_event_timestamp_missing",
          message: "Managed Agents event user-message-null-time has no processed_at; used ingestedAt",
        },
      ],
      event: {
        event_id: "user-message-null-time",
        type: "user.message",
        occurred_at: "2026-08-26T10:26:00.000Z",
        ingested_at: "2026-08-26T10:26:00.000Z",
      },
    });
  });

  it("preserves a malformed known event as raw evidence with a deterministic id", () => {
    const malformed = {
      type: "user.message",
      content: [{ type: "text", text: "Missing its server id" }],
      processed_at: "2026-08-26T10:27:00.000Z",
    };
    const result = decodeManagedSessionEvent(malformed, {
      sessionId: "session-1",
      ingestedAt: "2026-08-26T10:27:01.000Z",
      seq: 26,
    });

    expect(result).toEqual({
      fidelity: "unsupported",
      diagnostics: [
        {
          code: "managed_event_malformed",
          message: "Managed Agents event user.message is missing required id",
        },
      ],
      event: {
        schema: "oma.event.v1",
        schema_version: "oma.event.v1",
        event_id: "managed:user.message:26",
        type: "raw.event",
        session_id: "session-1",
        source: {
          kind: "harness",
          harness: "managed-agents",
          adapter: "managed-events",
        },
        occurred_at: "2026-08-26T10:27:00.000Z",
        ingested_at: "2026-08-26T10:27:01.000Z",
        seq: 26,
        data: {
          kind: "raw",
          source: "adapter",
          event_type: "user.message",
          payload: malformed,
          received_at: "2026-08-26T10:27:01.000Z",
          reason: "malformed",
        },
      },
    });
  });

  it("preserves event_start as known stream framing without inventing UI content", () => {
    const wire = {
      type: "event_start",
      event: {
        id: "agent-message-3",
        type: "agent.message",
      },
    };
    const result = decodeManagedStreamEvent(wire, {
      sessionId: "session-1",
      turnId: "turn-4",
      ingestedAt: "2026-08-26T10:28:00.000Z",
      seq: 27,
    });

    expect(result).toEqual({
      fidelity: "exact",
      diagnostics: [],
      event: {
        schema: "oma.event.v1",
        schema_version: "oma.event.v1",
        event_id: "agent-message-3:start",
        type: "vendor.event",
        session_id: "session-1",
        turn_id: "turn-4",
        source: {
          kind: "harness",
          harness: "managed-agents",
          adapter: "managed-events",
        },
        occurred_at: "2026-08-26T10:28:00.000Z",
        ingested_at: "2026-08-26T10:28:00.000Z",
        seq: 27,
        data: {
          kind: "vendor",
          harness: "managed-agents",
          namespace: "stream",
          name: "event_start",
          correlation: {
            session_id: "session-1",
            turn_id: "turn-4",
          },
          data: wire,
        },
      },
    });
  });

  it("preserves every current noncanonical Managed session event as a known vendor event", () => {
    const types = [
      "agent.thread_message_received",
      "agent.thread_message_sent",
      "agent.thread_context_compacted",
      "session.thread_created",
      "session.thread_status_running",
      "session.thread_status_idle",
      "session.thread_status_terminated",
      "session.thread_status_rescheduled",
      "span.model_request_start",
      "span.model_request_end",
      "session.deleted",
    ] as const;

    for (const [index, type] of types.entries()) {
      const wire = {
        id: `known-vendor-${index}`,
        type,
        processed_at: `2026-08-26T10:29:${String(index).padStart(2, "0")}.000Z`,
        evidence: { preserved: true },
      };
      const result = decodeManagedSessionEvent(wire, {
        sessionId: "session-1",
        turnId: "turn-5",
        seq: 100 + index,
      });

      expect(result).toMatchObject({
        fidelity: "exact",
        diagnostics: [],
        event: {
          event_id: `known-vendor-${index}`,
          type: "vendor.event",
          session_id: "session-1",
          turn_id: "turn-5",
          data: {
            kind: "vendor",
            harness: "managed-agents",
            namespace: "session-events",
            name: type,
            data: wire,
          },
        },
      });
    }
  });

  it("maps the official session.updated event into canonical session state", () => {
    const result = decodeManagedSessionEvent(
      {
        id: "session-updated-1",
        type: "session.updated",
        processed_at: "2026-08-26T10:29:30.000Z",
        title: "SDK-first refactor",
        metadata: { lane: "v1" },
        budget: {
          type: "limit",
          max_list_cost: { amount: "12.50", currency: "USD" },
        },
        agent: null,
      },
      {
        sessionId: "session-1",
        seq: 120,
      },
    );

    expect(result).toEqual({
      fidelity: "exact",
      diagnostics: [],
      event: {
        schema: "oma.event.v1",
        schema_version: "oma.event.v1",
        event_id: "session-updated-1",
        type: "session.updated",
        session_id: "session-1",
        source: {
          kind: "harness",
          harness: "managed-agents",
          adapter: "managed-events",
        },
        occurred_at: "2026-08-26T10:29:30.000Z",
        seq: 120,
        data: {
          title: "SDK-first refactor",
          metadata: { lane: "v1" },
          budget: {
            type: "limit",
            max_list_cost: { amount: "12.50", currency: "USD" },
          },
          agent: null,
          updated_at: "2026-08-26T10:29:30.000Z",
          adapter_meta: { managed_event_type: "session.updated" },
        },
      },
    });
  });

  it("encodes a canonical outcome definition as user.define_outcome", () => {
    const result = encodeManagedSessionInput({
      schema_version: "oma.event.v1",
      event_id: "outcome-local-1",
      type: "outcome.defined",
      session_id: "session-1",
      source: { kind: "user" },
      occurred_at: "2026-08-26T10:30:00.000Z",
      data: {
        description: "All tests pass",
        rubric: { type: "text", content: "No failing tests" },
        max_iterations: 5,
      },
    });

    expect(result).toEqual({
      fidelity: "exact",
      diagnostics: [],
      event: {
        type: "user.define_outcome",
        description: "All tests pass",
        rubric: { type: "text", content: "No failing tests" },
        max_iterations: 5,
      },
    });
  });

  it("decodes the server outcome echo with its generated outcome_id", () => {
    const result = decodeManagedSessionEvent(
      {
        id: "outcome-event-1",
        type: "user.define_outcome",
        outcome_id: "outc_123",
        description: "All tests pass",
        rubric: { type: "text", content: "No failing tests" },
        max_iterations: 5,
        processed_at: "2026-08-26T10:31:00.000Z",
      },
      {
        sessionId: "session-1",
        seq: 200,
      },
    );

    expect(result).toMatchObject({
      fidelity: "exact",
      diagnostics: [],
      event: {
        event_id: "outcome-event-1",
        type: "outcome.defined",
        session_id: "session-1",
        source: {
          kind: "user",
          harness: "managed-agents",
          adapter: "managed-events",
        },
        data: {
          outcome_id: "outc_123",
          description: "All tests pass",
          rubric: { type: "text", content: "No failing tests" },
          max_iterations: 5,
          adapter_meta: {
            managed_event_type: "user.define_outcome",
          },
        },
      },
    });
  });

  it("maps outcome evaluation spans into a canonical progress lifecycle", () => {
    const cases = [
      {
        wire: {
          id: "evaluation-start-1",
          type: "span.outcome_evaluation_start",
          outcome_id: "outc_123",
          iteration: 0,
          processed_at: "2026-08-26T10:32:00.000Z",
        },
        expectedType: "outcome.evaluation_started",
        expectedData: {
          outcome_id: "outc_123",
          iteration: 0,
        },
      },
      {
        wire: {
          id: "evaluation-progress-1",
          type: "span.outcome_evaluation_ongoing",
          outcome_id: "outc_123",
          iteration: 0,
          processed_at: "2026-08-26T10:32:01.000Z",
        },
        expectedType: "outcome.evaluation_progress",
        expectedData: {
          outcome_id: "outc_123",
          iteration: 0,
        },
      },
      {
        wire: {
          id: "evaluation-end-1",
          type: "span.outcome_evaluation_end",
          outcome_evaluation_start_id: "evaluation-start-1",
          outcome_id: "outc_123",
          iteration: 0,
          result: "satisfied",
          explanation: "All criteria met",
          usage: { input_tokens: 100, output_tokens: 20 },
          processed_at: "2026-08-26T10:32:02.000Z",
        },
        expectedType: "outcome.evaluation_completed",
        expectedData: {
          outcome_id: "outc_123",
          iteration: 0,
          outcome_evaluation_start_id: "evaluation-start-1",
          result: "satisfied",
          explanation: "All criteria met",
          usage: { input_tokens: 100, output_tokens: 20 },
        },
      },
    ] as const;

    for (const item of cases) {
      const result = decodeManagedSessionEvent(item.wire, {
        sessionId: "session-1",
      });
      expect(result).toMatchObject({
        fidelity: "exact",
        diagnostics: [],
        event: {
          event_id: item.wire.id,
          type: item.expectedType,
          data: {
            ...item.expectedData,
            adapter_meta: { managed_event_type: item.wire.type },
          },
        },
      });
    }
  });
});
