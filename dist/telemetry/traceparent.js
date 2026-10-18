import { trace } from "@opentelemetry/api";
export function formatTraceparent(ids) {
    return `00-${ids.traceId}-${ids.spanId}-${ids.sampled ? "01" : "00"}`;
}
const ZERO_TRACE = "0".repeat(32);
const ZERO_SPAN = "0".repeat(16);
/** Parse a traceparent; undefined for anything malformed or all-zero. */
export function parseTraceparent(text) {
    const match = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.exec(text.trim());
    if (!match || match[1] === ZERO_TRACE || match[2] === ZERO_SPAN)
        return undefined;
    return {
        traceId: match[1],
        spanId: match[2],
        sampled: (Number.parseInt(match[3], 16) & 1) === 1,
    };
}
/** The traceparent of a span, or undefined for a no-op (invalid) span. */
export function traceparentOf(span) {
    const context = "spanContext" in span ? span.spanContext() : span;
    if (!trace.isSpanContextValid(context))
        return undefined;
    return formatTraceparent({
        traceId: context.traceId,
        spanId: context.spanId,
        sampled: (context.traceFlags & 1) === 1,
    });
}
//# sourceMappingURL=traceparent.js.map