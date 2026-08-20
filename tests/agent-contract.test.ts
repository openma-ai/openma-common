import { describe, expect, it } from "vitest";

import {
  createOpenMAEvent,
  createAgentSessionHandle,
  callbackFingerprint,
  immutableJson,
  isElicitationRequestEvent,
  isPermissionRequestEvent,
  isTurnTerminalEvent,
  turnTerminalStatus,
  type AgentSessionInput,
  type AgentTurnInput,
  type OpenMAAgentConnector,
} from "../src/agent-contract/index.js";
import { acpEventToOpenMA } from "../src/agent-contract/acp.js";
import { managedEventToOpenMA } from "../src/agent-contract/managed.js";

const context = {
  eventId: "event-1",
  sessionId: "session-1",
  turnId: "turn-1",
  occurredAt: "2026-08-19T04:00:00.000Z",
  seq: 7,
};

describe("OpenMA Agent Contract", () => {
  it("carries durable host identities into connector session and Turn calls", () => {
    const session: AgentSessionInput = {
      sessionId: "session-1",
      idempotencyKey: "session-1",
      generation: 2,
      agentId: "claude",
    };
    const turn: AgentTurnInput = {
      sessionId: "session-1",
      turnId: "turn-1",
      afterSequence: 7,
      content: "continue",
    };

    expect(session).toMatchObject({
      sessionId: "session-1",
      idempotencyKey: "session-1",
      generation: 2,
    });
    expect(turn).toMatchObject({
      sessionId: "session-1",
      turnId: "turn-1",
      afterSequence: 7,
    });
  });
  it.each([
    ["undefined property", { value: undefined }],
    ["function property", { value: () => "not JSON" }],
    ["symbol property", { value: Symbol("not JSON") }],
    ["BigInt property", { value: 1n }],
    ["NaN", { value: Number.NaN }],
    ["Infinity", { value: Number.POSITIVE_INFINITY }],
    ["Date", { value: new Date("2026-08-19T04:00:00.000Z") }],
    ["Map", { value: new Map([["key", "value"]]) }],
  ])("rejects %s instead of coercing it into a JSON fact", (_label, value) => {
    expect(() => immutableJson(value)).toThrow(TypeError);
  });

  it("rejects cyclic and sparse data while accepting null-prototype JSON objects", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const sparse = new Array(2);
    sparse[1] = "present";
    expect(() => immutableJson(cyclic)).toThrow(TypeError);
    expect(() => immutableJson(sparse)).toThrow(TypeError);

    const dictionary = Object.create(null) as Record<string, unknown>;
    dictionary.answer = 42;
    const result = immutableJson({ dictionary });
    expect(result).toEqual({ dictionary: { answer: 42 } });
    expect(Object.isFrozen(result.dictionary)).toBe(true);
  });

  it("uses the strict JSON boundary for events, handles, and callback fingerprints", () => {
    expect(() => createOpenMAEvent({
      event_id: "event-invalid-json",
      type: "agent.message",
      session_id: "session-1",
      source: { kind: "harness", harness: "fixture" },
      occurred_at: "2026-08-19T04:00:00.000Z",
      data: { receivedAt: new Date() },
    })).toThrow(TypeError);
    expect(() => createAgentSessionHandle({
      connectorId: "fixture",
      externalSessionId: "external-1",
      placement: "remote",
      metadata: { dangerous: new Map() } as never,
    })).toThrow(TypeError);
    expect(() => callbackFingerprint(
      context,
      "permission",
      "tool/permission",
      "callback-1",
      { command: undefined },
    )).toThrow(TypeError);
  });

  it("creates a vendor-neutral external session handle", () => {
    const metadata = { region: "us-east", routing: { shard: 3 } };
    const handle = createAgentSessionHandle({
      connectorId: "claude-managed",
      externalSessionId: "sess_managed_1",
      placement: "managed",
      metadata,
    });

    metadata.routing.shard = 9;

    expect(handle).toEqual({
      connectorId: "claude-managed",
      externalSessionId: "sess_managed_1",
      placement: "managed",
      metadata: { region: "us-east", routing: { shard: 3 } },
    });
    expect(Object.isFrozen(handle)).toBe(true);
    expect(Object.isFrozen(handle.metadata?.routing)).toBe(true);

    expect(() => createAgentSessionHandle({
      connectorId: "",
      externalSessionId: "sess_managed_1",
      placement: "managed",
    })).toThrow("connectorId");
  });

  it("defines a connector contract that can expose a real event stream", async () => {
    const connector: OpenMAAgentConnector = {
      id: "fixture",
      async capabilities() {
        return {
          sessionPersistence: "resumable",
          streaming: true,
          cancellation: true,
          permissions: false,
          elicitation: false,
        };
      },
      async open() {
        return createAgentSessionHandle({
          connectorId: "fixture",
          externalSessionId: "external-1",
          placement: "remote",
        });
      },
      async *execute() {
        yield managedEventToOpenMA(
          { type: "agent.message", id: "message-1", content: "done" },
          context,
        );
      },
      async send() {},
      async close() {},
    };

    const turn: AgentTurnInput = {
      sessionId: "session-1",
      turnId: "turn-1",
      afterSequence: 0,
      contextDigest: "sha256:context",
      content: "do the work",
    };
    const events = [];
    for await (const event of connector.execute(
      await connector.open({
        sessionId: "session-1",
        idempotencyKey: "session-1",
        generation: 1,
        agentId: "agent-1",
      }),
      turn,
    )) events.push(event);

    expect(events).toMatchObject([{
      type: "agent.message",
      session_id: "session-1",
      turn_id: "turn-1",
      data: { text: "done", message_id: "message-1" },
    }]);
  });

  it("publishes deeply immutable JSON events from the canonical entrypoint", () => {
    const payload = { text: "hello", evidence: [{ id: "issue-1" }] };
    const event = createOpenMAEvent({
      event_id: "event-json-1",
      type: "agent.message",
      session_id: "session-1",
      source: { kind: "harness", harness: "fixture" },
      occurred_at: "2026-08-19T04:00:00.000Z",
      data: payload,
    });

    payload.evidence[0]!.id = "mutated";

    expect(JSON.parse(JSON.stringify(event))).toEqual({
      schema_version: "oma.event.v1",
      event_id: "event-json-1",
      type: "agent.message",
      session_id: "session-1",
      source: { kind: "harness", harness: "fixture" },
      occurred_at: "2026-08-19T04:00:00.000Z",
      data: { text: "hello", evidence: [{ id: "issue-1" }] },
    });
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.data)).toBe(true);
    expect(Object.isFrozen(event.data.evidence[0])).toBe(true);
  });
});

