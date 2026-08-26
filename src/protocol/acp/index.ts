import type {
  AgentNotification,
  AgentRequest,
  AgentResponse,
  ClientNotification,
  ClientRequest,
  ClientResponse,
  ContentBlock,
  RequestId,
  RequestPermissionRequest,
  PromptResponse,
  SessionNotification,
} from "@agentclientprotocol/sdk";

import {
  createOpenMAEvent,
  createRawEvent,
  createVendorEvent,
  type OpenMAEvent,
} from "../../session-events/openma.js";

export type AcpSessionNotification = SessionNotification;
export type AcpEventMappingFidelity = "exact" | "lossy" | "unsupported";

export interface AcpEventMappingDiagnostic {
  code: string;
  message: string;
}

export interface AcpDecodeContext {
  /** Stable identity assigned at the ACP transport boundary. */
  eventId: string;
  /** Observation time assigned at the ACP transport boundary. */
  occurredAt: string;
  ingestedAt?: string;
  turnId?: string;
  seq?: number;
}

export interface AcpRequestDecodeContext extends AcpDecodeContext {
  sessionId: string;
}

export interface AcpResponseDecodeContext extends AcpRequestDecodeContext {
  method: string;
}

export interface AcpDecodeResult {
  fidelity: AcpEventMappingFidelity;
  event: OpenMAEvent;
  diagnostics: AcpEventMappingDiagnostic[];
}

export interface AcpEncodeContext {
  requestId?: RequestId;
}

export interface AcpEncodeResult {
  fidelity: AcpEventMappingFidelity;
  message?: ClientRequest | ClientNotification | ClientResponse;
  diagnostics: AcpEventMappingDiagnostic[];
}

const source = {
  kind: "harness" as const,
  harness: "acp",
  adapter: "acp-events",
};

function textFromContent(content: ContentBlock): string | undefined {
  return content.type === "text" ? content.text : undefined;
}

function isAcpContentBlock(value: unknown): value is ContentBlock {
  if (!value || typeof value !== "object") return false;
  const block = value as Record<string, unknown>;
  if (block.type === "text") return typeof block.text === "string";
  if (block.type === "image" || block.type === "audio") {
    return typeof block.data === "string" && typeof block.mimeType === "string";
  }
  if (block.type === "resource_link") {
    return typeof block.name === "string" && typeof block.uri === "string";
  }
  if (block.type === "resource") {
    return !!block.resource && typeof block.resource === "object";
  }
  return false;
}

