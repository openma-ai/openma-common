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
import {
  parseAcpEvent as parseCommonAcpEvent,
  sessionUpdateInner,
  sessionUpdateType,
} from "../../session-events/acp.js";
import { splitAcpSystemNoticeText } from "../../session-events/acp-system-notices.js";

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
  /** Concrete ACP harness identity used by presentation policy. */
  harness?: string;
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

function sourceFor(context: AcpDecodeContext) {
  return context.harness ? { ...source, harness: context.harness } : source;
}

function adapterMeta(value: { _meta?: unknown }): Record<string, unknown> | undefined {
  return isRecord(value._meta) ? { ...value._meta } : undefined;
}

function messagePhase(value: { _meta?: unknown }): "commentary" | "final_answer" | undefined {
  if (!isRecord(value._meta) || !isRecord(value._meta.codex)) return undefined;
  const phase = value._meta.codex.phase;
  return phase === "commentary" || phase === "final_answer" ? phase : undefined;
}

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

function directAdapterMeta(input: unknown): Record<string, unknown> | undefined {
  const inner = sessionUpdateInner(input);
  return isRecord(inner._meta) ? inner._meta : undefined;
}

function parsedAcpEvent(
  sessionId: string,
  input: unknown,
  context: AcpDecodeContext,
): AcpDecodeResult | undefined {
  const parsed = parseCommonAcpEvent(input);
  const inner = sessionUpdateInner(input);
  const wireType = sessionUpdateType(input)
    ?? (typeof inner.type === "string" ? inner.type : undefined);
  const metadata = directAdapterMeta(input);
  const base = {
    event_id: context.eventId,
    session_id: sessionId,
    ...(context.turnId ? { turn_id: context.turnId } : {}),
    source: sourceFor(context),
    occurred_at: context.occurredAt,
    ...(context.ingestedAt ? { ingested_at: context.ingestedAt } : {}),
    ...(context.seq !== undefined ? { seq: context.seq } : {}),
  };
  const exact = (event: OpenMAEvent): AcpDecodeResult => ({
    fidelity: "exact",
    diagnostics: [],
    event,
  });

  const contentRecord = isRecord(inner.content) ? inner.content : undefined;
  const rawMessageText = typeof contentRecord?.text === "string"
    ? contentRecord.text
    : typeof inner.content === "string"
      ? inner.content
      : typeof inner.text === "string"
        ? inner.text
        : undefined;
  if (
    (wireType === "agent_message_chunk" || wireType === "agent.message_chunk")
    && rawMessageText
  ) {
    const split = splitAcpSystemNoticeText(rawMessageText);
    if (split.notice && split.transcript) {
      return exact(createOpenMAEvent({
        ...base,
        type: "agent.message_chunk",
        data: {
          text: split.transcript,
          ...(typeof inner.messageId === "string"
            ? { message_id: inner.messageId }
            : typeof inner.message_id === "string"
              ? { message_id: inner.message_id }
              : {}),
          ...(messagePhase(inner) ? { phase: messagePhase(inner) } : {}),
          ...(metadata ? { adapter_meta: metadata } : {}),
        },
      }));
    }
  }

  if (parsed.kind === "text") {
    const split = splitAcpSystemNoticeText(parsed.text);
    if (split.notice && !split.transcript) {
      return exact(createOpenMAEvent({
        ...base,
        type: "system.notice",
        data: {
          text: split.notice,
          tone: "warning",
          ...(metadata ? { adapter_meta: metadata } : {}),
        },
      }));
    }
    const text = split.transcript;
    if (!text) return undefined;
    const complete = wireType === "agent_message" || wireType === "agent.message";
    return exact(createOpenMAEvent({
      ...base,
      ...(parsed.parentToolUseId ? { parent_id: parsed.parentToolUseId } : {}),
      type: complete ? "agent.message" : "agent.message_chunk",
      data: {
        text,
        ...(parsed.messageId ? { message_id: parsed.messageId } : {}),
        ...(parsed.phase ? { phase: parsed.phase } : {}),
        ...(inner.content !== undefined ? { content: inner.content } : {}),
        ...(metadata ? { adapter_meta: metadata } : {}),
      },
    }));
  }

  if (parsed.kind === "thought") {
    return exact(createOpenMAEvent({
      ...base,
      ...(parsed.parentToolUseId ? { parent_id: parsed.parentToolUseId } : {}),
      type: "agent.thinking",
      data: {
        text: parsed.text,
        ...(parsed.messageId ? { message_id: parsed.messageId } : {}),
        ...(inner.content !== undefined ? { content: inner.content } : {}),
        ...(metadata ? { adapter_meta: metadata } : {}),
      },
    }));
  }

  if (parsed.kind === "notice") {
    return exact(createOpenMAEvent({
      ...base,
      type: "system.notice",
      data: {
        text: parsed.notice,
        tone: "warning",
        ...(metadata ? { adapter_meta: metadata } : {}),
      },
    }));
  }

  if (parsed.kind === "tool_call") {
    const status = parsed.tool.status?.toLowerCase();
    const type = status === "completed" || status === "complete"
      ? "tool.completed"
      : status === "failed" || status === "error"
        ? "tool.failed"
        : status === "cancelled" || status === "canceled"
          ? "tool.cancelled"
          : wireType === "tool_call_update"
            ? "tool.progress"
            : "tool.started";
    return exact(createOpenMAEvent({
      ...base,
      work_item_id: parsed.tool.toolCallId,
      ...(parsed.tool.parentToolUseId
        ? { parent_id: parsed.tool.parentToolUseId }
        : {}),
      type,
      data: {
        tool_call_id: parsed.tool.toolCallId,
        ...(parsed.tool.title ? { title: parsed.tool.title } : {}),
        ...(parsed.tool.kind ? { kind: parsed.tool.kind } : {}),
        ...(parsed.tool.status ? { status: parsed.tool.status } : {}),
        ...(parsed.tool.toolName ? { tool_name: parsed.tool.toolName } : {}),
        ...(parsed.tool.rawInput !== undefined
          ? { raw_input: parsed.tool.rawInput }
          : {}),
        ...(parsed.tool.rawOutput !== undefined
          ? { raw_output: parsed.tool.rawOutput }
          : {}),
        ...(parsed.tool.content ? { content: parsed.tool.content } : {}),
        ...(parsed.tool.locations ? { locations: parsed.tool.locations } : {}),
        ...(parsed.tool.meta ? { adapter_meta: parsed.tool.meta } : {}),
        ...(parsed.tool.outputDelta
          ? {
              output: {
                kind: "text",
                data: parsed.tool.outputDelta.data,
                append: true,
                separator: parsed.tool.outputDelta.separator,
              },
            }
          : {}),
      },
    }));
  }

  if (parsed.kind === "commands") {
    return exact(createOpenMAEvent({
      ...base,
      type: "command_catalog.updated",
      data: {
        commands: parsed.commands,
        ...(metadata ? { adapter_meta: metadata } : {}),
      },
    }));
  }

  if (parsed.kind === "plan") {
    return exact(createOpenMAEvent({
      ...base,
      type: "plan.updated",
      data: {
        representation: parsed.document?.markdown
          ? "markdown"
          : parsed.document?.uri
            ? "file"
            : "items",
        ...(parsed.planId ? { plan_id: parsed.planId } : {}),
        update_mode: parsed.updateMode ?? "replace",
        entries: parsed.plan,
        ...(parsed.document
          ? {
              document: {
                ...(parsed.document.id ? { id: parsed.document.id } : {}),
                ...(parsed.document.title ? { title: parsed.document.title } : {}),
                ...(parsed.document.markdown
                  ? { markdown: parsed.document.markdown }
                  : {}),
                ...(parsed.document.uri ? { uri: parsed.document.uri } : {}),
              },
            }
          : {}),
        ...(metadata ? { adapter_meta: metadata } : {}),
      },
    }));
  }

  if (parsed.kind === "plan_document" && parsed.document) {
    return exact(createOpenMAEvent({
      ...base,
      type: "plan.updated",
      data: {
        representation: parsed.document.uri ? "file" : "markdown",
        ...(parsed.document.id ? { plan_id: parsed.document.id } : {}),
        update_mode: "replace",
        document: {
          ...(parsed.document.id ? { id: parsed.document.id } : {}),
          ...(parsed.document.title ? { title: parsed.document.title } : {}),
          ...(parsed.document.markdown
            ? { markdown: parsed.document.markdown }
            : {}),
          ...(parsed.document.uri ? { uri: parsed.document.uri } : {}),
        },
        ...(metadata ? { adapter_meta: metadata } : {}),
      },
    }));
  }

  if (parsed.kind === "plan_removed") {
    return exact(createOpenMAEvent({
      ...base,
      type: "plan.removed",
      data: {
        ...(parsed.planId ? { plan_id: parsed.planId } : {}),
        ...(metadata ? { adapter_meta: metadata } : {}),
      },
    }));
  }

  if (parsed.kind === "note") {
    return exact(createOpenMAEvent({
      ...base,
      type: "system.message",
      data: { text: parsed.note },
    }));
  }
  return undefined;
}

