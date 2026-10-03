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
 * - `error` with string `code` and `message` is `session.error`, except
 *   `code: "stream_unavailable"`. Live runs on 2026-10-03 showed that
 *   code is a transient transport close: the run keeps going, and a
 *   reconnect still delivers `user.message` and `turn.completed`.
 *   A canonical `session.error` would make a GUI report a false failure,
 *   so this code stays a vendor event. Other error codes stay
 *   `session.error`.
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
import { type OpenMAEvent } from "../../session-events/openma.js";
export interface CursorCloudDecodeContext {
    /** Agent id (`bc-…`). Stored as `session_id`. */
    sessionId: string;
    /** Run id. Stored as `turn_id`. */
    turnId: string;
    /** SSE payloads have no event timestamp. */
    now: () => string;
}
/** One SSE record from `GET /v1/agents/{id}/runs/{runId}/stream`. */
export interface CursorCloudSseEvent {
    event: string;
    /** Opaque resume cursor. Not an OpenMA `seq`. */
    id?: string;
    data: unknown;
}
export declare function decodeCursorCloudRunStreamEvent(event: CursorCloudSseEvent, context: CursorCloudDecodeContext): OpenMAEvent[];
//# sourceMappingURL=index.d.ts.map