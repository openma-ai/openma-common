/**
 * Cursor Cloud Agents API v1 run-stream SSE → OpenMA events.
 *
 * Source of truth: https://cursor.com/docs/cloud-agent/api/endpoints
 * (`GET /v1/agents/{id}/runs/{runId}/stream`) and the OpenAPI schema it
 * links, https://cursor.com/docs-static/cloud-agents-openapi.yaml
 * (`Run.status`, `RunStreamToolCallData`, `Run.git`). Fields that page
 * does not define are not inferred.
 *
 * Review decisions for issue #12:
 * - `status: RUNNING` is `turn.started`. `CREATING` is `turn.queued`, and
 *   `turn_id` is the run id, so the run status stays on the turn. Terminal
 *   run statuses are not mapped from `status`; `result` owns those, which
 *   avoids a second canonical terminal event when both arrive. A terminal
 *   or unknown `status` is kept as a vendor event.
 * - `assistant` text is `agent.message_chunk`. `message_id` is
 *   `${turnId}:assistant`. `result.text` is not a second `agent.message`.
 *   The docs call `assistant` a delta and `result.text` the final reply,
 *   but they do not say whether the final text repeats the deltas. The
 *   text stays on the turn's `adapter_meta`.
 * - `thinking` text is `agent.thinking`. There is no thinking-chunk
 *   canonical type. The docs call the payload a text delta, so each event
 *   carries that delta (`adapter_meta.text_role = "delta"`) and shares
 *   `message_id` `${turnId}:thinking`.
 * - `interaction_update` stays vendor-only when it repeats a simplified
 *   event (`text-delta`, `thinking-delta`, tool calls, `turn-ended`).
 *   A live run on 2026-10-03 (Actions run 37110762427) also sent
 *   `interaction_update` `{ type: "user-message-appended", userMessage:
 *   { type: "user_message", session_id, text } }`. No simplified event
 *   carries that user text. `text` becomes `user.message`. `session_id`
 *   in that payload was the run id, so it is kept on `adapter_meta` and
 *   is not used as the OpenMA `session_id`. Other `userMessage` fields
 *   are preserved on `adapter_meta.user_message`.
 * - `heartbeat` and `done` produce nothing.
 * - The SSE `id` is an opaque `Last-Event-ID` cursor. It is copied to
 *   `adapter_meta.sse_id` on canonical events and to `data.sse_id` on
 *   vendor events. It is never `seq`. The leading `status` event has no
 *   id and is resent on reconnect; its `event_id` is
 *   `status:${turnId}:${status}` so the caller can dedupe.
 *
 * Tool failure: `RunStreamToolCallData.status` is only `"running"` |
 * `"completed"`. `result` is an unconstrained JSON value. The documented
 * example is `{ success: { content, totalLines, fileSize, path } }`. No
 * failure discriminator is specified, so a `completed` tool call is always
 * `tool.completed` and `result` is preserved as `raw_output`. A status
 * outside that enum (including the TypeScript SDK stream's `"error"`,
 * which is a different surface) is a vendor event. Do not guess
 * `tool.failed` until a real run stream shows the failure shape.
 */