function callbackCategory(method: string) {
  if (method === "session/request_permission") return "permission" as const;
  if (method.startsWith("fs/")) return "filesystem" as const;
  if (method.startsWith("terminal/")) return "terminal" as const;
  if (method.startsWith("elicitation/")) return "elicitation" as const;
  if (method.startsWith("mcp/")) return "mcp" as const;
  return "extension" as const;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isPermissionRequest(value: unknown): value is RequestPermissionRequest {
  if (!isRecord(value) || typeof value.sessionId !== "string") return false;
  if (!isRecord(value.toolCall) || typeof value.toolCall.toolCallId !== "string") {
    return false;
  }
  return Array.isArray(value.options);
}

export function decodeAcpAgentRequest(
  request: AgentRequest,
  context: AcpRequestDecodeContext,
): AcpDecodeResult {
  if (
    request.method === "session/request_permission"
    && !isPermissionRequest(request.params)
  ) {
    return {
      fidelity: "unsupported",
      diagnostics: [{
        code: "acp_callback_malformed",
        message: "Malformed ACP callback request: session/request_permission",
      }],
      event: createRawEvent({
        event_id: context.eventId,
        session_id: context.sessionId,
        ...(context.turnId ? { turn_id: context.turnId } : {}),
        source,
        occurred_at: context.occurredAt,
        ...(context.ingestedAt ? { ingested_at: context.ingestedAt } : {}),
        ...(context.seq !== undefined ? { seq: context.seq } : {}),
        source_kind: "acp",
        method: request.method,
        payload: request,
        received_at: context.ingestedAt ?? context.occurredAt,
        reason: "malformed",
      }),
    };
  }
  const permission = request.method === "session/request_permission"
    ? request.params as RequestPermissionRequest
    : undefined;
  return {
    fidelity: "exact",
    diagnostics: [],
    event: createOpenMAEvent({
      event_id: context.eventId,
      type: "callback.requested",
      session_id: context.sessionId,
      ...(context.turnId ? { turn_id: context.turnId } : {}),
      ...(permission?.toolCall.toolCallId
        ? { work_item_id: permission.toolCall.toolCallId }
        : {}),
      source,
      occurred_at: context.occurredAt,
      ...(context.ingestedAt ? { ingested_at: context.ingestedAt } : {}),
      ...(context.seq !== undefined ? { seq: context.seq } : {}),
      data: {
        callback_id: request.id,
        method: request.method,
        category: callbackCategory(request.method),
        ...(request.params !== undefined ? { params: request.params } : {}),
      },
    }),
  };
}

export function decodeAcpAgentNotification(
  notification: AgentNotification,
  context: AcpRequestDecodeContext,
): AcpDecodeResult {
  if (notification.method === "session/update") {
    const params = notification.params;
    if (
      !isRecord(params)
      || typeof params.sessionId !== "string"
      || !isRecord(params.update)
      || typeof params.update.sessionUpdate !== "string"
      || params.sessionId !== context.sessionId
    ) {
      return {
        fidelity: "unsupported",
        diagnostics: [{
          code: "acp_session_notification_malformed",
          message: "Malformed or cross-session ACP session/update notification",
        }],
        event: createRawEvent({
          event_id: context.eventId,
          session_id: context.sessionId,
          ...(context.turnId ? { turn_id: context.turnId } : {}),
          source,
          occurred_at: context.occurredAt,
          ...(context.ingestedAt ? { ingested_at: context.ingestedAt } : {}),
          ...(context.seq !== undefined ? { seq: context.seq } : {}),
          source_kind: "acp",
          method: notification.method,
          payload: notification,
          received_at: context.ingestedAt ?? context.occurredAt,
          reason: "malformed",
        }),
      };
    }
    return decodeAcpSessionNotification(
      params as unknown as SessionNotification,
      context,
    );
  }

  return {
    fidelity: "exact",
    diagnostics: [],
    event: createOpenMAEvent({
      event_id: context.eventId,
      type: "callback.notification",
      session_id: context.sessionId,
      ...(context.turnId ? { turn_id: context.turnId } : {}),
      source,
      occurred_at: context.occurredAt,
      ...(context.ingestedAt ? { ingested_at: context.ingestedAt } : {}),
      ...(context.seq !== undefined ? { seq: context.seq } : {}),
      data: {
        method: notification.method,
        category: callbackCategory(notification.method),
        ...(notification.params !== undefined
          ? { params: notification.params }
          : {}),
      },
    }),
  };
}

export function decodeAcpClientResponse(
  response: ClientResponse,
  context: AcpResponseDecodeContext,
): AcpDecodeResult {
  const failed = "error" in response;
  return {
    fidelity: "exact",
    diagnostics: [],
    event: createOpenMAEvent({
      event_id: context.eventId,
      type: failed ? "callback.failed" : "callback.completed",
      session_id: context.sessionId,
      ...(context.turnId ? { turn_id: context.turnId } : {}),
      source,
      occurred_at: context.occurredAt,
      ...(context.ingestedAt ? { ingested_at: context.ingestedAt } : {}),
      ...(context.seq !== undefined ? { seq: context.seq } : {}),
      data: {
        callback_id: response.id,
        method: context.method,
        category: callbackCategory(context.method),
        ...(failed ? { error: response.error } : { result: response.result }),
      },
    }),
  };
}

export function decodeAcpAgentResponse(
  response: AgentResponse,
  context: AcpResponseDecodeContext,
): AcpDecodeResult {
  if (context.method !== "session/prompt") {
    return {
      fidelity: "exact",
      diagnostics: [],
      event: createVendorEvent({
        event_id: context.eventId,
        session_id: context.sessionId,
        ...(context.turnId ? { turn_id: context.turnId } : {}),
        source,
        occurred_at: context.occurredAt,
        ...(context.ingestedAt ? { ingested_at: context.ingestedAt } : {}),
        ...(context.seq !== undefined ? { seq: context.seq } : {}),
        harness: "acp",
        namespace: "response",
        name: context.method,
        data: response,
      }),
    };
  }

  if (!context.turnId) {
    return {
      fidelity: "unsupported",
      diagnostics: [{
        code: "acp_turn_id_required",
        message: "ACP session/prompt response requires its adapter-assigned turn id",
      }],
      event: createRawEvent({
        event_id: context.eventId,
        session_id: context.sessionId,
        source,
        occurred_at: context.occurredAt,
        ...(context.ingestedAt ? { ingested_at: context.ingestedAt } : {}),
        ...(context.seq !== undefined ? { seq: context.seq } : {}),
        source_kind: "acp",
        method: context.method,
        payload: response,
        received_at: context.ingestedAt ?? context.occurredAt,
        reason: "malformed",
      }),
    };
  }

  if ("error" in response) {
    return {
      fidelity: "exact",
      diagnostics: [],
      event: createOpenMAEvent({
        event_id: context.eventId,
        type: "turn.failed",
        session_id: context.sessionId,
        turn_id: context.turnId,
        source,
        occurred_at: context.occurredAt,
        ...(context.ingestedAt ? { ingested_at: context.ingestedAt } : {}),
        ...(context.seq !== undefined ? { seq: context.seq } : {}),
        data: { request_id: response.id, error: response.error },
      }),
    };
  }

  const result = response.result as PromptResponse;
  const type = result.stopReason === "cancelled"
    ? "turn.cancelled"
    : "turn.completed";
  return {
    fidelity: "exact",
    diagnostics: [],
    event: createOpenMAEvent({
      event_id: context.eventId,
      type,
      session_id: context.sessionId,
      turn_id: context.turnId,
      source,
      occurred_at: context.occurredAt,
      ...(context.ingestedAt ? { ingested_at: context.ingestedAt } : {}),
      ...(context.seq !== undefined ? { seq: context.seq } : {}),
      data: {
        request_id: response.id,
        stop_reason: result.stopReason,
        ...(result.usage ? { usage: result.usage } : {}),
        ...(result._meta ? { adapter_meta: { acp_meta: result._meta } } : {}),
      },
    }),
  };
}

export function encodeAcpInput(
  event: OpenMAEvent,
  context: AcpEncodeContext = {},
): AcpEncodeResult {
  if (event.type === "user.interrupt") {
    return {
      fidelity: "exact",
      diagnostics: [],
      message: {
        method: "session/cancel",
        params: { sessionId: event.session_id },
      },
    };
  }

  if (event.type === "user.permission_response") {
    const data = event.data as {
      callback_id?: RequestId;
      decision?: string;
      option_id?: string;
    };
    if (data.callback_id === undefined) {
      return {
        fidelity: "unsupported",
        diagnostics: [{
          code: "acp_callback_id_required",
          message: "ACP permission response requires the original JSON-RPC callback id",
        }],
      };
    }
    if (data.decision === "cancel" || data.decision === "cancelled") {
      return {
        fidelity: "exact",
        diagnostics: [],
        message: {
          id: data.callback_id,
          result: { outcome: { outcome: "cancelled" } },
        },
      };
    }
    if (typeof data.option_id !== "string" || data.option_id.length === 0) {
      return {
        fidelity: "unsupported",
        diagnostics: [{
          code: "acp_permission_option_required",
          message: "ACP selected permission response requires an exact option_id",
        }],
      };
    }
    return {
      fidelity: "exact",
      diagnostics: [],
      message: {
        id: data.callback_id,
        result: {
          outcome: {
            outcome: "selected",
            optionId: data.option_id,
          },
        },
      },
    };
  }

  if (event.type !== "user.message") {
    return {
      fidelity: "unsupported",
      diagnostics: [{
        code: "acp_input_unsupported",
        message: `OpenMA event cannot be sent to ACP: ${event.type}`,
      }],
    };
  }

  if (context.requestId === undefined) {
    return {
      fidelity: "unsupported",
      diagnostics: [{
        code: "acp_request_id_required",
        message: "ACP session/prompt requires an explicit JSON-RPC request id",
      }],
    };
  }

  const data = event.data as { text?: string; content?: unknown };
  const content = Array.isArray(data.content)
    && data.content.every(isAcpContentBlock)
    ? data.content
    : undefined;
  if (content) {
    return {
      fidelity: "exact",
      diagnostics: [],
      message: {
        id: context.requestId,
        method: "session/prompt",
        params: {
          sessionId: event.session_id,
          prompt: content,
        },
      },
    };
  }

  if (typeof data.text === "string") {
    return {
      fidelity: data.content === undefined ? "exact" : "lossy",
      diagnostics: data.content === undefined
        ? []
        : [{
            code: "acp_message_content_lossy",
            message: "Non-ACP content was reduced to its text projection",
          }],
      message: {
        id: context.requestId,
        method: "session/prompt",
        params: {
          sessionId: event.session_id,
          prompt: [{ type: "text", text: data.text }],
        },
      },
    };
  }

  return {
    fidelity: "unsupported",
    diagnostics: [{
      code: "acp_message_content_unsupported",
      message: "OpenMA user.message has no ACP-compatible prompt content",
    }],
  };
}

export function decodeAcpSessionNotification(
  notification: AcpSessionNotification,
  context: AcpDecodeContext,
): AcpDecodeResult {
  const { update } = notification;
  const envelope = {
    event_id: context.eventId,
    session_id: notification.sessionId,
    ...(context.turnId ? { turn_id: context.turnId } : {}),
    source,
    occurred_at: context.occurredAt,
    ...(context.ingestedAt ? { ingested_at: context.ingestedAt } : {}),
    ...(context.seq !== undefined ? { seq: context.seq } : {}),
  };

  if (update.sessionUpdate === "agent_message_chunk") {
    return {
      fidelity: "exact",
      diagnostics: [],
      event: createOpenMAEvent({
        ...envelope,
        type: "agent.message_chunk",
        data: {
          ...(update.messageId ? { message_id: update.messageId } : {}),
          ...(textFromContent(update.content) !== undefined
            ? { text: textFromContent(update.content) }
            : {}),
          content: update.content,
        },
      }),
    };
  }

  if (update.sessionUpdate === "user_message_chunk") {
    return {
      fidelity: "exact",
      diagnostics: [],
      event: createOpenMAEvent({
        ...envelope,
        source: { ...source, kind: "user" },
        type: "user.message_chunk",
        data: {
          ...(update.messageId ? { message_id: update.messageId } : {}),
          ...(textFromContent(update.content) !== undefined
            ? { text: textFromContent(update.content) }
            : {}),
          content: update.content,
        },
      }),
    };
  }

  if (update.sessionUpdate === "agent_thought_chunk") {
    return {
      fidelity: "exact",
      diagnostics: [],
      event: createOpenMAEvent({
        ...envelope,
        type: "agent.thinking",
        data: {
          ...(update.messageId ? { message_id: update.messageId } : {}),
          ...(textFromContent(update.content) !== undefined
            ? { text: textFromContent(update.content) }
            : {}),
          content: update.content,
        },
      }),
    };
  }

  if (update.sessionUpdate === "tool_call") {
    const eventType = update.status === "completed"
      ? "tool.completed"
      : update.status === "failed"
        ? "tool.failed"
        : "tool.started";
    return {
      fidelity: "exact",
      diagnostics: [],
      event: createOpenMAEvent({
        ...envelope,
        type: eventType,
        work_item_id: update.toolCallId,
        data: {
          tool_call_id: update.toolCallId,
          title: update.title,
          ...(update.name ? { tool_name: update.name } : {}),
          ...(update.kind ? { kind: update.kind } : {}),
          ...(update.status ? { status: update.status } : {}),
          ...(update.rawInput !== undefined ? { raw_input: update.rawInput } : {}),
          ...(update.rawOutput !== undefined ? { raw_output: update.rawOutput } : {}),
          ...(update.content ? { content: update.content } : {}),
          ...(update.locations
            ? {
                locations: update.locations.map((location) => ({
                  path: location.path,
                  ...(location.line !== undefined && location.line !== null
                    ? { line: location.line }
                    : {}),
                })),
              }
            : {}),
          ...(update._meta
            ? { adapter_meta: { acp_meta: update._meta } }
            : {}),
        },
      }),
    };
  }

  if (update.sessionUpdate === "tool_call_update") {
    const eventType = update.status === "completed"
      ? "tool.completed"
      : update.status === "failed"
        ? "tool.failed"
        : "tool.progress";
    return {
      fidelity: "exact",
      diagnostics: [],
      event: createOpenMAEvent({
        ...envelope,
        type: eventType,
        work_item_id: update.toolCallId,
        data: {
          tool_call_id: update.toolCallId,
          ...(update.title ? { title: update.title } : {}),
          ...(update.name ? { tool_name: update.name } : {}),
          ...(update.kind ? { kind: update.kind } : {}),
          ...(update.status ? { status: update.status } : {}),
          ...(update.rawInput !== undefined ? { raw_input: update.rawInput } : {}),
          ...(update.rawOutput !== undefined ? { raw_output: update.rawOutput } : {}),
          ...(update.content ? { content: update.content } : {}),
          ...(update.locations
            ? {
                locations: update.locations.map((location) => ({
                  path: location.path,
                  ...(location.line !== undefined && location.line !== null
                    ? { line: location.line }
                    : {}),
                })),
              }
            : {}),
          ...(update._meta
            ? { adapter_meta: { acp_meta: update._meta } }
            : {}),
        },
      }),
    };
  }

  if (update.sessionUpdate === "plan") {
    return {
      fidelity: "exact",
      diagnostics: [],
      event: createOpenMAEvent({
        ...envelope,
        type: "plan.updated",
        data: {
          representation: "items",
          update_mode: "replace",
          entries: update.entries.map((entry) => ({
            content: entry.content,
            priority: entry.priority,
            status: entry.status,
            ...(entry._meta
              ? { adapter_meta: { acp_meta: entry._meta } }
              : {}),
          })),
          ...(update._meta
            ? { adapter_meta: { acp_meta: update._meta } }
            : {}),
        },
      }),
    };
  }

  if (update.sessionUpdate === "plan_update") {
    const { plan } = update;
    const data = plan.type === "items"
      ? {
          representation: "items" as const,
          plan_id: plan.planId,
          update_mode: "replace" as const,
          entries: plan.entries.map((entry) => ({
            content: entry.content,
            priority: entry.priority,
            status: entry.status,
            ...(entry._meta
              ? { adapter_meta: { acp_meta: entry._meta } }
              : {}),
          })),
        }
      : plan.type === "markdown"
        ? {
            representation: "markdown" as const,
            plan_id: plan.planId,
            update_mode: "replace" as const,
            document: { id: plan.planId, markdown: plan.content },
          }
        : {
            representation: "file" as const,
            plan_id: plan.planId,
            update_mode: "replace" as const,
            document: { id: plan.planId, uri: plan.uri },
          };
    return {
      fidelity: "exact",
      diagnostics: [],
      event: createOpenMAEvent({
        ...envelope,
        type: "plan.updated",
        data: {
          ...data,
          ...(update._meta || plan._meta
            ? {
                adapter_meta: {
                  ...(update._meta ? { acp_meta: update._meta } : {}),
                  ...(plan._meta ? { acp_plan_meta: plan._meta } : {}),
                },
              }
            : {}),
        },
      }),
    };
  }

  if (update.sessionUpdate === "plan_removed") {
    return {
      fidelity: "exact",
      diagnostics: [],
      event: createOpenMAEvent({
        ...envelope,
        type: "plan.removed",
        data: {
          plan_id: update.planId,
          ...(update._meta
            ? { adapter_meta: { acp_meta: update._meta } }
            : {}),
        },
      }),
    };
  }

  if (update.sessionUpdate === "available_commands_update") {
    return {
      fidelity: "exact",
      diagnostics: [],
      event: createOpenMAEvent({
        ...envelope,
        type: "command_catalog.updated",
        data: {
          commands: update.availableCommands,
          ...(update._meta
            ? { adapter_meta: { acp_meta: update._meta } }
            : {}),
        },
      }),
    };
  }

  if (update.sessionUpdate === "usage_update") {
    return {
      fidelity: "exact",
      diagnostics: [],
      event: createOpenMAEvent({
        ...envelope,
        type: "usage.updated",
        data: {
          usage: {
            used: update.used,
            size: update.size,
            ...(update.cost ? { cost: update.cost } : {}),
          },
          ...(update._meta
            ? { adapter_meta: { acp_meta: update._meta } }
            : {}),
        },
      }),
    };
  }

  if (update.sessionUpdate === "current_mode_update") {
    return {
      fidelity: "exact",
      diagnostics: [],
      event: createOpenMAEvent({
        ...envelope,
        type: "capability.updated",
        data: {
          capability: "session.mode",
          value: { current_mode_id: update.currentModeId },
          ...(update._meta
            ? { adapter_meta: { acp_meta: update._meta } }
            : {}),
        },
      }),
    };
  }

  if (update.sessionUpdate === "config_option_update") {
    return {
      fidelity: "exact",
      diagnostics: [],
      event: createOpenMAEvent({
        ...envelope,
        type: "capability.updated",
        data: {
          capability: "session.config_options",
          value: update.configOptions,
          ...(update._meta
            ? { adapter_meta: { acp_meta: update._meta } }
            : {}),
        },
      }),
    };
  }

  if (update.sessionUpdate === "session_info_update") {
    return {
      fidelity: "exact",
      diagnostics: [],
      event: createOpenMAEvent({
        ...envelope,
        type: "session.updated",
        data: {
          ...("title" in update ? { title: update.title } : {}),
          ...("updatedAt" in update ? { updated_at: update.updatedAt } : {}),
          ...(update._meta
            ? { adapter_meta: { acp_meta: update._meta } }
            : {}),
        },
      }),
    };
  }

  const futureUpdate = update as { sessionUpdate?: string };
  const eventType = futureUpdate.sessionUpdate ?? "unknown";
  return {
    fidelity: "unsupported",
    diagnostics: [{
      code: "acp_session_update_unsupported",
      message: `Unsupported ACP session update: ${eventType}`,
    }],
    event: createRawEvent({
      ...envelope,
      source_kind: "acp",
      method: "session/update",
      event_type: eventType,
      payload: notification,
      received_at: context.ingestedAt ?? context.occurredAt,
      reason: "unsupported",
    }),
  };
}
