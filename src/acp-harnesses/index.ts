export interface AcpHarnessSpec {
  /** Stable id persisted by products and attached to sessions. */
  id: string;
  label: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/**
 * Browser-safe baseline catalog for OpenMA products that launch ACP agents
 * from the user's PATH. Products may append or replace entries when they also
 * implement managed installation or registry discovery.
 */
export const DEFAULT_ACP_HARNESSES: readonly AcpHarnessSpec[] = [
  { id: "claude-acp", label: "Claude", command: "claude-agent-acp", args: [] },
  { id: "codex-acp", label: "Codex", command: "codex-acp", args: [] },
  { id: "gemini", label: "Gemini CLI", command: "gemini", args: ["--acp"] },
  { id: "opencode", label: "OpenCode", command: "opencode", args: ["acp"] },
  { id: "kimi", label: "Kimi Code", command: "kimi", args: ["acp"] },
] as const;

export function cloneAcpHarnesses(
  harnesses: readonly AcpHarnessSpec[],
): AcpHarnessSpec[] {
  return harnesses.map((harness) => ({
    ...harness,
    args: [...harness.args],
    ...(harness.env ? { env: { ...harness.env } } : {}),
  }));
}

/** Safely restores a persisted product-owned harness catalog. */
export function normalizeAcpHarnesses(value: unknown): AcpHarnessSpec[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((candidate) => {
    const record = asRecord(candidate);
    const id = nonEmptyString(record?.id);
    const label = nonEmptyString(record?.label);
    const command = nonEmptyString(record?.command);
    const args = stringArray(record?.args);
    if (!id || !label || !command || !args || seen.has(id)) return [];
    seen.add(id);
    const env = stringRecord(record?.env);
    return [{ id, label, command, args, ...(env ? { env } : {}) }];
  });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? [...value]
    : undefined;
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  const record = asRecord(value);
  if (!record || Object.values(record).some((item) => typeof item !== "string")) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, String(item)]),
  );
}
