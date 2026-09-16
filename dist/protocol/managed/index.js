import { createOpenMAEvent, createRawEvent, createVendorEvent, } from "../../session-events/openma.js";
const MANAGED_EVENT_SOURCE = {
    kind: "harness",
    harness: "managed-agents",
    adapter: "managed-events",
};
/** Compile-time inventory of the official SDK union. A new SDK discriminant
 * must be classified deliberately before this package typechecks. */
const MANAGED_EVENT_MAPPING_STRATEGIES = {
    "agent.custom_tool_use": "canonical",
    "agent.mcp_tool_result": "canonical",
    "agent.mcp_tool_use": "canonical",
    "agent.message": "canonical",
    "agent.thinking": "canonical",
    "agent.thread_context_compacted": "vendor",
    "agent.thread_message_received": "vendor",
    "agent.thread_message_sent": "vendor",
    "agent.tool_result": "canonical",
    "agent.tool_use": "canonical",
    "session.deleted": "vendor",
    "session.error": "canonical",
    "session.status_idle": "canonical",
    "session.status_rescheduled": "canonical",
    "session.status_running": "canonical",
    "session.status_terminated": "canonical",
    "session.thread_created": "vendor",
    "session.thread_status_idle": "vendor",
    "session.thread_status_rescheduled": "vendor",
    "session.thread_status_running": "vendor",
    "session.thread_status_terminated": "vendor",
    "session.updated": "canonical",
    "session.usage": "canonical",
    "span.model_request_end": "vendor",
    "span.model_request_start": "vendor",
    "span.outcome_evaluation_end": "canonical",
    "span.outcome_evaluation_ongoing": "canonical",
    "span.outcome_evaluation_start": "canonical",
    "system.message": "canonical",
    "user.custom_tool_result": "canonical",
    "user.define_outcome": "canonical",
    "user.interrupt": "canonical",
    "user.message": "canonical",
    "user.tool_confirmation": "canonical",
    "user.tool_result": "canonical",
};
const KNOWN_MANAGED_VENDOR_EVENT_TYPES = new Set(Object.entries(MANAGED_EVENT_MAPPING_STRATEGIES)
    .filter(([, strategy]) => strategy === "vendor")
    .map(([type]) => type));
