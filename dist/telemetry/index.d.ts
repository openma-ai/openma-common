/**
 * OpenTelemetry instrumentation shared by OpenMA hosts. Depends on
 * `@opentelemetry/api` only; each host owns its SDK pipeline (provider,
 * processors, exporters) and registers it before spans are recorded.
 */
export { AcpTraceObserver, type SessionStartInfo, type TurnStartInfo } from "./acp-session-tracing.js";
export { GEN_AI, GEN_AI_OPERATIONS, OPENMA_ATTR } from "./gen-ai.js";
export { OTEL_SECRET_KEYS, OTEL_TRACE_KEYS, OTLP_PROTOCOLS, parseOtlpHeaders, resolveTelemetryExport, type OtlpProtocol, type TelemetryExportResolution, type TelemetryOffReason, type TelemetryValueSource, type TelemetryValues, } from "./resolve.js";
export { SessionSpans, type ContextUsage, type SessionIdentity, type SpanOutcome, type ToolCallInfo, } from "./session-spans.js";
export { summarizeSpan, type FinishedSpanLike, type SpanSummary } from "./span-summary.js";
export { formatTraceparent, parseTraceparent, traceparentOf, type TraceContextIds } from "./traceparent.js";
//# sourceMappingURL=index.d.ts.map