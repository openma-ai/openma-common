import {
  eventThreadId,
  normalizeSessionEvent,
  type WireSessionEvent,
} from "../session-events/managed.js";
import {
  createOpenMAEvent,
  createVendorEvent,
  type CallbackLifecycleData,
  type OpenMAEvent,
  type ToolLifecycleData,
} from "../session-events/openma.js";
import {
  agentEventEnvelope,
  callbackFingerprint,
  type AgentEventContext,
} from "./index.js";

const MANAGED_SOURCE = {
  kind: "harness" as const,
  harness: "claude-managed",
  adapter: "managed",
};

function managedEnvelope(event: WireSessionEvent, context: AgentEventContext) {
  return agentEventEnvelope(
    {
      ...context,
      sessionThreadId: context.sessionThreadId ?? eventThreadId(event),
    },
    MANAGED_SOURCE,
  );
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringField(event: WireSessionEvent, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = event[name];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

export function managedEventToOpenMA(
  event: WireSessionEvent,
  context: AgentEventContext,
): OpenMAEvent {
  const envelope = managedEnvelope(event, context);

  if (event.type === "agent.tool_use" && event.evaluated_permission === "ask") {
    const callbackId = stringField(event, "id", "tool_use_id") ?? context.eventId;
    const method = "tool/permission";
    const params = {
      tool_name: stringField(event, "name", "tool_name") ?? "tool",
      input: event.input ?? {},
    };
    const data: CallbackLifecycleData = {
      callback_id: callbackId,
      fingerprint: callbackFingerprint(
        context,
        "permission",
        method,
        callbackId,
        params,
      ),
      method,
      category: "permission",
      params,
    };
    return createOpenMAEvent({
      ...envelope,
      type: "callback.requested",
      data,
    });
  }

  if (event.type === "user.tool_confirmation") {
    const callbackId = stringField(event, "tool_use_id", "id") ?? context.eventId;
    const method = "tool/permission";
    const denied = event.result === "deny";
    const data: CallbackLifecycleData = {
      callback_id: callbackId,
      method,
      category: "permission",
      result: {
        outcome: denied ? "deny" : "allow",
        ...(denied && typeof event.deny_message === "string"
          ? { message: event.deny_message }
          : {}),
      },
    };
    return createOpenMAEvent({
      ...envelope,
      type: "callback.completed",
      data,
    });
  }

  if (event.type === "agent.custom_tool_use") {
    const callbackId = stringField(event, "id", "tool_use_id") ?? context.eventId;
    const toolName = stringField(event, "name", "tool_name") ?? "custom";
    const method = "tool/custom";
    const params = { tool_name: toolName, input: event.input ?? {} };
    const data: CallbackLifecycleData = {
      callback_id: callbackId,
      fingerprint: callbackFingerprint(
        context,
        "extension",
        method,
        callbackId,
        params,
      ),
      method,
      category: "extension",
      params,
    };
    return createOpenMAEvent({
      ...envelope,
      type: "callback.requested",
      data,
    });
  }

  if (event.type === "user.custom_tool_result") {
    const callbackId = stringField(
      event,
      "custom_tool_use_id",
      "tool_use_id",
      "id",
    ) ?? context.eventId;
    const failed = event.is_error === true;
    const data: CallbackLifecycleData = {
      callback_id: callbackId,
      method: "tool/custom",
      category: "extension",
      ...(failed
        ? { error: event.content ?? "Custom tool failed" }
        : { result: event.content ?? null }),
    };
    return createOpenMAEvent({
      ...envelope,
      type: failed ? "callback.failed" : "callback.completed",
      data,
    });
  }

  if (event.type === "user.interrupt") {
    return createOpenMAEvent({
      ...envelope,
      type: "turn.interrupted",
      data: { reason: "user_interrupt" },
    });
  }

  if (event.type === "session.status_rescheduled") {
    return createOpenMAEvent({
      ...envelope,
      type: "turn.queued",
      data: {
        ...(typeof event.reason === "string" ? { reason: event.reason } : {}),
      },
    });
  }

  const normalized = normalizeSessionEvent(event);

  switch (normalized.kind) {
    case "user_message":
      return createOpenMAEvent({
        ...envelope,
        type: "user.message",
        data: { text: normalized.text, message_id: normalized.id },
      });
    case "assistant_delta":
      return createOpenMAEvent({
        ...envelope,
        type: "agent.message_chunk",
        data: { text: normalized.text, message_id: normalized.id },
      });
    case "assistant_message":
      return createOpenMAEvent({
        ...envelope,
        type: "agent.message",
        data: { text: normalized.text, message_id: normalized.id },
      });
    case "thinking_delta":
    case "thinking":
      return createOpenMAEvent({
        ...envelope,
        type: "agent.thinking",
        data: { text: normalized.text, message_id: normalized.id },
      });
    case "tool_input_start":
      return createOpenMAEvent({
        ...envelope,
        type: "tool.started",
        data: {
          tool_call_id: normalized.toolId,
          tool_name: normalized.name,
          status: "pending",
        } satisfies ToolLifecycleData,
      });
    case "tool_use":
      return createOpenMAEvent({
        ...envelope,
        type: "tool.started",
        data: {
          tool_call_id: normalized.tool.id,
          tool_name: normalized.tool.name,
          status: "in_progress",
          raw_input: normalized.tool.input,
        } satisfies ToolLifecycleData,
      });
    case "tool_result":
      return createOpenMAEvent({
        ...envelope,
        type: normalized.isError ? "tool.failed" : "tool.completed",
        data: {
          tool_call_id: normalized.toolId,
          status: normalized.isError ? "failed" : "completed",
          raw_output: normalized.output,
        } satisfies ToolLifecycleData,
      });
    case "notice":
      return createOpenMAEvent({
        ...envelope,
        type: normalized.tone === "error" ? "session.error" : "system.notice",
        data: {
          message: normalized.message,
          tone: normalized.tone,
          ...(normalized.source ? { source: normalized.source } : {}),
        },
      });
    case "turn_running":
      return createOpenMAEvent({ ...envelope, type: "turn.started", data: {} });
    case "turn_complete": {
      const stopReason = stringField(
        objectRecord(event.stop_reason) as WireSessionEvent,
        "type",
      );
      const type = stopReason === "retries_exhausted"
        ? "turn.failed" as const
        : stopReason === "cancelled"
          ? "turn.cancelled" as const
          : stopReason === "interrupted"
            ? "turn.interrupted" as const
            : "turn.completed" as const;
      return createOpenMAEvent({
        ...envelope,
        type,
        data: {
          ...(stopReason ? { stop_reason: stopReason } : {}),
          ...(Array.isArray(objectRecord(event.stop_reason).event_ids)
            ? { callback_ids: objectRecord(event.stop_reason).event_ids }
            : {}),
        },
      });
    }
    case "turn_terminated":
      return createOpenMAEvent({ ...envelope, type: "session.terminated", data: {} });
    case "assistant_stream_end":
    case "thinking_stream_end":
      return createVendorEvent({
        ...envelope,
        harness: "claude-managed",
        namespace: "claudeManaged",
        name: event.type,
        correlation: {
          session_id: context.sessionId,
          ...(context.turnId ? { turn_id: context.turnId } : {}),
        },
        data: event,
      });
    case "ignore":
      return createVendorEvent({
        ...envelope,
        harness: "claude-managed",
        namespace: "claudeManaged",
        name: event.type || "unknown",
        correlation: {
          session_id: context.sessionId,
          ...(context.turnId ? { turn_id: context.turnId } : {}),
          ...(context.workItemId ? { work_item_id: context.workItemId } : {}),
        },
        data: event,
      });
  }
}
