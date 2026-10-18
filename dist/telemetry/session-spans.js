import { context as otelContext, SpanKind, SpanStatusCode, trace, } from "@opentelemetry/api";
import { GEN_AI, GEN_AI_OPERATIONS, OPENMA_ATTR } from "./gen-ai.js";
function finish(span, outcome) {
    if (outcome.status === "ok") {
        span.setStatus({ code: SpanStatusCode.OK });
    }
    else if (outcome.status === "error") {
        span.setAttribute(GEN_AI.errorType, outcome.errorType);
        span.setStatus({ code: SpanStatusCode.ERROR });
    }
    else {
        span.setAttribute(OPENMA_ATTR.endReason, outcome.reason);
    }
    span.end();
}
export class SessionSpans {
    tracer;
    sessionId;
    identity;
    #createAgent;
    #acpSessionId;
    #ready = false;
    #turns = new Map();
    #tools = new Map();
    constructor(tracer, sessionId, identity) {
        this.tracer = tracer;
        this.sessionId = sessionId;
        this.identity = identity;
    }
    get ready() {
        return this.#ready;
    }
    /** Attributes shared by every span of this session. */
    attributes() {
        return {
            [GEN_AI.conversationId]: this.sessionId,
            [GEN_AI.agentName]: this.identity.agentName,
            ...this.identity.attributes,
            ...(this.#acpSessionId ? { [OPENMA_ATTR.acpSessionId]: this.#acpSessionId } : {}),
        };
    }
    beginCreateAgent(identity) {
        this.identity = identity;
        this.#ready = false;
        this.#createAgent?.end();
        this.#createAgent = this.tracer.startSpan("create_agent", {
            kind: SpanKind.INTERNAL,
            attributes: {
                [GEN_AI.operationName]: GEN_AI_OPERATIONS.createAgent,
                ...this.attributes(),
            },
        });
    }
    markReady(acpSessionId) {
        this.#ready = true;
        if (acpSessionId)
            this.#acpSessionId = acpSessionId;
        if (!this.#createAgent)
            return;
        this.#createAgent.setAttributes(this.attributes());
        finish(this.#createAgent, { status: "ok" });
        this.#createAgent = undefined;
    }
    /** Fail a pending start; false when no start was pending. */
    failStart(errorType) {
        if (!this.#createAgent)
            return false;
        finish(this.#createAgent, { status: "error", errorType });
        this.#createAgent = undefined;
        return true;
    }
    /**
     * Open a turn. With a remote parent (a forwarded traceparent) the turn
     * joins the caller's trace; otherwise it roots its own, grouped with the
     * session by `gen_ai.conversation.id`.
     */
    beginTurn(turnId, promptChars, remoteParent) {
        if (this.#turns.has(turnId))
            return;
        const options = {
            kind: SpanKind.INTERNAL,
            attributes: {
                [GEN_AI.operationName]: GEN_AI_OPERATIONS.invokeAgent,
                ...this.attributes(),
                [OPENMA_ATTR.turnId]: turnId,
                ...(promptChars !== undefined ? { [OPENMA_ATTR.promptChars]: promptChars } : {}),
            },
        };
        this.#turns.set(turnId, this.tracer.startSpan("invoke_agent", options, remoteParent));
    }
    hasTurn(turnId) {
        return this.#turns.has(turnId);
    }
    /** End one turn and its open tools, or every open turn when undefined. */
    endTurn(turnId, outcome, attributes) {
        for (const id of turnId === undefined ? [...this.#turns.keys()] : [turnId]) {
            const span = this.#turns.get(id);
            if (!span)
                continue;
            this.#turns.delete(id);
            for (const [toolCallId, tool] of this.#tools) {
                if (tool.parentTurnId !== id)
                    continue;
                this.#tools.delete(toolCallId);
                finish(tool.span, { status: "unset", reason: "turn ended" });
            }
            if (attributes)
                span.setAttributes(attributes);
            finish(span, outcome);
        }
    }
    /** Add an event to a turn, or to the oldest open turn when unspecified. */
    addTurnEvent(turnId, name, attributes) {
        const span = turnId === undefined ? this.#turns.values().next().value : this.#turns.get(turnId);
        span?.addEvent(name, attributes);
    }
    recordUsage(turnId, usage) {
        const attributes = {
            ...(usage.used !== undefined ? { [OPENMA_ATTR.contextUsed]: usage.used } : {}),
            ...(usage.size !== undefined ? { [OPENMA_ATTR.contextSize]: usage.size } : {}),
            ...(usage.costAmount !== undefined ? { [OPENMA_ATTR.costAmount]: usage.costAmount } : {}),
        };
        if (Object.keys(attributes).length > 0)
            this.#turns.get(turnId)?.setAttributes(attributes);
    }
    beginTool(turnId, tool) {
        if (this.#tools.has(tool.toolCallId))
            return;
        const turn = this.#turns.get(turnId);
        const span = this.tracer.startSpan("execute_tool", {
            kind: SpanKind.INTERNAL,
            attributes: {
                [GEN_AI.operationName]: GEN_AI_OPERATIONS.executeTool,
                ...this.attributes(),
                [OPENMA_ATTR.turnId]: turnId,
                [GEN_AI.toolCallId]: tool.toolCallId,
                ...(tool.name ? { [GEN_AI.toolName]: tool.name } : {}),
                ...(tool.kind ? { [OPENMA_ATTR.toolKind]: tool.kind } : {}),
            },
        }, turn ? trace.setSpan(otelContext.active(), turn) : undefined);
        this.#tools.set(tool.toolCallId, { span, parentTurnId: turnId });
    }
    endTool(toolCallId, outcome) {
        const tool = this.#tools.get(toolCallId);
        if (!tool)
            return;
        this.#tools.delete(toolCallId);
        finish(tool.span, outcome === "completed" ? { status: "ok" } : { status: "error", errorType: "tool_failed" });
    }
    /** Close every open span, innermost first. */
    closeAll(reason) {
        for (const tool of this.#tools.values())
            finish(tool.span, { status: "unset", reason });
        this.#tools.clear();
        this.endTurn(undefined, { status: "unset", reason });
        if (this.#createAgent) {
            finish(this.#createAgent, { status: "unset", reason });
            this.#createAgent = undefined;
        }
    }
}
//# sourceMappingURL=session-spans.js.map