function isOpenMAEvent(value: unknown): value is OpenMAEvent {
  if (!isRecord(value)) return false;
  return value.schema_version === "oma.event.v1"
    && typeof value.event_id === "string"
    && typeof value.type === "string"
    && typeof value.session_id === "string"
    && isRecord(value.source)
    && typeof value.source.kind === "string"
    && typeof value.occurred_at === "string"
    && Object.prototype.hasOwnProperty.call(value, "data");
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
        ...(result._meta ? { adapter_meta: result._meta } : {}),
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
    source: sourceFor(context),
    occurred_at: context.occurredAt,
    ...(context.ingestedAt ? { ingested_at: context.ingestedAt } : {}),
    ...(context.seq !== undefined ? { seq: context.seq } : {}),
  };

  if (update.sessionUpdate === "agent_message_chunk") {
    const phase = messagePhase(update);
    const metadata = adapterMeta(update);
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
          ...(phase ? { phase } : {}),
          ...(metadata ? { adapter_meta: metadata } : {}),
        },
      }),
    };
  }

  if (update.sessionUpdate === "user_message_chunk") {
    const metadata = adapterMeta(update);
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
          ...(metadata ? { adapter_meta: metadata } : {}),
        },
      }),
    };
  }

  if (update.sessionUpdate === "agent_thought_chunk") {
    const metadata = adapterMeta(update);
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
          ...(metadata ? { adapter_meta: metadata } : {}),
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
          ...(update._meta ? { adapter_meta: update._meta } : {}),
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
          ...(update._meta ? { adapter_meta: update._meta } : {}),
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
            ...(entry._meta ? { adapter_meta: entry._meta } : {}),
          })),
          ...(update._meta ? { adapter_meta: update._meta } : {}),
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
            ...(entry._meta ? { adapter_meta: entry._meta } : {}),
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
          ...(update._meta ? { adapter_meta: update._meta } : {}),
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
          ...(update._meta ? { adapter_meta: update._meta } : {}),
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
          ...(update._meta ? { adapter_meta: update._meta } : {}),
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
          ...(update._meta ? { adapter_meta: update._meta } : {}),
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
          ...(update._meta ? { adapter_meta: update._meta } : {}),
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
          ...(update._meta ? { adapter_meta: update._meta } : {}),
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
          ...(update._meta ? { adapter_meta: update._meta } : {}),
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

