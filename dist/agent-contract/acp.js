import { parseAcpEvent, sessionUpdateInner, sessionUpdateType, } from "../session-events/acp.js";
import { OPENMA_EVENT_SCHEMA_VERSION, createOpenMAEvent, createRawEvent, immutableJson, } from "../session-events/openma.js";
import { agentEventEnvelope, callbackFingerprint, } from "./index.js";
const ACP_SOURCE = {
    kind: "harness",
    harness: "acp",
    adapter: "acp",
};
function isCanonicalOpenMAEvent(event) {
    return Boolean(event
        && typeof event === "object"
        && event.schema_version === OPENMA_EVENT_SCHEMA_VERSION);
}
function snapshotCanonicalOpenMAEvent(event, context) {
    agentEventEnvelope(context, ACP_SOURCE);
    const record = event;
    const requiredStrings = ["event_id", "type", "session_id", "turn_id", "occurred_at"];
    for (const field of requiredStrings) {
        if (typeof record[field] !== "string" || record[field].length === 0) {
            throw new TypeError(`Canonical OpenMA event requires ${field}`);
        }
    }
    const expected = {
        event_id: context.eventId,
        session_id: context.sessionId,
        turn_id: context.turnId,
        occurred_at: context.occurredAt,
        seq: context.seq,
    };
    for (const [field, value] of Object.entries(expected)) {
        if (record[field] !== value) {
            throw new Error(`Canonical OpenMA event ${field} does not match mapper context`);
        }
    }
    if (!Object.prototype.hasOwnProperty.call(record, "data")) {
        throw new TypeError("Canonical OpenMA event requires data");
    }
    const source = objectRecord(record.source);
    if (typeof source.kind !== "string" || source.kind.length === 0) {
        throw new TypeError("Canonical OpenMA event requires source.kind");
    }
    return immutableJson(event);
}
function toolEventType(status) {
    if (status === "completed")
        return "tool.completed";
    if (status === "failed")
        return "tool.failed";
    if (status === "cancelled")
        return "tool.cancelled";
    if (status === "in_progress")
        return "tool.progress";
    return "tool.started";
}
function canonicalToolStatus(status) {
    switch (status) {
        case "pending":
        case "in_progress":
        case "completed":
        case "failed":
        case "cancelled":
            return status;
        default:
            return undefined;
    }
}
function objectRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
}
function nonEmptyString(value) {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
function callbackCategory(method) {
    if (method === "session/request_permission")
        return "permission";
    if (method.startsWith("elicitation/"))
        return "elicitation";
    if (method.startsWith("fs/"))
        return "filesystem";
    if (method.startsWith("terminal/"))
        return "terminal";
    if (method.startsWith("mcp/"))
        return "mcp";
    return "extension";
}
function acpRuntimeEventToOpenMA(event, context) {
    const envelope = agentEventEnvelope(context, ACP_SOURCE);
    if (event.type === "promptComplete") {
        const response = objectRecord(event.response);
        const stopReason = nonEmptyString(response.stopReason) ?? "unknown";
        return createOpenMAEvent({
            ...envelope,
            type: stopReason === "cancelled" ? "turn.cancelled" : "turn.completed",
            data: {
                stop_reason: stopReason,
                ...(response.usage !== undefined ? { usage: response.usage } : {}),
            },
        });
    }
    if (event.type === "promptError") {
        return createOpenMAEvent({
            ...envelope,
            type: "turn.failed",
            data: { error: String(event.error ?? "ACP prompt failed") },
        });
    }
    if (event.type === "acp.client_request"
        || event.type === "acp.client_response"
        || event.type === "acp.client_error"
        || event.type === "acp.client_notification") {
        const method = nonEmptyString(event.method) ?? "acp/unknown";
        const category = callbackCategory(method);
        const callbackId = nonEmptyString(event.requestId);
        const type = event.type === "acp.client_request"
            ? "callback.requested"
            : event.type === "acp.client_response"
                ? "callback.completed"
                : event.type === "acp.client_error"
                    ? "callback.failed"
                    : "callback.notification";
        const data = {
            method,
            category,
            ...(callbackId
                ? {
                    callback_id: callbackId,
                    fingerprint: callbackFingerprint(context, category, method, callbackId, event.params),
                }
                : {}),
            ...(event.params !== undefined ? { params: event.params } : {}),
            ...(event.result !== undefined ? { result: event.result } : {}),
            ...(event.error !== undefined ? { error: event.error } : {}),
        };
        return createOpenMAEvent({ ...envelope, type, data });
    }
    return undefined;
}
function acpSessionMetadataEventToOpenMA(event, context) {
    const update = sessionUpdateType(event);
    if (update !== "current_mode_update"
        && update !== "config_option_update"
        && update !== "session_info_update"
        && update !== "usage_update")
        return undefined;
    const envelope = agentEventEnvelope(context, ACP_SOURCE);
    const data = sessionUpdateInner(event);
    return createOpenMAEvent({
        ...envelope,
        type: update === "usage_update" ? "usage.updated" : "capability.updated",
        data: { update, value: data },
    });
}
export function acpEventToOpenMA(event, context) {
    if (isCanonicalOpenMAEvent(event)) {
        return snapshotCanonicalOpenMAEvent(event, context);
    }
    const runtimeEvent = acpRuntimeEventToOpenMA(objectRecord(event), context);
    if (runtimeEvent)
        return runtimeEvent;
    const sessionMetadataEvent = acpSessionMetadataEventToOpenMA(event, context);
    if (sessionMetadataEvent)
        return sessionMetadataEvent;
    const envelope = agentEventEnvelope(context, ACP_SOURCE);
    const parsed = parseAcpEvent(event);
    switch (parsed.kind) {
        case "text":
            return createOpenMAEvent({
                ...envelope,
                ...(parsed.parentToolUseId ? { parent_id: parsed.parentToolUseId } : {}),
                type: "agent.message_chunk",
                data: {
                    text: parsed.text,
                    ...(parsed.messageId ? { message_id: parsed.messageId } : {}),
                    ...(parsed.phase ? { phase: parsed.phase } : {}),
                },
            });
        case "thought":
            return createOpenMAEvent({
                ...envelope,
                ...(parsed.parentToolUseId ? { parent_id: parsed.parentToolUseId } : {}),
                type: "agent.thinking",
                data: {
                    text: parsed.text,
                    ...(parsed.messageId ? { message_id: parsed.messageId } : {}),
                },
            });
        case "notice":
            return createOpenMAEvent({
                ...envelope,
                type: "system.notice",
                data: { message: parsed.notice },
            });
        case "tool_call": {
            const type = toolEventType(parsed.tool.status);
            const status = canonicalToolStatus(parsed.tool.status);
            return createOpenMAEvent({
                ...envelope,
                ...(parsed.tool.parentToolUseId ? { parent_id: parsed.tool.parentToolUseId } : {}),
                type,
                data: {
                    tool_call_id: parsed.tool.toolCallId,
                    ...(parsed.tool.title !== undefined ? { title: parsed.tool.title } : {}),
                    ...(parsed.tool.kind !== undefined ? { kind: parsed.tool.kind } : {}),
                    ...(status !== undefined ? { status } : {}),
                    ...(parsed.tool.toolName !== undefined
                        ? { tool_name: parsed.tool.toolName }
                        : {}),
                    ...(parsed.tool.rawInput !== undefined
                        ? { raw_input: parsed.tool.rawInput }
                        : {}),
                    ...(parsed.tool.rawOutput !== undefined
                        ? { raw_output: parsed.tool.rawOutput }
                        : {}),
                    ...(parsed.tool.content !== undefined ? { content: parsed.tool.content } : {}),
                    ...(parsed.tool.locations !== undefined
                        ? { locations: parsed.tool.locations }
                        : {}),
                    ...(parsed.tool.meta !== undefined
                        ? { adapter_meta: parsed.tool.meta }
                        : {}),
                },
            });
        }
        case "commands":
            return createOpenMAEvent({
                ...envelope,
                type: "command_catalog.updated",
                data: { commands: parsed.commands },
            });
        case "plan":
            return createOpenMAEvent({
                ...envelope,
                type: "plan.updated",
                data: {
                    representation: "items",
                    ...(parsed.planId ? { plan_id: parsed.planId } : {}),
                    ...(parsed.updateMode ? { update_mode: parsed.updateMode } : {}),
                    entries: parsed.plan,
                    ...(parsed.document ? { document: parsed.document } : {}),
                },
            });
        case "plan_document":
            return createOpenMAEvent({
                ...envelope,
                type: "plan.updated",
                data: { representation: "markdown", document: parsed.document },
            });
        case "plan_removed":
            return createOpenMAEvent({
                ...envelope,
                type: "plan.removed",
                data: parsed.planId ? { plan_id: parsed.planId } : {},
            });
        case "note":
            return createOpenMAEvent({
                ...envelope,
                type: "system.notice",
                data: { message: parsed.note },
            });
        case "silent":
        case "raw":
            return createRawEvent({
                ...envelope,
                source_kind: "acp",
                method: "session/update",
                payload: event,
                reason: parsed.kind === "raw" ? "unknown" : "unsupported",
            });
    }
}
//# sourceMappingURL=acp.js.map