import { createOpenMAEvent, createVendorEvent, } from "../../session-events/openma.js";
const SOURCE = { kind: "harness", harness: "cursor-cloud" };
export function decodeCursorCloudRunStreamEvent(event, context) {
    const streamId = sseId(event);
    switch (event.event) {
        case "status":
            return decodeStatus(event.data, context, streamId);
        case "assistant":
            return decodeTextDelta(event, context, streamId, "assistant", "agent.message_chunk", `${context.turnId}:assistant`);
        case "thinking":
            return decodeTextDelta(event, context, streamId, "thinking", "agent.thinking", `${context.turnId}:thinking`, {
                text_role: "delta",
            });
        case "tool_call":
            return decodeToolCall(event.data, context, streamId);
        case "result":
            return decodeResult(event.data, context, streamId);
        case "error":
            return decodeError(event.data, context, streamId);
        case "interaction_update":
            return decodeInteractionUpdate(event, context, streamId);
        case "heartbeat":
        case "done":
            return [];
        default:
            return [vendorEvent(context, streamId ? `${event.event}:${streamId}` : `${event.event || "unknown"}:${context.turnId}`, event.event || "unknown", event.data, streamId)];
    }
}
function sseId(event) {
    return typeof event.id === "string" && event.id.length > 0 ? event.id : undefined;
}
function record(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value
        : undefined;
}
function adapterMeta(cursorEvent, streamId, extra) {
    return {
        cursor_event: cursorEvent,
        ...(streamId ? { sse_id: streamId } : {}),
        ...extra,
    };
}
function canonicalEvent(context, eventId, type, data) {
    return createOpenMAEvent({
        event_id: eventId,
        type,
        session_id: context.sessionId,
        turn_id: context.turnId,
        source: SOURCE,
        occurred_at: context.now(),
        data,
    });
}
function vendorEvent(context, eventId, name, payload, streamId) {
    return createVendorEvent({
        event_id: eventId,
        session_id: context.sessionId,
        turn_id: context.turnId,
        source: SOURCE,
        occurred_at: context.now(),
        harness: "cursor-cloud",
        namespace: "runs",
        name,
        correlation: {
            session_id: context.sessionId,
            turn_id: context.turnId,
        },
        data: {
            ...(streamId ? { sse_id: streamId } : {}),
            payload,
        },
    });
}
function decodeStatus(data, context, streamId) {
    const body = record(data);
    const status = typeof body?.status === "string" ? body.status : undefined;
    const eventId = statusEventId(context, status, streamId);
    if (status === "CREATING" || status === "RUNNING") {
        return [canonicalEvent(context, eventId, status === "CREATING" ? "turn.queued" : "turn.started", {
                adapter_meta: adapterMeta("status", streamId, {
                    run_status: status,
                    ...(typeof body?.runId === "string" ? { run_id: body.runId } : {}),
                }),
            })];
    }
    return [vendorEvent(context, eventId, "status", data, streamId)];
}
function statusEventId(context, status, streamId) {
    const base = status ? `status:${context.turnId}:${status}` : `status:${context.turnId}`;
    // The leading status event has no SSE id and is resent on reconnect.
    // Keeping that id stable lets the caller dedupe it. A later status event
    // that does carry an id must not collapse into the same event_id.
    return streamId ? `${base}:${streamId}` : base;
}
function decodeTextDelta(event, context, streamId, name, type, messageId, extraMeta) {
    const body = record(event.data);
    const eventId = streamId ? `${name}:${streamId}` : `${name}:${context.turnId}`;
    if (typeof body?.text !== "string") {
        return [vendorEvent(context, eventId, name, event.data, streamId)];
    }
    return [canonicalEvent(context, eventId, type, {
            message_id: messageId,
            text: body.text,
            adapter_meta: adapterMeta(name, streamId, extraMeta),
        })];
}
function decodeToolCall(data, context, streamId) {
    const body = record(data);
    const callId = typeof body?.callId === "string" ? body.callId : undefined;
    const name = typeof body?.name === "string" ? body.name : undefined;
    const status = typeof body?.status === "string" ? body.status : undefined;
    const known = status === "running" || status === "completed";
    if (!body || !callId || !name || !known) {
        return [vendorEvent(context, streamId ? `tool_call:${streamId}` : `tool_call:${context.turnId}:${status ?? "unknown"}`, "tool_call", data, streamId)];
    }
    const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
    return [canonicalEvent(context, streamId ? `tool_call:${streamId}` : `tool_call:${callId}:${status}`, status === "running" ? "tool.started" : "tool.completed", {
            tool_call_id: callId,
            tool_name: name,
            title: name,
            status: status === "running" ? "in_progress" : "completed",
            ...(has("args") ? { raw_input: body.args } : {}),
            ...(has("result") ? { raw_output: body.result } : {}),
            adapter_meta: adapterMeta("tool_call", streamId, has("truncated")
                ? { truncated: body.truncated }
                : undefined),
        })];
}
function decodeResult(data, context, streamId) {
    const body = record(data);
    const status = typeof body?.status === "string" ? body.status : undefined;
    const type = status === "FINISHED"
        ? "turn.completed"
        : status === "ERROR" || status === "EXPIRED"
            ? "turn.failed"
            : status === "CANCELLED"
                ? "turn.cancelled"
                : undefined;
    if (!type || !status) {
        return [vendorEvent(context, streamId ? `result:${streamId}` : `result:${context.turnId}`, "result", data, streamId)];
    }
    const eventId = streamId ? `result:${streamId}` : `result:${context.turnId}:${status}`;
    const events = [canonicalEvent(context, eventId, type, {
            stop_reason: status,
            adapter_meta: adapterMeta("result", streamId, {
                ...(typeof body?.text === "string" ? { text: body.text } : {}),
                ...(typeof body?.durationMs === "number" && Number.isFinite(body.durationMs)
                    ? { durationMs: body.durationMs }
                    : {}),
                ...(typeof body?.runId === "string" ? { run_id: body.runId } : {}),
            }),
        })];
    if (body && Object.prototype.hasOwnProperty.call(body, "git") && body.git != null) {
        events.push(vendorEvent(context, `${eventId}:git`, "git", body.git, streamId));
    }
    return events;
}
function decodeInteractionUpdate(event, context, streamId) {
    const body = record(event.data);
    const message = body?.type === "user-message-appended" ? record(body.userMessage) : undefined;
    const text = typeof message?.text === "string" ? message.text : undefined;
    if (!message || text === undefined) {
        return [vendorEvent(context, streamId ? `interaction_update:${streamId}` : `interaction_update:${context.turnId}`, "interaction_update", event.data, streamId)];
    }
    const eventId = streamId ? `user:${streamId}` : `user:${context.turnId}`;
    return [canonicalEvent(context, eventId, "user.message", {
            message_id: streamId ? `${context.turnId}:user:${streamId}` : `${context.turnId}:user`,
            text,
            adapter_meta: adapterMeta("interaction_update", streamId, {
                interaction_type: "user-message-appended",
                user_message: message,
            }),
        })];
}
function decodeError(data, context, streamId) {
    const body = record(data);
    const eventId = streamId ? `error:${streamId}` : `error:${context.turnId}`;
    if (!body || typeof body.code !== "string" || typeof body.message !== "string") {
        return [vendorEvent(context, eventId, "error", data, streamId)];
    }
    return [canonicalEvent(context, eventId, "session.error", {
            code: body.code,
            message: body.message,
            adapter_meta: adapterMeta("error", streamId),
        })];
}
//# sourceMappingURL=index.js.map