describe("Agent wire adapters", () => {
  it("lifts a Claude Managed message into the canonical OpenMA envelope", () => {
    expect(managedEventToOpenMA(
      {
        type: "agent.message",
        id: "message-1",
        session_thread_id: "sthr_primary",
        content: [{ type: "text", text: "Deployment finished" }],
      },
      context,
    )).toEqual({
      schema_version: "oma.event.v1",
      event_id: "event-1",
      type: "agent.message",
      session_id: "session-1",
      session_thread_id: "sthr_primary",
      turn_id: "turn-1",
      source: {
        kind: "harness",
        harness: "claude-managed",
        adapter: "managed",
      },
      occurred_at: "2026-08-19T04:00:00.000Z",
      seq: 7,
      data: {
        text: "Deployment finished",
        message_id: "message-1",
      },
    });
  });

  it("preserves an unknown Managed event as a namespaced vendor fact", () => {
    expect(managedEventToOpenMA(
      { type: "agent.future_event", id: "future-1", value: 42 },
      context,
    )).toMatchObject({
      type: "vendor.event",
      data: {
        kind: "vendor",
        harness: "claude-managed",
        namespace: "claudeManaged",
        name: "agent.future_event",
        correlation: {
          session_id: "session-1",
          turn_id: "turn-1",
        },
        data: { type: "agent.future_event", id: "future-1", value: 42 },
      },
    });
  });

  it("lifts an ACP session update into the same canonical message event", () => {
    expect(acpEventToOpenMA(
      {
        sessionUpdate: "agent_message_chunk",
        messageId: "message-acp-1",
        content: { type: "text", text: "Inspecting repository" },
      },
      context,
    )).toEqual({
      schema_version: "oma.event.v1",
      event_id: "event-1",
      type: "agent.message_chunk",
      session_id: "session-1",
      turn_id: "turn-1",
      source: {
        kind: "harness",
        harness: "acp",
        adapter: "acp",
      },
      occurred_at: "2026-08-19T04:00:00.000Z",
      seq: 7,
      data: {
        text: "Inspecting repository",
        message_id: "message-acp-1",
      },
    });
  });

  it("does not leak an unknown ACP tool status into the canonical status enum", () => {
    expect(acpEventToOpenMA(
      {
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        title: "Future tool",
        status: "queued_by_vendor",
      },
      context,
    )).toMatchObject({
      type: "tool.started",
      data: {
        tool_call_id: "tool-1",
      },
    });
    expect(acpEventToOpenMA(
      {
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        title: "Future tool",
        status: "queued_by_vendor",
      },
      context,
    ).data).not.toHaveProperty("status");
  });

  it.each([
    ["end_turn", "turn.completed"],
    ["max_tokens", "turn.completed"],
    ["cancelled", "turn.cancelled"],
  ] as const)("maps ACP prompt stop reason %s to %s", (stopReason, type) => {
    expect(acpEventToOpenMA(
      { type: "promptComplete", response: { stopReason } },
      context,
    )).toMatchObject({
      type,
      turn_id: "turn-1",
      data: { stop_reason: stopReason },
    });
  });

  it("maps ACP prompt and callback failures without presenting them as messages", () => {
    expect(acpEventToOpenMA(
      { type: "promptError", error: "provider unavailable" },
      context,
    )).toMatchObject({
      type: "turn.failed",
      data: { error: "provider unavailable" },
    });

    const permission = acpEventToOpenMA(
      {
        type: "acp.client_request",
        requestId: "request-1",
        method: "session/request_permission",
        params: { toolCall: { toolCallId: "tool-1" } },
      },
      context,
    );
    expect(permission).toMatchObject({
      type: "callback.requested",
      data: {
        callback_id: "request-1",
        fingerprint:
          "oma.callback.v1/session-1/turn-1/permission/session%2Frequest_permission/request-1/%7B%22toolCall%22%3A%7B%22toolCallId%22%3A%22tool-1%22%7D%7D",
        method: "session/request_permission",
        category: "permission",
        params: { toolCall: { toolCallId: "tool-1" } },
      },
    });
    expect(isPermissionRequestEvent(permission)).toBe(true);
    expect(isElicitationRequestEvent(permission)).toBe(false);
    if (!isPermissionRequestEvent(permission)) throw new Error("unreachable");
    expect(permission.data.callback_id).toBe("request-1");
    expect(permission.data.fingerprint).toContain("toolCallId");
  });

  it("classifies an ACP elicitation without exposing its wire method to consumers", () => {
    const elicitation = acpEventToOpenMA(
      {
        type: "acp.client_request",
        requestId: "request-form-1",
        method: "elicitation/create",
        params: { mode: "form", message: "Choose an environment" },
      },
      context,
    );

    expect(elicitation).toMatchObject({
      type: "callback.requested",
      data: {
        callback_id: "request-form-1",
        category: "elicitation",
        fingerprint:
          "oma.callback.v1/session-1/turn-1/elicitation/elicitation%2Fcreate/request-form-1/%7B%22message%22%3A%22Choose%20an%20environment%22%2C%22mode%22%3A%22form%22%7D",
      },
    });
    expect(isElicitationRequestEvent(elicitation)).toBe(true);
  });

  it("does not narrow malformed callback facts into actionable requests", () => {
    const malformed = createOpenMAEvent({
      event_id: "malformed-callback-1",
      type: "callback.requested",
      session_id: "session-1",
      turn_id: "turn-1",
      seq: 8,
      source: { kind: "harness", harness: "fixture" },
      occurred_at: "2026-08-19T04:00:00.000Z",
      data: { method: "session/request_permission", category: "permission" },
    });

    expect(isPermissionRequestEvent(malformed)).toBe(false);

    const uncorrelatedTerminal = createOpenMAEvent({
      event_id: "terminal-without-turn-1",
      type: "turn.completed",
      session_id: "session-1",
      source: { kind: "harness", harness: "fixture" },
      occurred_at: "2026-08-19T04:00:00.000Z",
      data: { stop_reason: "end_turn" },
    });
    expect(isTurnTerminalEvent(uncorrelatedTerminal)).toBe(false);
  });

  it.each([
    [{ type: "session.status_running" }, "turn.started", {}],
    [
      { type: "session.status_idle", stop_reason: { type: "end_turn" } },
      "turn.completed",
      { stop_reason: "end_turn" },
    ],
    [
      { type: "session.status_idle", stop_reason: { type: "retries_exhausted" } },
      "turn.failed",
      { stop_reason: "retries_exhausted" },
    ],
    [
      { type: "session.status_rescheduled", reason: "sandbox unavailable" },
      "turn.queued",
      { reason: "sandbox unavailable" },
    ],
  ] as const)("maps Managed lifecycle %o to %s", (wire, type, data) => {
    expect(managedEventToOpenMA(wire, context)).toMatchObject({
      type,
      turn_id: "turn-1",
      data,
    });
  });

  it("maps a Managed custom tool call to the shared callback lifecycle", () => {
    expect(managedEventToOpenMA(
      {
        type: "agent.custom_tool_use",
        id: "custom-1",
        name: "approve_deploy",
        input: { environment: "production" },
      },
      context,
    )).toMatchObject({
      type: "callback.requested",
      data: {
        callback_id: "custom-1",
        fingerprint:
          "oma.callback.v1/session-1/turn-1/extension/tool%2Fcustom/custom-1/%7B%22input%22%3A%7B%22environment%22%3A%22production%22%7D%2C%22tool_name%22%3A%22approve_deploy%22%7D",
        method: "tool/custom",
        category: "extension",
        params: {
          tool_name: "approve_deploy",
          input: { environment: "production" },
        },
      },
    });

    expect(managedEventToOpenMA(
      {
        type: "user.custom_tool_result",
        custom_tool_use_id: "custom-1",
        content: [{ type: "text", text: "approved" }],
      },
      context,
    )).toMatchObject({
      type: "callback.completed",
      data: {
        callback_id: "custom-1",
        method: "tool/custom",
        category: "extension",
        result: [{ type: "text", text: "approved" }],
      },
    });
  });

  it("standardizes Managed tool confirmation as a permission callback", () => {
    const permission = managedEventToOpenMA(
      {
        type: "agent.tool_use",
        id: "tool-confirm-1",
        name: "bash",
        input: { command: "deploy" },
        evaluated_permission: "ask",
      },
      context,
    );
    expect(permission).toMatchObject({
      type: "callback.requested",
      data: {
        callback_id: "tool-confirm-1",
        fingerprint:
          "oma.callback.v1/session-1/turn-1/permission/tool%2Fpermission/tool-confirm-1/%7B%22input%22%3A%7B%22command%22%3A%22deploy%22%7D%2C%22tool_name%22%3A%22bash%22%7D",
        method: "tool/permission",
        category: "permission",
        params: { tool_name: "bash", input: { command: "deploy" } },
      },
    });
    expect(isPermissionRequestEvent(permission)).toBe(true);

    expect(managedEventToOpenMA(
      {
        type: "user.tool_confirmation",
        tool_use_id: "tool-confirm-1",
        result: "allow",
      },
      context,
    )).toMatchObject({
      type: "callback.completed",
      data: {
        callback_id: "tool-confirm-1",
        method: "tool/permission",
        category: "permission",
        result: { outcome: "allow" },
      },
    });
  });

  it("binds callback fingerprints to canonical request parameters", () => {
    const mapPermission = (command: string, environment: string) =>
      managedEventToOpenMA(
        {
          type: "agent.tool_use",
          id: "tool-confirm-1",
          name: "bash",
          input: { environment, command },
          evaluated_permission: "ask",
        },
        context,
      );

    const production = mapPermission("deploy", "production");
    const staging = mapPermission("deploy", "staging");
    const reordered = managedEventToOpenMA(
      {
        type: "agent.tool_use",
        id: "tool-confirm-1",
        name: "bash",
        input: { command: "deploy", environment: "production" },
        evaluated_permission: "ask",
      },
      context,
    );

    const fingerprint = (event: ReturnType<typeof managedEventToOpenMA>) =>
      (event.data as { fingerprint?: string }).fingerprint;
    expect(fingerprint(production)).not.toBe(fingerprint(staging));
    expect(fingerprint(production)).toBe(fingerprint(reordered));
  });

  it("rejects unstable mapper context instead of emitting uncorrelatable facts", () => {
    expect(() => managedEventToOpenMA(
      { type: "session.status_running" },
      { ...context, turnId: "" },
    )).toThrow("turnId");
    expect(() => acpEventToOpenMA(
      { type: "promptComplete", response: { stopReason: "end_turn" } },
      { ...context, seq: -1 },
    )).toThrow("seq");
  });

  it.each([
    [{ type: "promptComplete", response: { stopReason: "end_turn" } }, acpEventToOpenMA, "completed"],
    [{ type: "promptComplete", response: { stopReason: "cancelled" } }, acpEventToOpenMA, "cancelled"],
    [{ type: "promptError", error: "crashed" }, acpEventToOpenMA, "failed"],
    [{ type: "user.interrupt", id: "interrupt-1" }, managedEventToOpenMA, "interrupted"],
  ] as const)("exposes terminal status %s without vendor parsing", (wire, mapper, status) => {
    const terminal = mapper(wire, context);
    expect(isTurnTerminalEvent(terminal)).toBe(true);
    expect(turnTerminalStatus(terminal)).toBe(status);
    if (!isTurnTerminalEvent(terminal)) throw new Error("unreachable");
    expect(terminal.turn_id).toBe("turn-1");
  });

  it("re-snapshots an already canonical event without changing its value", () => {
    const canonical = managedEventToOpenMA(
      { type: "session.status_idle" },
      context,
    );
    const snapshot = acpEventToOpenMA(canonical, context);

    expect(snapshot).toEqual(canonical);
    expect(snapshot).not.toBe(canonical);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it("rejects a canonical pass-through event with mismatched correlation", () => {
    const canonical = managedEventToOpenMA(
      { type: "session.status_idle" },
      context,
    );

    expect(() => acpEventToOpenMA(canonical, {
      ...context,
      eventId: "replacement-id",
    })).toThrow("event_id");
  });
});
