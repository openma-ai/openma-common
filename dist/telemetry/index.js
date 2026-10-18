/**
 * OpenTelemetry instrumentation shared by OpenMA hosts. Depends on
 * `@opentelemetry/api` only; each host owns its SDK pipeline (provider,
 * processors, exporters) and registers it before spans are recorded.
 */
export { AcpTraceObserver } from "./acp-session-tracing.js";
export { GEN_AI, GEN_AI_OPERATIONS, OPENMA_ATTR } from "./gen-ai.js";
export { OTEL_SECRET_KEYS, OTEL_TRACE_KEYS, OTLP_PROTOCOLS, parseOtlpHeaders, resolveTelemetryExport, } from "./resolve.js";
export { SessionSpans, } from "./session-spans.js";
export { summarizeSpan } from "./span-summary.js";
export { formatTraceparent, parseTraceparent, traceparentOf } from "./traceparent.js";
//# sourceMappingURL=index.js.map