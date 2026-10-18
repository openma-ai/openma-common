import { type Span, type SpanContext } from "@opentelemetry/api";
/**
 * W3C `traceparent` for manual propagation across process boundaries the
 * OTel propagators do not cover (Electron IPC, prompt frames).
 * Format: `00-<32-hex trace id>-<16-hex span id>-<2-hex flags>`.
 */
export interface TraceContextIds {
    traceId: string;
    spanId: string;
    sampled: boolean;
}
export declare function formatTraceparent(ids: TraceContextIds): string;
/** Parse a traceparent; undefined for anything malformed or all-zero. */
export declare function parseTraceparent(text: string): TraceContextIds | undefined;
/** The traceparent of a span, or undefined for a no-op (invalid) span. */
export declare function traceparentOf(span: Span | SpanContext): string | undefined;
//# sourceMappingURL=traceparent.d.ts.map