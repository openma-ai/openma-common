import {
  context as otelContext,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
  type Span,
  type Tracer,
} from "@opentelemetry/api";

import { GEN_AI, GEN_AI_OPERATIONS, OPENMA_ATTR } from "./gen-ai.js";

/**
 * Span bookkeeping for one ACP session: `create_agent` while the agent
 * starts, one `invoke_agent` per turn, one `execute_tool` child per tool
 * call. Every span opened here is closed here.
 *
 * Attributes are metadata only — ids, names, kinds, counts, durations. No
 * prompt text, tool titles (they carry paths), arguments, output or error
 * messages; hosts keep those in their local logs.
 */

export type SpanOutcome =
  | { status: "ok" }
  /** `errorType` is a short closed code (e.g. `auth_required`), not a message. */
  | { status: "error"; errorType: string }
  /** Ended without success or failure, e.g. cancelled or disposed. */
  | { status: "unset"; reason: string };

export interface SessionIdentity {
  agentName: string;
  attributes?: Attributes;
}

export interface ToolCallInfo {
  toolCallId: string;
  name?: string;
  kind?: string;
}

export interface ContextUsage {
  used?: number;
  size?: number;
  costAmount?: number;
}

function finish(span: Span, outcome: SpanOutcome): void {
  if (outcome.status === "ok") {
    span.setStatus({ code: SpanStatusCode.OK });
  } else if (outcome.status === "error") {
    span.setAttribute(GEN_AI.errorType, outcome.errorType);
    span.setStatus({ code: SpanStatusCode.ERROR });
  } else {
    span.setAttribute(OPENMA_ATTR.endReason, outcome.reason);
  }
  span.end();
}

export class SessionSpans {
  #createAgent: Span | undefined;
  #acpSessionId: string | undefined;
  #ready = false;
  readonly #turns = new Map<string, Span>();
  readonly #tools = new Map<string, { span: Span; parentTurnId: string }>();

  constructor(
    private readonly tracer: Tracer,
    readonly sessionId: string,
    private identity: SessionIdentity,
  ) {}

  get ready(): boolean {
    return this.#ready;
  }

  /** Attributes shared by every span of this session. */
  attributes(): Attributes {
    return {
      [GEN_AI.conversationId]: this.sessionId,
      [GEN_AI.agentName]: this.identity.agentName,
      ...this.identity.attributes,
      ...(this.#acpSessionId ? { [OPENMA_ATTR.acpSessionId]: this.#acpSessionId } : {}),
    };
  }

  beginCreateAgent(identity: SessionIdentity): void {
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

  markReady(acpSessionId: string | undefined): void {
    this.#ready = true;
    if (acpSessionId) this.#acpSessionId = acpSessionId;
    if (!this.#createAgent) return;
    this.#createAgent.setAttributes(this.attributes());
    finish(this.#createAgent, { status: "ok" });
    this.#createAgent = undefined;
  }

  /** Fail a pending start; false when no start was pending. */
  failStart(errorType: string): boolean {
    if (!this.#createAgent) return false;
    finish(this.#createAgent, { status: "error", errorType });
    this.#createAgent = undefined;
    return true;
  }

  /**
   * Open a turn. With a remote parent (a forwarded traceparent) the turn
   * joins the caller's trace; otherwise it roots its own, grouped with the
   * session by `gen_ai.conversation.id`.
   */
  beginTurn(turnId: string, promptChars: number | undefined, remoteParent?: Context): void {
    if (this.#turns.has(turnId)) return;
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

  hasTurn(turnId: string): boolean {
    return this.#turns.has(turnId);
  }

  /** End one turn and its open tools, or every open turn when undefined. */
  endTurn(turnId: string | undefined, outcome: SpanOutcome, attributes?: Attributes): void {
    for (const id of turnId === undefined ? [...this.#turns.keys()] : [turnId]) {
      const span = this.#turns.get(id);
      if (!span) continue;
      this.#turns.delete(id);
      for (const [toolCallId, tool] of this.#tools) {
        if (tool.parentTurnId !== id) continue;
        this.#tools.delete(toolCallId);
        finish(tool.span, { status: "unset", reason: "turn ended" });
      }
      if (attributes) span.setAttributes(attributes);
      finish(span, outcome);
    }
  }

  /** Add an event to a turn, or to the oldest open turn when unspecified. */
  addTurnEvent(turnId: string | undefined, name: string, attributes?: Attributes): void {
    const span = turnId === undefined ? this.#turns.values().next().value : this.#turns.get(turnId);
    span?.addEvent(name, attributes);
  }

  recordUsage(turnId: string, usage: ContextUsage): void {
    const attributes: Attributes = {
      ...(usage.used !== undefined ? { [OPENMA_ATTR.contextUsed]: usage.used } : {}),
      ...(usage.size !== undefined ? { [OPENMA_ATTR.contextSize]: usage.size } : {}),
      ...(usage.costAmount !== undefined ? { [OPENMA_ATTR.costAmount]: usage.costAmount } : {}),
    };
    if (Object.keys(attributes).length > 0) this.#turns.get(turnId)?.setAttributes(attributes);
  }

  beginTool(turnId: string, tool: ToolCallInfo): void {
    if (this.#tools.has(tool.toolCallId)) return;
    const turn = this.#turns.get(turnId);
    const span = this.tracer.startSpan(
      "execute_tool",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          [GEN_AI.operationName]: GEN_AI_OPERATIONS.executeTool,
          ...this.attributes(),
          [OPENMA_ATTR.turnId]: turnId,
          [GEN_AI.toolCallId]: tool.toolCallId,
          ...(tool.name ? { [GEN_AI.toolName]: tool.name } : {}),
          ...(tool.kind ? { [OPENMA_ATTR.toolKind]: tool.kind } : {}),
        },
      },
      turn ? trace.setSpan(otelContext.active(), turn) : undefined,
    );
    this.#tools.set(tool.toolCallId, { span, parentTurnId: turnId });
  }

  endTool(toolCallId: string, outcome: "completed" | "failed"): void {
    const tool = this.#tools.get(toolCallId);
    if (!tool) return;
    this.#tools.delete(toolCallId);
    finish(tool.span, outcome === "completed" ? { status: "ok" } : { status: "error", errorType: "tool_failed" });
  }

  /** Close every open span, innermost first. */
  closeAll(reason: string): void {
    for (const tool of this.#tools.values()) finish(tool.span, { status: "unset", reason });
    this.#tools.clear();
    this.endTurn(undefined, { status: "unset", reason });
    if (this.#createAgent) {
      finish(this.#createAgent, { status: "unset", reason });
      this.#createAgent = undefined;
    }
  }
}
