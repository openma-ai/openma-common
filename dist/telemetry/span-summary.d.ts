import type { Attributes, HrTime, SpanContext } from "@opentelemetry/api";
/**
 * Structural view of a finished span, compatible with the SDK's
 * `ReadableSpan` without depending on the SDK.
 */
export interface FinishedSpanLike {
    readonly name: string;
    readonly kind: number;
    spanContext(): SpanContext;
    readonly parentSpanContext?: SpanContext | undefined;
    readonly startTime: HrTime;
    readonly duration: HrTime;
    readonly attributes: Attributes;
    readonly events: ReadonlyArray<{
        name: string;
        attributes?: Attributes | undefined;
    }>;
    readonly status: {
        code: number;
    };
    readonly instrumentationScope: {
        name: string;
    };
}
/** One local log line per finished span, so a trace is readable without a collector. */
export interface SpanSummary {
    name: string;
    scope: string;
    trace_id: string;
    span_id: string;
    parent_span_id?: string;
    traceparent: string;
    start_ms: number;
    duration_ms: number;
    status: "unset" | "ok" | "error";
    attributes: Attributes;
    events?: Array<{
        name: string;
        attributes?: Attributes;
    }>;
}
export declare function summarizeSpan(span: FinishedSpanLike): SpanSummary;
//# sourceMappingURL=span-summary.d.ts.map