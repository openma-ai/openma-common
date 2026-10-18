import { context as otelContext, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { GEN_AI } from "./gen-ai.js";
import { SessionSpans } from "./session-spans.js";
import { parseTraceparent } from "./traceparent.js";
/**
 * ACP session tracing on the OpenTelemetry API.
 *
 * A host feeds the observer two things: the commands it gives its session
 * manager (`sessionStarting`, `turnStarting`) and every message the manager
 * sends out (`observe`). Messages are read structurally by `type`, so any
 * manager speaking the OpenMA session wire (`session.ready`,
 * `session.event`, `session.complete`, ...) can be traced without adapting
 * its union. Unknown messages are ignored.
 *
 * Spans are no-ops until the host registers a TracerProvider.
 */
/** Remote parents kept for turns that have not started yet (prompts queue). */
const MAX_PENDING_TURN_PARENTS = 256;
function str(value) {
    return typeof value === "string" && value ? value : undefined;
}
function num(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function record(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}
/** ACP `session/update` payloads arrive bare or wrapped in `{ update }`. */
function sessionUpdateOf(event) {
    const outer = record(event);
    if (!outer)
        return undefined;
    const update = record(outer.update) ?? outer;
    return typeof update.sessionUpdate === "string" ? update : undefined;
}
/**
 * The tool's name, never its title: ACP titles are free text that often
 * carries paths or commands. Adapters that expose a stable tool name in
 * `_meta` (Claude Code) give it; otherwise the ACP tool kind stands in.
 */
function toolNameOf(update) {
    const meta = record(update._meta);
    return str(record(meta?.claudeCode)?.toolName) ?? str(update.kind);
}
function remoteParent(traceparent) {
    const ids = traceparent ? parseTraceparent(traceparent) : undefined;
    if (!ids)
        return undefined;
    return trace.setSpanContext(otelContext.active(), {
        traceId: ids.traceId,
        spanId: ids.spanId,
        traceFlags: ids.sampled ? 1 : 0,
        isRemote: true,
    });
}
function pendingKey(sessionId, turnId) {
    return `${sessionId}\u0000${turnId}`;
}
const UPDATE_HANDLERS = {
    tool_call(spans, turnId, update) {
        const toolCallId = str(update.toolCallId);
        if (!toolCallId)
            return;
        spans.beginTool(turnId, {
            toolCallId,
            ...(toolNameOf(update) ? { name: toolNameOf(update) } : {}),
            ...(str(update.kind) ? { kind: str(update.kind) } : {}),
        });
        if (update.status === "completed" || update.status === "failed")
            spans.endTool(toolCallId, update.status);
    },
    tool_call_update(spans, _turnId, update) {
        const toolCallId = str(update.toolCallId);
        if (toolCallId && (update.status === "completed" || update.status === "failed")) {
            spans.endTool(toolCallId, update.status);
        }
    },
    usage_update(spans, turnId, update) {
        spans.recordUsage(turnId, {
            ...(num(update.used) !== undefined ? { used: num(update.used) } : {}),
            ...(num(update.size) !== undefined ? { size: num(update.size) } : {}),
            ...(num(record(update.cost)?.amount) !== undefined ? { costAmount: num(record(update.cost)?.amount) } : {}),
        });
    },
    plan(spans, turnId, update) {
        spans.addTurnEvent(turnId, "acp.plan", { entries: Array.isArray(update.entries) ? update.entries.length : 0 });
    },
};
export class AcpTraceObserver {
    tracer;
    #sessions = new Map();
    #pendingParents = new Map();
    constructor(tracer) {
        this.tracer = tracer;
    }
    /**
     * Record the caller's traceparent for a turn that may start later. The
     * turn span adopts it as remote parent. Invalid values are ignored.
     */
    linkTurn(sessionId, turnId, traceparent) {
        const parent = remoteParent(traceparent);
        if (!parent)
            return;
        const key = pendingKey(sessionId, turnId);
        this.#pendingParents.delete(key);
        this.#pendingParents.set(key, parent);
        // A turn that never starts must not pin memory; drop the oldest.
        while (this.#pendingParents.size > MAX_PENDING_TURN_PARENTS) {
            this.#pendingParents.delete(this.#pendingParents.keys().next().value);
        }
    }
    /**
     * A start command. Hosts may re-send start for a session that is already
     * running (an idempotent re-ack); that opens no new `create_agent` span.
     */
    sessionStarting(info) {
        const existing = this.#sessions.get(info.sessionId);
        if (existing?.ready)
            return;
        const spans = existing ?? new SessionSpans(this.tracer, info.sessionId, { agentName: info.agentName });
        this.#sessions.set(info.sessionId, spans);
        spans.beginCreateAgent({
            agentName: info.agentName,
            ...(info.attributes ? { attributes: info.attributes } : {}),
        });
    }
    /** A turn begins executing (not merely queued). */
    turnStarting(info) {
        const parent = this.#takeParent(info.sessionId, info.turnId);
        this.#ensure(info.sessionId).beginTurn(info.turnId, info.promptChars, parent);
    }
    /** Every message the session manager sends out. Never throws. */
    observe(message) {
        try {
            this.#observe(message);
        }
        catch {
            // Tracing observes the stream; it must never break it.
        }
    }
    #observe(message) {
        const sessionId = str(message.session_id);
        if (!sessionId)
            return;
        const turnId = str(message.turn_id);
        const spans = this.#sessions.get(sessionId);
        switch (message.type) {
            case "session.ready":
                this.#ensure(sessionId).markReady(str(message.acp_session_id));
                return;
            case "session.prompt_accepted":
                if (turnId) {
                    this.turnStarting({
                        sessionId,
                        turnId,
                        ...(typeof message.text === "string" ? { promptChars: message.text.length } : {}),
                    });
                }
                return;
            case "session.event": {
                const update = sessionUpdateOf(message.event);
                if (spans && turnId && update)
                    UPDATE_HANDLERS[update.sessionUpdate]?.(spans, turnId, update);
                return;
            }
            case "session.steering": {
                const target = str(message.active_turn_id) ?? turnId;
                spans?.addTurnEvent(target, "acp.steering", {
                    ...(typeof message.text === "string" ? { chars: message.text.length } : {}),
                });
                return;
            }
            case "session.cancel_requested":
                spans?.addTurnEvent(turnId, "acp.cancel_requested");
                return;
            case "session.complete": {
                const stopReason = str(message.stop_reason);
                spans?.endTurn(turnId, { status: "ok" }, stopReason ? { [GEN_AI.responseFinishReasons]: [stopReason] } : undefined);
                return;
            }
            case "session.cancelled":
                spans?.endTurn(turnId, { status: "unset", reason: "cancelled" });
                return;
            case "session.error": {
                const errorType = str(message.code) ?? "agent_error";
                if (turnId && spans?.hasTurn(turnId))
                    spans.endTurn(turnId, { status: "error", errorType });
                else if (!spans?.failStart(errorType))
                    this.#recordOrphanError(sessionId, errorType, spans);
                return;
            }
            case "session.diagnostic": {
                const diagnostic = record(message.diagnostic);
                const severity = str(diagnostic?.severity);
                if (severity)
                    spans?.addTurnEvent(turnId, "acp.diagnostic", { severity });
                return;
            }
            case "session.disposed":
                this.#close(sessionId, "disposed");
                return;
        }
    }
    #takeParent(sessionId, turnId) {
        const key = pendingKey(sessionId, turnId);
        const parent = this.#pendingParents.get(key);
        this.#pendingParents.delete(key);
        return parent;
    }
    #ensure(sessionId) {
        let spans = this.#sessions.get(sessionId);
        if (!spans) {
            spans = new SessionSpans(this.tracer, sessionId, { agentName: "unknown" });
            this.#sessions.set(sessionId, spans);
        }
        return spans;
    }
    #close(sessionId, reason) {
        this.#sessions.get(sessionId)?.closeAll(reason);
        this.#sessions.delete(sessionId);
        const prefix = pendingKey(sessionId, "");
        for (const key of [...this.#pendingParents.keys()]) {
            if (key.startsWith(prefix))
                this.#pendingParents.delete(key);
        }
    }
    /** An error outside any open span still gets a trace anchor. */
    #recordOrphanError(sessionId, errorType, spans) {
        const span = this.tracer.startSpan("acp.session.error", {
            kind: SpanKind.INTERNAL,
            attributes: {
                ...(spans?.attributes() ?? { [GEN_AI.conversationId]: sessionId }),
                [GEN_AI.errorType]: errorType,
            },
        });
        span.setStatus({ code: SpanStatusCode.ERROR });
        span.end();
    }
}
//# sourceMappingURL=acp-session-tracing.js.map