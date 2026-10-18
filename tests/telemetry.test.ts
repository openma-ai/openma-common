import { trace, SpanStatusCode, type Tracer } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import { describe, expect, it } from "vitest";

import {
  AcpTraceObserver,
  formatTraceparent,
  parseOtlpHeaders,
  parseTraceparent,
  resolveTelemetryExport,
  summarizeSpan,
  traceparentOf,
} from "../src/telemetry/index.js";

function setup(): { tracer: Tracer; spans: () => ReadableSpan[]; observer: AcpTraceObserver } {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  const tracer = provider.getTracer("openma.acp");
  return { tracer, spans: () => exporter.getFinishedSpans(), observer: new AcpTraceObserver(tracer) };
}

const byName = (spans: ReadableSpan[], name: string) => spans.filter((span) => span.name === name);
const update = (sessionId: string, turnId: string, payload: Record<string, unknown>) => ({
  type: "session.event",
  session_id: sessionId,
  turn_id: turnId,
  event: { update: payload },
});

describe("ACP session tracing", () => {
  it("traces a session start, one turn and its tool as nested GenAI spans", () => {
    const { observer, spans } = setup();
    observer.sessionStarting({ sessionId: "s1", agentName: "claude-acp", attributes: { "app.resumed": false } });
    observer.observe({ type: "session.ready", session_id: "s1", acp_session_id: "acp-1" });
    observer.observe({ type: "session.prompt_accepted", session_id: "s1", turn_id: "t1", text: "hello" });
    observer.observe(update("s1", "t1", {
      sessionUpdate: "tool_call",
      toolCallId: "call-1",
      title: "Read /Users/me/secret.ts",
      kind: "read",
      _meta: { claudeCode: { toolName: "Read" } },
    }));
    observer.observe(update("s1", "t1", { sessionUpdate: "tool_call_update", toolCallId: "call-1", status: "completed" }));
    observer.observe(update("s1", "t1", { sessionUpdate: "usage_update", used: 1200, size: 200000, cost: { amount: 0.02 } }));
    observer.observe(update("s1", "t1", { sessionUpdate: "plan", entries: [{}, {}] }));
    observer.observe({ type: "session.complete", session_id: "s1", turn_id: "t1", stop_reason: "end_turn" });

    const [create] = byName(spans(), "create_agent");
    const [turn] = byName(spans(), "invoke_agent");
    const [tool] = byName(spans(), "execute_tool");
    expect(create?.attributes).toMatchObject({
      "gen_ai.operation.name": "create_agent",
      "gen_ai.conversation.id": "s1",
      "gen_ai.agent.name": "claude-acp",
      "openma.acp_session_id": "acp-1",
      "app.resumed": false,
    });
    expect(create?.status.code).toBe(SpanStatusCode.OK);
    expect(turn?.attributes).toMatchObject({
      "openma.turn_id": "t1",
      "openma.prompt_chars": 5,
      "openma.acp.context_used": 1200,
      "openma.acp.context_size": 200000,
      "openma.acp.cost_amount": 0.02,
      "gen_ai.response.finish_reasons": ["end_turn"],
    });
    expect(turn?.events.map((event) => event.name)).toEqual(["acp.plan"]);
    expect(tool?.parentSpanContext?.spanId).toBe(turn?.spanContext().spanId);
    expect(tool?.attributes).toMatchObject({
      "gen_ai.tool.name": "Read",
      "gen_ai.tool.call.id": "call-1",
      "openma.acp.tool_kind": "read",
    });
    // Titles carry paths; no span may contain them.
    expect(JSON.stringify(spans().map((span) => span.attributes))).not.toContain("secret.ts");
  });

  it("falls back to the tool kind and ends a tool reported complete in its first update", () => {
    const { observer, spans } = setup();
    observer.observe({ type: "session.prompt_accepted", session_id: "s1", turn_id: "t1" });
    observer.observe(update("s1", "t1", { sessionUpdate: "tool_call", toolCallId: "c", kind: "execute", status: "failed" }));
    observer.observe(update("s1", "t1", { sessionUpdate: "tool_call", toolCallId: "c", kind: "execute" }));
    observer.observe(update("s1", "t1", { sessionUpdate: "tool_call" }));
    observer.observe(update("s1", "t1", { sessionUpdate: "tool_call_update", toolCallId: "c" }));
    observer.observe(update("s1", "t1", { sessionUpdate: "usage_update" }));
    observer.observe(update("s1", "t1", { sessionUpdate: "plan" }));
    observer.observe(update("s1", "t1", { sessionUpdate: "agent_message_chunk" }));
    const [tool] = byName(spans(), "execute_tool");
    expect(tool?.attributes["gen_ai.tool.name"]).toBe("execute");
    expect(tool?.attributes["error.type"]).toBe("tool_failed");
    expect(tool?.status.code).toBe(SpanStatusCode.ERROR);
    expect(byName(spans(), "execute_tool")).toHaveLength(1);
  });

  it("parents a turn under the caller's traceparent, even when the prompt queued first", () => {
    const { observer, spans } = setup();
    const caller = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";
    observer.linkTurn("s1", "t1", caller);
    observer.linkTurn("s1", "t2", "not-a-traceparent");
    observer.turnStarting({ sessionId: "s1", turnId: "t1" });
    observer.turnStarting({ sessionId: "s1", turnId: "t2" });
    observer.observe({ type: "session.cancelled", session_id: "s1", turn_id: "t1" });
    observer.observe({ type: "session.complete", session_id: "s1", turn_id: "t2" });
    const [first, second] = byName(spans(), "invoke_agent");
    expect(first?.spanContext().traceId).toBe("0af7651916cd43dd8448eb211c80319c");
    expect(first?.parentSpanContext?.spanId).toBe("b7ad6b7169203331");
    expect(first?.attributes["openma.end_reason"]).toBe("cancelled");
    expect(second?.parentSpanContext).toBeUndefined();
  });

  it("keeps a bounded number of pending parents", () => {
    const { observer, spans } = setup();
    const parent = (n: number) => `00-${n.toString(16).padStart(32, "a")}-b7ad6b7169203331-01`;
    for (let n = 0; n < 300; n += 1) observer.linkTurn("s1", `t${n}`, parent(n));
    observer.turnStarting({ sessionId: "s1", turnId: "t0" });
    observer.turnStarting({ sessionId: "s1", turnId: "t299" });
    observer.observe({ type: "session.disposed", session_id: "s1" });
    const [evicted, kept] = byName(spans(), "invoke_agent");
    expect(evicted?.parentSpanContext).toBeUndefined();
    expect(kept?.spanContext().traceId).toBe(parent(299).slice(3, 35));
  });

  it("opens no second create_agent when a running session is started again", () => {
    const { observer, spans } = setup();
    observer.sessionStarting({ sessionId: "s1", agentName: "codex-acp" });
    observer.observe({ type: "session.ready", session_id: "s1", acp_session_id: "a" });
    observer.sessionStarting({ sessionId: "s1", agentName: "codex-acp" });
    observer.observe({ type: "session.ready", session_id: "s1", acp_session_id: "a" });
    expect(byName(spans(), "create_agent")).toHaveLength(1);
  });

  it("restarts a session after it was disposed or failed to start", () => {
    const { observer, spans } = setup();
    observer.sessionStarting({ sessionId: "s1", agentName: "cursor" });
    observer.sessionStarting({ sessionId: "s1", agentName: "cursor" });
    observer.observe({ type: "session.error", session_id: "s1", message: "Authentication required", code: "auth_required" });
    const created = byName(spans(), "create_agent");
    expect(created).toHaveLength(2);
    expect(created[1]?.status.code).toBe(SpanStatusCode.ERROR);
    expect(created[1]?.attributes["error.type"]).toBe("auth_required");
    // Messages stay in local logs, never on spans.
    expect(created[1]?.status.message).toBeUndefined();
  });

  it("ends a failed turn with a closed error type and anchors errors outside any span", () => {
    const { observer, spans } = setup();
    observer.observe({ type: "session.prompt_accepted", session_id: "s1", turn_id: "t1" });
    observer.observe({ type: "session.error", session_id: "s1", turn_id: "t1", message: "upstream overloaded" });
    observer.observe({ type: "session.error", session_id: "s1", turn_id: "t1", message: "late" });
    observer.observe({ type: "session.error", session_id: "s2", message: "no such session" });
    const [turn] = byName(spans(), "invoke_agent");
    expect(turn?.attributes["error.type"]).toBe("agent_error");
    const orphans = byName(spans(), "acp.session.error");
    expect(orphans).toHaveLength(2);
    expect(orphans[0]?.attributes["gen_ai.agent.name"]).toBe("unknown");
    expect(orphans[1]?.attributes["gen_ai.conversation.id"]).toBe("s2");
    expect(JSON.stringify(spans().map((span) => [span.attributes, span.status]))).not.toContain("overloaded");
  });

  it("records steering, cancel requests and diagnostics as turn events", () => {
    const { observer, spans } = setup();
    observer.observe({ type: "session.prompt_accepted", session_id: "s1", turn_id: "t1", text: "go" });
    observer.observe({ type: "session.steering", session_id: "s1", turn_id: "c2", active_turn_id: "t1", text: "abc" });
    observer.observe({ type: "session.steering", session_id: "s1", turn_id: "t1" });
    observer.observe({ type: "session.cancel_requested", session_id: "s1", turn_id: "t1" });
    observer.observe({ type: "session.diagnostic", session_id: "s1", turn_id: "t1", diagnostic: { severity: "warn" } });
    observer.observe({ type: "session.diagnostic", session_id: "s1", turn_id: "t1", diagnostic: {} });
    observer.observe({ type: "session.complete", session_id: "s1", turn_id: "t1" });
    const [turn] = byName(spans(), "invoke_agent");
    expect(turn?.events.map((event) => [event.name, event.attributes])).toEqual([
      ["acp.steering", { chars: 3 }],
      ["acp.steering", {}],
      ["acp.cancel_requested", {}],
      ["acp.diagnostic", { severity: "warn" }],
    ]);
  });

  it("closes every open span when the session is disposed", () => {
    const { observer, spans } = setup();
    observer.sessionStarting({ sessionId: "s1", agentName: "pi-acp" });
    observer.turnStarting({ sessionId: "s1", turnId: "t1" });
    observer.turnStarting({ sessionId: "s1", turnId: "t1" });
    observer.observe(update("s1", "t1", { sessionUpdate: "tool_call", toolCallId: "c1" }));
    observer.observe({ type: "session.disposed", session_id: "s1" });
    observer.observe({ type: "session.complete", session_id: "s1", turn_id: "t1" });
    expect(spans().map((span) => [span.name, span.attributes["openma.end_reason"]])).toEqual([
      ["execute_tool", "disposed"],
      ["invoke_agent", "disposed"],
      ["create_agent", "disposed"],
    ]);
  });

  it("ends a turn's open tools with the turn", () => {
    const { observer, spans } = setup();
    observer.turnStarting({ sessionId: "s1", turnId: "t1" });
    observer.turnStarting({ sessionId: "s1", turnId: "t2" });
    observer.observe(update("s1", "t1", { sessionUpdate: "tool_call", toolCallId: "a" }));
    observer.observe(update("s1", "t2", { sessionUpdate: "tool_call", toolCallId: "b" }));
    observer.observe({ type: "session.complete", session_id: "s1", turn_id: "t1" });
    observer.observe(update("s1", "t1", { sessionUpdate: "tool_call_update", toolCallId: "a", status: "completed" }));
    expect(spans().map((span) => span.name)).toEqual(["execute_tool", "invoke_agent"]);
    expect(spans()[0]?.attributes["openma.end_reason"]).toBe("turn ended");
  });

  it("handles edge messages without opening or leaking spans", () => {
    const { observer, spans } = setup();
    observer.linkTurn("s1", "t1", undefined);
    observer.linkTurn("s2", "t9", "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01");
    observer.linkTurn("s3", "t3", "00-1af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-00");
    observer.sessionStarting({ sessionId: "s1", agentName: "pi-acp" });
    observer.observe({ type: "session.ready", session_id: "s1", acp_session_id: "acp-1" });
    observer.observe({ type: "session.ready", session_id: "s1" });
    observer.turnStarting({ sessionId: "s1", turnId: "t1" });
    // A tool for a turn that is not open roots its own span.
    observer.observe(update("s1", "t-unknown", { sessionUpdate: "tool_call", toolCallId: "orphan", status: "completed" }));
    // A repeated tool_call for an open tool does not open a second span.
    observer.observe(update("s1", "t1", { sessionUpdate: "tool_call", toolCallId: "dup" }));
    observer.observe(update("s1", "t1", { sessionUpdate: "tool_call", toolCallId: "dup" }));
    observer.observe({ type: "session.cancel_requested", session_id: "s1" });
    observer.observe({ type: "session.complete", session_id: "s1", turn_id: "t-never" });
    observer.observe({ type: "session.disposed", session_id: "s1" });
    // Disposing s1 keeps the pending parent of another session.
    observer.turnStarting({ sessionId: "s2", turnId: "t9" });
    observer.observe({ type: "session.complete", session_id: "s2", turn_id: "t9" });
    // An unsampled caller keeps the turn unrecorded.
    observer.turnStarting({ sessionId: "s3", turnId: "t3" });
    observer.observe({ type: "session.complete", session_id: "s3", turn_id: "t3" });
    const names = spans().map((span) => span.name);
    expect(names.filter((name) => name === "execute_tool")).toHaveLength(2);
    const [orphanTool] = byName(spans(), "execute_tool");
    expect(orphanTool?.parentSpanContext).toBeUndefined();
    const turns = byName(spans(), "invoke_agent");
    expect(turns[0]?.attributes["openma.acp_session_id"]).toBe("acp-1");
    expect(turns[0]?.events.map((event) => event.name)).toEqual(["acp.cancel_requested"]);
    expect(turns[1]?.spanContext().traceId).toBe("0af7651916cd43dd8448eb211c80319c");
    expect(turns).toHaveLength(2);
  });

  it("ignores messages it cannot read and never throws", () => {
    const { observer, spans } = setup();
    const hostile = { type: "session.event", session_id: "s1", turn_id: "t1" };
    Object.defineProperty(hostile, "event", { get: () => { throw new Error("boom"); } });
    observer.turnStarting({ sessionId: "s1", turnId: "t1" });
    expect(() => observer.observe(hostile)).not.toThrow();
    observer.observe({ type: "session.ready" });
    observer.observe({ type: "session.prompt_accepted", session_id: "s1" });
    observer.observe({ type: "session.event", session_id: "s1", turn_id: "t1", event: "text" });
    observer.observe({ type: "session.event", session_id: "s1", turn_id: "t1", event: { sessionUpdate: 3 } });
    observer.observe({ type: "session.event", session_id: "s9", turn_id: "t1", event: { sessionUpdate: "plan" } });
    observer.observe({ type: "something.else", session_id: "s1" });
    expect(spans()).toHaveLength(0);
  });
});

