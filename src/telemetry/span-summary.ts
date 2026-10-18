import type { Attributes, HrTime, SpanContext } from "@opentelemetry/api";

import { formatTraceparent } from "./traceparent.js";

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
  readonly events: ReadonlyArray<{ name: string; attributes?: Attributes | undefined }>;
  readonly status: { code: number };
  readonly instrumentationScope: { name: string };
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
  events?: Array<{ name: string; attributes?: Attributes }>;
}

const STATUS = ["unset", "ok", "error"] as const;

function hrTimeToMs([seconds, nanos]: HrTime): number {
  return seconds * 1000 + nanos / 1_000_000;
}

export function summarizeSpan(span: FinishedSpanLike): SpanSummary {
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
    status: STATUS[span.status.code as 0 | 1 | 2],
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