function managedEventEnvelope(event, context) {
    const sessionThreadId = typeof event.session_thread_id === "string"
        ? event.session_thread_id
        : undefined;
    return {
        event_id: event.id,
        session_id: context.sessionId,
        ...(sessionThreadId ? { session_thread_id: sessionThreadId } : {}),
        ...(context.turnId ? { turn_id: context.turnId } : {}),
        source: MANAGED_EVENT_SOURCE,
        occurred_at: typeof event.processed_at === "string"
            ? event.processed_at
            : context.ingestedAt,
        ...(context.ingestedAt ? { ingested_at: context.ingestedAt } : {}),
        ...(context.seq !== undefined ? { seq: context.seq } : {}),
    };
}
function managedContentText(content) {
    if (typeof content === "string")
        return content;
    if (!Array.isArray(content))
        return "";
    return content
        .map((block) => {
        if (!block || typeof block !== "object")
            return "";
        const value = block.text;
        return typeof value === "string" ? value : "";
    })
        .filter(Boolean)
        .join("\n");
}
export function decodeManagedSessionEvent(input, context) {
    const event = input;
    if (typeof event.id !== "string" || event.id.length === 0) {
        const eventId = `managed:${event.type}:${context.seq ?? "unsequenced"}`;
        const message = `Managed Agents event ${event.type} is missing required id`;
        return {
            fidelity: "unsupported",
            diagnostics: [{ code: "managed_event_malformed", message }],
            event: createRawEvent({
                ...managedEventEnvelope(event, context),
                event_id: eventId,
                source_kind: "adapter",
                event_type: event.type,
                payload: event,
                received_at: context.ingestedAt
                    ?? event.processed_at,
                reason: "malformed",
            }),
        };
    }
    if (event.type === "agent.tool_use"
        || event.type === "agent.custom_tool_use"
        || event.type === "agent.mcp_tool_use") {
        const id = event.id;
        const family = event.type === "agent.mcp_tool_use"
            ? "mcp"
            : event.type === "agent.custom_tool_use"
                ? "custom"
                : "builtin";
        return {
            fidelity: "exact",
            diagnostics: [],
            event: createOpenMAEvent({
                ...managedEventEnvelope(event, context),
                type: "tool.started",
                data: {
                    tool_call_id: id,
                    tool_name: event.name,
                    kind: family,
                    status: "in_progress",
                    raw_input: event.input,
                    adapter_meta: {
                        managed_event_type: event.type,
                        ...(typeof event.mcp_server_name === "string"
                            ? { mcp_server_name: event.mcp_server_name }
                            : {}),
                        ...(typeof event.evaluated_permission === "string"
                            ? { evaluated_permission: event.evaluated_permission }
                            : {}),
                    },
                },
            }),
        };
    }
    if (event.type === "agent.tool_result" || event.type === "agent.mcp_tool_result") {
        const content = event.content;
        const failed = event.is_error === true;
        const mcp = event.type === "agent.mcp_tool_result";
        return {
            fidelity: "exact",
            diagnostics: [],
            event: createOpenMAEvent({
                ...managedEventEnvelope(event, context),
                type: failed ? "tool.failed" : "tool.completed",
                data: {
                    tool_call_id: (mcp ? event.mcp_tool_use_id : event.tool_use_id),
                    status: failed ? "failed" : "completed",
                    raw_output: content,
                    content,
                    output: { kind: mcp ? "mcp" : "structured", data: content },
                    ...(failed ? { error: managedContentText(content) } : {}),
                    adapter_meta: {
                        is_error: failed,
                        managed_event_type: event.type,
                    },
                },
            }),
        };
    }
    if (event.type === "session.status_running") {
        return {
            fidelity: "exact",
            diagnostics: [],
            event: createOpenMAEvent({
                ...managedEventEnvelope(event, context),
                type: "session.running",
                data: {
                    adapter_meta: { managed_event_type: event.type },
                },
            }),
        };
    }
    if (event.type === "session.status_rescheduled") {
        return {
            fidelity: "exact",
            diagnostics: [],
            event: createOpenMAEvent({
                ...managedEventEnvelope(event, context),
                type: "session.rescheduled",
                data: {
                    adapter_meta: { managed_event_type: event.type },
                },
            }),
        };
    }
    if (event.type === "session.status_idle") {
        return {
            fidelity: "exact",
            diagnostics: [],
            event: createOpenMAEvent({
                ...managedEventEnvelope(event, context),
                type: "session.idle",
                data: {
                    stop_reason: event.stop_reason,
                    adapter_meta: { managed_event_type: event.type },
                },
            }),
        };
    }
    if (event.type === "session.status_terminated") {
        return {
            fidelity: "exact",
            diagnostics: [],
            event: createOpenMAEvent({
                ...managedEventEnvelope(event, context),
                type: "session.terminated",
                data: {
                    adapter_meta: { managed_event_type: event.type },
                },
            }),
        };
    }
    if (event.type === "session.error") {
        const error = event.error;
        return {
            fidelity: "exact",
            diagnostics: [],
            event: createOpenMAEvent({
                ...managedEventEnvelope(event, context),
                type: "session.error",
                data: {
                    message: error.message,
                    code: error.type,
                    retry_status: error.retry_status,
                    error,
                    adapter_meta: { managed_event_type: event.type },
                },
            }),
        };
    }
    if (event.type === "session.usage") {
        return {
            fidelity: "exact",
            diagnostics: [],
            event: createOpenMAEvent({
                ...managedEventEnvelope(event, context),
                type: "usage.updated",
                data: {
                    usage: event.usage,
                    ...(event.budget !== undefined ? { budget: event.budget } : {}),
                    adapter_meta: { managed_event_type: event.type },
                },
            }),
        };
    }
    if (event.type === "session.updated") {
        const updatedAt = event.processed_at;
        return {
            fidelity: "exact",
            diagnostics: [],
            event: createOpenMAEvent({
                ...managedEventEnvelope(event, context),
                type: "session.updated",
                data: {
                    ...(Object.prototype.hasOwnProperty.call(event, "title")
                        ? { title: event.title }
                        : {}),
                    ...(Object.prototype.hasOwnProperty.call(event, "metadata")
                        ? { metadata: event.metadata }
                        : {}),
                    ...(Object.prototype.hasOwnProperty.call(event, "budget")
                        ? { budget: event.budget }
                        : {}),
                    ...(Object.prototype.hasOwnProperty.call(event, "agent")
                        ? { agent: event.agent }
                        : {}),
                    updated_at: updatedAt,
                    adapter_meta: { managed_event_type: event.type },
                },
            }),
        };
    }
    if (event.type === "agent.message") {
        const id = event.id;
        const content = event.content;
        return {
            fidelity: "exact",
            diagnostics: [],
            event: createOpenMAEvent({
                ...managedEventEnvelope(event, context),
                type: "agent.message",
                data: {
                    message_id: id,
                    text: managedContentText(content),
                    content,
                },
            }),
        };
    }
    if (event.type === "agent.thinking") {
        const id = event.id;
        return {
            fidelity: "exact",
            diagnostics: [],
            event: createOpenMAEvent({
                ...managedEventEnvelope(event, context),
                type: "agent.thinking",
                data: {
                    message_id: id,
                    adapter_meta: {
                        managed_event_type: event.type,
                        progress_signal: true,
                    },
                },
            }),
        };
    }
    if (event.type === "system.message") {
        const id = event.id;
        const content = event.content;
        return {
            fidelity: "exact",
            diagnostics: [],
            event: createOpenMAEvent({
                ...managedEventEnvelope(event, context),
                type: "system.message",
                source: { ...MANAGED_EVENT_SOURCE, kind: "system" },
                data: {
                    message_id: id,
                    text: managedContentText(content),
                    content,
                },
            }),
        };
    }
    if (event.type === "user.tool_confirmation") {
        return {
            fidelity: "exact",
            diagnostics: [],
            event: createOpenMAEvent({
                ...managedEventEnvelope(event, context),
                type: "user.permission_response",
                source: { ...MANAGED_EVENT_SOURCE, kind: "user" },
                data: {
                    tool_call_id: event.tool_use_id,
                    decision: event.result,
                    ...(typeof event.deny_message === "string"
                        ? { message: event.deny_message }
                        : {}),
                    adapter_meta: { managed_event_type: event.type },
                },
            }),
        };
    }
    if (event.type === "user.custom_tool_result" || event.type === "user.tool_result") {
        const content = event.content;
        const failed = event.is_error === true;
        const custom = event.type === "user.custom_tool_result";
        return {
            fidelity: "exact",
            diagnostics: [],
            event: createOpenMAEvent({
                ...managedEventEnvelope(event, context),
                type: failed ? "tool.failed" : "tool.completed",
                source: { ...MANAGED_EVENT_SOURCE, kind: "user" },
                data: {
                    tool_call_id: (custom
                        ? event.custom_tool_use_id
                        : event.tool_use_id),
                    kind: custom ? "custom" : "builtin",
                    status: failed ? "failed" : "completed",
                    raw_output: content,
                    content,
                    output: { kind: "structured", data: content },
                    ...(failed ? { error: managedContentText(content) } : {}),
                    adapter_meta: {
                        is_error: failed,
                        managed_event_type: event.type,
                    },
                },
            }),
        };
    }
    if (event.type === "user.interrupt") {
        return {
            fidelity: "exact",
            diagnostics: [],
            event: createOpenMAEvent({
                ...managedEventEnvelope(event, context),
                type: "user.interrupt",
                source: { ...MANAGED_EVENT_SOURCE, kind: "user" },
                data: {
                    adapter_meta: { managed_event_type: event.type },
                },
            }),
        };
    }
    if (event.type === "user.define_outcome") {
        return {
            fidelity: "exact",
            diagnostics: [],
            event: createOpenMAEvent({
                ...managedEventEnvelope(event, context),
                type: "outcome.defined",
                source: { ...MANAGED_EVENT_SOURCE, kind: "user" },
                data: {
                    outcome_id: event.outcome_id,
                    description: event.description,
                    rubric: event.rubric,
                    max_iterations: event.max_iterations,
                    adapter_meta: { managed_event_type: event.type },
                },
            }),
        };
    }
    if (event.type === "span.outcome_evaluation_start"
        || event.type === "span.outcome_evaluation_ongoing"
        || event.type === "span.outcome_evaluation_end") {
        const canonicalType = event.type === "span.outcome_evaluation_start"
            ? "outcome.evaluation_started"
            : event.type === "span.outcome_evaluation_ongoing"
                ? "outcome.evaluation_progress"
                : "outcome.evaluation_completed";
        return {
            fidelity: "exact",
            diagnostics: [],
            event: createOpenMAEvent({
                ...managedEventEnvelope(event, context),
                type: canonicalType,
                data: {
                    outcome_id: event.outcome_id,
                    iteration: event.iteration,
                    ...(typeof event.outcome_evaluation_start_id === "string"
                        ? { outcome_evaluation_start_id: event.outcome_evaluation_start_id }
                        : {}),
                    ...(typeof event.result === "string" ? { result: event.result } : {}),
                    ...(typeof event.explanation === "string"
                        ? { explanation: event.explanation }
                        : {}),
                    ...(event.usage !== undefined ? { usage: event.usage } : {}),
                    adapter_meta: { managed_event_type: event.type },
                },
            }),
        };
    }
    if (KNOWN_MANAGED_VENDOR_EVENT_TYPES.has(event.type)) {
        return {
            fidelity: "exact",
            diagnostics: [],
            event: createVendorEvent({
                ...managedEventEnvelope(event, context),
                harness: "managed-agents",
                namespace: "session-events",
                name: event.type,
                correlation: {
                    session_id: context.sessionId,
                    ...(context.turnId ? { turn_id: context.turnId } : {}),
                },
                data: event,
            }),
        };
    }
    if (event.type !== "user.message") {
        const message = `Unsupported Managed Agents event type: ${event.type}`;
        const processedAt = event.processed_at;
        return {
            fidelity: "unsupported",
            diagnostics: [{ code: "managed_event_unsupported", message }],
            event: createRawEvent({
                ...managedEventEnvelope(event, context),
                source_kind: "adapter",
                event_type: event.type,
                payload: event,
                received_at: context.ingestedAt ?? processedAt,
                reason: "unsupported",
            }),
        };
    }
    const id = event.id;
    const content = event.content;
    const timestampMissing = typeof event.processed_at !== "string";
    return {
        fidelity: timestampMissing ? "lossy" : "exact",
        diagnostics: timestampMissing
            ? [{
                    code: "managed_event_timestamp_missing",
                    message: `Managed Agents event ${id} has no processed_at; used ingestedAt`,
                }]
            : [],
        event: createOpenMAEvent({
            ...managedEventEnvelope(event, context),
            type: "user.message",
            data: {
                message_id: id,
                text: managedContentText(content),
                content,
            },
        }),
    };
}
export function decodeManagedStreamEvent(input, context) {
    const event = input;
    if (event.type === "event_start") {
        const preview = event.event;
        return {
            fidelity: "exact",
            diagnostics: [],
            event: createVendorEvent({
                event_id: `${preview.id}:start`,
                session_id: context.sessionId,
                ...(context.turnId ? { turn_id: context.turnId } : {}),
                source: MANAGED_EVENT_SOURCE,
                occurred_at: context.ingestedAt,
                ...(context.ingestedAt ? { ingested_at: context.ingestedAt } : {}),
                ...(context.seq !== undefined ? { seq: context.seq } : {}),
                harness: "managed-agents",
                namespace: "stream",
                name: "event_start",
                correlation: {
                    session_id: context.sessionId,
                    ...(context.turnId ? { turn_id: context.turnId } : {}),
                },
                data: event,
            }),
        };
    }
    if (event.type !== "event_delta") {
        return decodeManagedSessionEvent(event, context);
    }
    const messageId = event.event_id;
    const delta = event.delta;
    return {
        fidelity: "exact",
        diagnostics: [],
        event: createOpenMAEvent({
            event_id: `${messageId}:delta:${context.seq ?? "unsequenced"}`,
            type: "agent.message_chunk",
            session_id: context.sessionId,
            ...(context.turnId ? { turn_id: context.turnId } : {}),
            source: MANAGED_EVENT_SOURCE,
            occurred_at: context.ingestedAt,
            ...(context.ingestedAt ? { ingested_at: context.ingestedAt } : {}),
            ...(context.seq !== undefined ? { seq: context.seq } : {}),
            data: {
                message_id: messageId,
                text: delta.content.text,
                content: delta.content,
                adapter_meta: {
                    managed_event_type: event.type,
                    delta_type: delta.type,
                    ...(delta.index !== undefined ? { index: delta.index } : {}),
                },
            },
        }),
    };
}
export function encodeManagedSessionInput(event) {
    if (event.type === "outcome.defined") {
        const data = event.data;
        return {
            fidelity: "exact",
            diagnostics: [],
            event: {
                type: "user.define_outcome",
                description: data.description,
                rubric: data.rubric,
                ...(data.max_iterations !== undefined
                    ? { max_iterations: data.max_iterations }
                    : {}),
            },
        };
    }
    if (event.type === "tool.completed" || event.type === "tool.failed") {
        const data = event.data;
        if (data.kind === "custom") {
            return {
                fidelity: "exact",
                diagnostics: [],
                event: {
                    type: "user.custom_tool_result",
                    custom_tool_use_id: data.tool_call_id,
                    content: data.content,
                    is_error: event.type === "tool.failed",
                },
            };
        }
        if (data.kind === "builtin") {
            return {
                fidelity: "exact",
                diagnostics: [],
                event: {
                    type: "user.tool_result",
                    tool_use_id: data.tool_call_id,
                    content: data.content,
                    is_error: event.type === "tool.failed",
                },
            };
        }
    }
    if (event.type === "user.interrupt") {
        return {
            fidelity: "exact",
            diagnostics: [],
            event: {
                type: "user.interrupt",
                ...(event.session_thread_id
                    ? { session_thread_id: event.session_thread_id }
                    : {}),
            },
        };
    }
    if (event.type === "user.permission_response") {
        const data = event.data;
        return {
            fidelity: "exact",
            diagnostics: [],
            event: {
                type: "user.tool_confirmation",
                tool_use_id: data.tool_call_id,
                result: data.decision,
                ...(data.message ? { deny_message: data.message } : {}),
            },
        };
    }
    if (event.type === "system.message") {
        const data = event.data;
        return {
            fidelity: "exact",
            diagnostics: [],
            event: {
                type: "system.message",
                content: data.content,
            },
        };
    }
    if (event.type !== "user.message") {
        return {
            fidelity: "unsupported",
            diagnostics: [{
                    code: "managed_input_unsupported",
                    message: `OpenMA event cannot be sent to Managed Agents: ${event.type}`,
                }],
        };
    }
    const data = event.data;
    return {
        fidelity: "exact",
        diagnostics: [],
        event: {
            type: "user.message",
            content: data.content,
        },
    };
}
export { sessionInputIdentityPrefix } from "./input-identity.js";
//# sourceMappingURL=index.js.map