describe("traceparent", () => {
  it("round-trips and rejects malformed or all-zero values", () => {
    const ids = { traceId: "0af7651916cd43dd8448eb211c80319c", spanId: "b7ad6b7169203331", sampled: true };
    expect(parseTraceparent(formatTraceparent(ids))).toEqual(ids);
    expect(parseTraceparent(formatTraceparent({ ...ids, sampled: false }))?.sampled).toBe(false);
    expect(parseTraceparent(`00-${"0".repeat(32)}-b7ad6b7169203331-01`)).toBeUndefined();
    expect(parseTraceparent(`00-0af7651916cd43dd8448eb211c80319c-${"0".repeat(16)}-01`)).toBeUndefined();
    expect(parseTraceparent("garbage")).toBeUndefined();
  });

  it("is undefined for a no-op span and set for a recorded one", () => {
    expect(traceparentOf(trace.getTracer("noop").startSpan("x"))).toBeUndefined();
    const { tracer } = setup();
    const span = tracer.startSpan("x");
    expect(traceparentOf(span)).toBe(formatTraceparent({
      traceId: span.spanContext().traceId,
      spanId: span.spanContext().spanId,
      sampled: true,
    }));
    expect(traceparentOf(span.spanContext())).toBe(traceparentOf(span));
  });
});

