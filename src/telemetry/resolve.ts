/**
 * Pure resolution of OTLP trace export from the environment plus host
 * settings, after Claude Code's model: nothing is exported unless the host's
 * master switch is on; the other knobs are the standard `OTEL_*` exporter
 * variables. A key present in settings wins over the environment, and an
 * empty settings value cancels the environment value.
 */

export const OTLP_PROTOCOLS = ["http/protobuf", "http/json"] as const;
export type OtlpProtocol = (typeof OTLP_PROTOCOLS)[number];

/** The standard OTel keys read for trace export. */
export const OTEL_TRACE_KEYS = [
  "OTEL_SDK_DISABLED",
  "OTEL_TRACES_EXPORTER",
  "OTEL_EXPORTER_OTLP_PROTOCOL",
  "OTEL_EXPORTER_OTLP_TRACES_PROTOCOL",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
  "OTEL_EXPORTER_OTLP_HEADERS",
  "OTEL_EXPORTER_OTLP_TRACES_HEADERS",
] as const;

/** Keys whose values are credentials: never shown, never logged. */
export const OTEL_SECRET_KEYS: ReadonlySet<string> = new Set([
  "OTEL_EXPORTER_OTLP_HEADERS",
  "OTEL_EXPORTER_OTLP_TRACES_HEADERS",
]);

export type TelemetryValueSource = "settings" | "env" | "default";

export type TelemetryOffReason =
  | "telemetry_disabled"
  | "sdk_disabled"
  | "exporter_none"
  | "unsupported_exporter"
  | "unsupported_protocol"
  | "invalid_endpoint";

export type TelemetryExportResolution =
  | {
      enabled: true;
      endpoint: string;
      protocol: OtlpProtocol;
      headers: Record<string, string>;
      sources: Record<string, TelemetryValueSource>;
    }
  | {
      enabled: false;
      reason: TelemetryOffReason;
      sources: Record<string, TelemetryValueSource>;
    };

export type TelemetryValues = Readonly<Partial<Record<string, string | undefined>>>;

// OTLP exporter defaults (specification/protocol/exporter.md): OTLP/HTTP on
// localhost:4318; the generic endpoint gets `/v1/traces` appended, a
// signal-specific endpoint is used as-is; protocol defaults to protobuf.
const DEFAULT_ENDPOINT = "http://localhost:4318";
const DEFAULT_PROTOCOL: OtlpProtocol = "http/protobuf";

function isTruthyFlag(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** `OTEL_EXPORTER_OTLP_HEADERS`: comma-separated `key=value`, percent-encoded values. */
export function parseOtlpHeaders(raw: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const entry of raw?.split(",") ?? []) {
    const separator = entry.indexOf("=");
    if (separator <= 0) continue;
    const key = entry.slice(0, separator).trim();
    if (!key) continue;
    try {
      headers[key] = decodeURIComponent(entry.slice(separator + 1).trim());
    } catch {
      // Invalid percent-encoding: skip the entry rather than send garbage.
    }
  }
  return headers;
}

export function resolveTelemetryExport(options: {
  /** Product master switch, e.g. `BACKCHAT_ENABLE_TELEMETRY`. */
  enableKey: string;
  env: TelemetryValues;
  settings: TelemetryValues;
}): TelemetryExportResolution {
  const values: Record<string, string> = {};
  const sources: Record<string, TelemetryValueSource> = {};
  for (const key of [options.enableKey, ...OTEL_TRACE_KEYS]) {
    if (Object.prototype.hasOwnProperty.call(options.settings, key)) {
      const value = options.settings[key]?.trim();
      if (value) values[key] = value;
      sources[key] = "settings";
      continue;
    }
    const value = options.env[key]?.trim();
    if (value) values[key] = value;
    sources[key] = value ? "env" : "default";
  }
  const off = (reason: TelemetryOffReason): TelemetryExportResolution => ({ enabled: false, reason, sources });

  if (!isTruthyFlag(values[options.enableKey])) return off("telemetry_disabled");
  if (values.OTEL_SDK_DISABLED?.toLowerCase() === "true") return off("sdk_disabled");

  const exporters = (values.OTEL_TRACES_EXPORTER ?? "otlp")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  if (exporters.every((name) => name === "none")) return off("exporter_none");
  if (!exporters.includes("otlp")) return off("unsupported_exporter");

  const protocol = values.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL ?? values.OTEL_EXPORTER_OTLP_PROTOCOL ?? DEFAULT_PROTOCOL;
  if (!(OTLP_PROTOCOLS as readonly string[]).includes(protocol)) return off("unsupported_protocol");

  const endpoint =
    values.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
    ?? `${(values.OTEL_EXPORTER_OTLP_ENDPOINT ?? DEFAULT_ENDPOINT).replace(/\/+$/, "")}/v1/traces`;
  if (!isHttpUrl(endpoint)) return off("invalid_endpoint");

  return {
    enabled: true,
    endpoint,
    protocol: protocol as OtlpProtocol,
    // Signal-specific headers override generic ones per key, as the official
    // exporters do with the environment.
    headers: {
      ...parseOtlpHeaders(values.OTEL_EXPORTER_OTLP_HEADERS),
      ...parseOtlpHeaders(values.OTEL_EXPORTER_OTLP_TRACES_HEADERS),
    },
    sources,
  };
}