/**
 * ACP runtimes commonly expose the official SessionUpdate directly while the
 * SDK codec receives a SessionNotification envelope. This is the one boundary
 * adapter products use for both live transport and replay; canonical OpenMA
 * events pass through untouched.
 */
export function decodeAcpSessionUpdate(
  sessionId: string,
  input: unknown,
  context: AcpDecodeContext,
): AcpDecodeResult {
  if (isOpenMAEvent(input)) {
    if (input.session_id === sessionId) {
      return { fidelity: "exact", event: input, diagnostics: [] };
    }
    return {
      fidelity: "unsupported",
      diagnostics: [{
        code: "openma_session_mismatch",
        message: "Canonical event belongs to a different session",
      }],
      event: createRawEvent({
        event_id: context.eventId,
        session_id: sessionId,
        ...(context.turnId ? { turn_id: context.turnId } : {}),
        source: sourceFor(context),
        occurred_at: context.occurredAt,
        ...(context.ingestedAt ? { ingested_at: context.ingestedAt } : {}),
        ...(context.seq !== undefined ? { seq: context.seq } : {}),
        source_kind: "acp",
        method: "session/update",
        payload: input,
        received_at: context.ingestedAt ?? context.occurredAt,
        reason: "malformed",
      }),
    };
  }

  const outer = isRecord(input) && isRecord(input.update) ? input.update : input;
  if (!isRecord(outer)) {
    return {
      fidelity: "unsupported",
      diagnostics: [{
        code: "acp_session_update_malformed",
        message: "Malformed ACP session update",
      }],
      event: createRawEvent({
        event_id: context.eventId,
        session_id: sessionId,
        ...(context.turnId ? { turn_id: context.turnId } : {}),
        source: sourceFor(context),
        occurred_at: context.occurredAt,
        ...(context.ingestedAt ? { ingested_at: context.ingestedAt } : {}),
        ...(context.seq !== undefined ? { seq: context.seq } : {}),
        source_kind: "acp",
        method: "session/update",
        payload: input,
        received_at: context.ingestedAt ?? context.occurredAt,
        reason: "malformed",
      }),
    };
  }

  const parsed = parsedAcpEvent(sessionId, input, context);
  if (parsed) return parsed;

  const sessionUpdate = typeof outer.sessionUpdate === "string"
    ? outer.sessionUpdate
    : typeof outer.type === "string"
      ? outer.type
      : undefined;
  if (!sessionUpdate) {
    return {
      fidelity: "unsupported",
      diagnostics: [{
        code: "acp_session_update_malformed",
        message: "ACP session update has no discriminant",
      }],
      event: createRawEvent({
        event_id: context.eventId,
        session_id: sessionId,
        ...(context.turnId ? { turn_id: context.turnId } : {}),
        source: sourceFor(context),
        occurred_at: context.occurredAt,
        ...(context.ingestedAt ? { ingested_at: context.ingestedAt } : {}),
        ...(context.seq !== undefined ? { seq: context.seq } : {}),
        source_kind: "acp",
        method: "session/update",
        payload: input,
        received_at: context.ingestedAt ?? context.occurredAt,
        reason: "malformed",
      }),
    };
  }

  return decodeAcpSessionNotification(
    {
      sessionId,
      update: {
        ...outer,
        sessionUpdate,
      } as AcpSessionNotification["update"],
    },
    context,
  );
}