describe("summarizeSpan", () => {
  it("folds a finished span into one local log record", () => {
    const { observer, spans } = setup();
    observer.turnStarting({ sessionId: "s1", turnId: "t1" });
    observer.observe(update("s1", "t1", { sessionUpdate: "tool_call", toolCallId: "c", kind: "read", status: "completed" }));
    observer.observe({ type: "session.cancel_requested", session_id: "s1", turn_id: "t1" });
    observer.observe({ type: "session.error", session_id: "s1", turn_id: "t1", message: "x" });
    const [tool, turn] = spans().map(summarizeSpan);
    expect(tool).toMatchObject({ name: "execute_tool", scope: "openma.acp", status: "ok", parent_span_id: turn?.span_id });
    expect(turn).toMatchObject({ name: "invoke_agent", status: "error", events: [{ name: "acp.cancel_requested" }] });
    expect(turn?.parent_span_id).toBeUndefined();
    expect(tool?.events).toBeUndefined();
    expect(turn?.traceparent).toBe(`00-${turn?.trace_id}-${turn?.span_id}-01`);
    expect(turn?.duration_ms).toBeGreaterThanOrEqual(0);
    expect(turn?.start_ms).toBeGreaterThan(1_700_000_000_000);
    const finished = spans()[0]!;
    const withAttributes = summarizeSpan({
      name: finished.name,
      kind: finished.kind,
      spanContext: () => finished.spanContext(),
      startTime: finished.startTime,
      duration: finished.duration,
      attributes: finished.attributes,
      events: [{ name: "e", attributes: { n: 1 } }, { name: "bare" }],
      status: { code: 0 },
      instrumentationScope: finished.instrumentationScope,
    });
    expect(withAttributes.events).toEqual([{ name: "e", attributes: { n: 1 } }, { name: "bare" }]);
    expect(withAttributes.status).toBe("unset");
  });
});

