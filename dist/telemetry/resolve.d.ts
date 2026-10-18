/**
 * Pure resolution of OTLP trace export from the environment plus host
 * settings, after Claude Code's model: nothing is exported unless the host's
 * master switch is on; the other knobs are the standard `OTEL_*` exporter
 * variables. A key present in settings wins over the environment, and an
 * empty settings value cancels the environment value.
 */
export declare const OTLP_PROTOCOLS: readonly ["http/protobuf", "http/json"];
export type OtlpProtocol = (typeof OTLP_PROTOCOLS)[number];
/** The standard OTel keys read for trace export. */
export declare const OTEL_TRACE_KEYS: readonly ["OTEL_SDK_DISABLED", "OTEL_TRACES_EXPORTER", "OTEL_EXPORTER_OTLP_PROTOCOL", "OTEL_EXPORTER_OTLP_TRACES_PROTOCOL", "OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "OTEL_EXPORTER_OTLP_HEADERS", "OTEL_EXPORTER_OTLP_TRACES_HEADERS"];
/** Keys whose values are credentials: never shown, never logged. */
export declare const OTEL_SECRET_KEYS: ReadonlySet<string>;
export type TelemetryValueSource = "settings" | "env" | "default";
export type TelemetryOffReason = "telemetry_disabled" | "sdk_disabled" | "exporter_none" | "unsupported_exporter" | "unsupported_protocol" | "invalid_endpoint";
export type TelemetryExportResolution = {
    enabled: true;
    endpoint: string;
    protocol: OtlpProtocol;
    headers: Record<string, string>;
    sources: Record<string, TelemetryValueSource>;
} | {
    enabled: false;
    reason: TelemetryOffReason;
    sources: Record<string, TelemetryValueSource>;
};
export type TelemetryValues = Readonly<Partial<Record<string, string | undefined>>>;
/** `OTEL_EXPORTER_OTLP_HEADERS`: comma-separated `key=value`, percent-encoded values. */
export declare function parseOtlpHeaders(raw: string | undefined): Record<string, string>;
export declare function resolveTelemetryExport(options: {
    /** Product master switch, e.g. `BACKCHAT_ENABLE_TELEMETRY`. */
    enableKey: string;
    env: TelemetryValues;
    settings: TelemetryValues;
}): TelemetryExportResolution;
//# sourceMappingURL=resolve.d.ts.map