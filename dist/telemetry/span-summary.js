import { formatTraceparent } from "./traceparent.js";
const STATUS = ["unset", "ok", "error"];
function hrTimeToMs([seconds, nanos]) {
    return seconds * 1000 + nanos / 1_000_000;
}
export function summarizeSpan(span) {
    const { traceId, spanId, traceFlags } = span.spanContext();
    return {
        name: span.name,
        scope: span.instrumentationScope.name,
        trace_id: traceId,
        span_id: spanId,
        ...(span.parentSpanContext ? { parent_span_id: span.parentSpanContext.spanId } : {}),
        traceparent: formatTraceparent({ traceId, spanId, sampled: (traceFlags & 1) === 1 }),
        start_ms: Math.round(hrTimeToMs(span.startTime)),
        duration_ms: Math.round(hrTimeToMs(span.duration) * 1000) / 1000,
        status: STATUS[span.status.code],
        attributes: { ...span.attributes },
        ...(span.events.length > 0
            ? {
                events: span.events.map((event) => ({
                    name: event.name,
                    ...(event.attributes ? { attributes: { ...event.attributes } } : {}),
                })),
            }
            : {}),
    };
}
//# sourceMappingURL=span-summary.js.map