describe("resolveTelemetryExport", () => {
  const resolve = (env: Record<string, string>, settings: Record<string, string> = {}) =>
    resolveTelemetryExport({ enableKey: "APP_ENABLE_TELEMETRY", env, settings });

  it("is off until the product switch is on", () => {
    expect(resolve({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://c:4318" })).toMatchObject({ enabled: false, reason: "telemetry_disabled" });
  });

  it("uses the OTLP defaults and appends the signal path to a generic endpoint", () => {
    expect(resolve({ APP_ENABLE_TELEMETRY: "1" })).toMatchObject({
      enabled: true,
      endpoint: "http://localhost:4318/v1/traces",
      protocol: "http/protobuf",
      headers: {},
    });
    expect(resolve({ APP_ENABLE_TELEMETRY: "true", OTEL_EXPORTER_OTLP_ENDPOINT: "https://c.example/otlp/" })).toMatchObject({
      endpoint: "https://c.example/otlp/v1/traces",
    });
    expect(resolve({
      APP_ENABLE_TELEMETRY: "1",
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://c.example/traces",
      OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
    })).toMatchObject({ endpoint: "https://c.example/traces", protocol: "http/json" });
  });

  it("lets settings win per key and an empty setting cancel the environment", () => {
    const resolution = resolve(
      { APP_ENABLE_TELEMETRY: "1", OTEL_EXPORTER_OTLP_ENDPOINT: "http://env:4318", OTEL_EXPORTER_OTLP_HEADERS: "a=env" },
      { OTEL_EXPORTER_OTLP_ENDPOINT: "http://settings:4318", OTEL_EXPORTER_OTLP_HEADERS: "" },
    );
    expect(resolution).toMatchObject({ enabled: true, endpoint: "http://settings:4318/v1/traces", headers: {} });
    expect(resolution.sources).toMatchObject({
      APP_ENABLE_TELEMETRY: "env",
      OTEL_EXPORTER_OTLP_ENDPOINT: "settings",
      OTEL_EXPORTER_OTLP_HEADERS: "settings",
      OTEL_TRACES_EXPORTER: "default",
    });
    expect(resolve({ APP_ENABLE_TELEMETRY: "1" }, { APP_ENABLE_TELEMETRY: "" })).toMatchObject({ reason: "telemetry_disabled" });
  });

  it("merges signal-specific headers over generic ones", () => {
    expect(resolve({
      APP_ENABLE_TELEMETRY: "1",
      OTEL_EXPORTER_OTLP_HEADERS: "authorization=Bearer%20a,x=1",
      OTEL_EXPORTER_OTLP_TRACES_HEADERS: "x=2",
    })).toMatchObject({ headers: { authorization: "Bearer a", x: "2" } });
  });

  it.each([
    [{ OTEL_SDK_DISABLED: "TRUE" }, "sdk_disabled"],
    [{ OTEL_TRACES_EXPORTER: "none" }, "exporter_none"],
    [{ OTEL_TRACES_EXPORTER: "console" }, "unsupported_exporter"],
    [{ OTEL_EXPORTER_OTLP_PROTOCOL: "grpc" }, "unsupported_protocol"],
    [{ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "ftp://c" }, "invalid_endpoint"],
    [{ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "not a url" }, "invalid_endpoint"],
  ] as const)("is off for %o", (env, reason) => {
    expect(resolve({ APP_ENABLE_TELEMETRY: "1", ...env })).toMatchObject({ enabled: false, reason });
  });

  it("accepts an exporter list that includes otlp", () => {
    expect(resolve({ APP_ENABLE_TELEMETRY: "1", OTEL_TRACES_EXPORTER: "console, otlp" }).enabled).toBe(true);
  });

  it("skips malformed header entries", () => {
    expect(parseOtlpHeaders("=x, ,  =y,k=%E0%A4%A,ok= v ,noequals")).toEqual({ ok: "v" });
    expect(parseOtlpHeaders(undefined)).toEqual({});
  });
});
