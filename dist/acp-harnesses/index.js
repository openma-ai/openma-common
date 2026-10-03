/**
 * Browser-safe baseline catalog for OpenMA products that launch ACP agents
 * from the user's PATH. Products may append or replace entries when they also
 * implement managed installation or registry discovery.
 */
export const DEFAULT_ACP_HARNESSES = [
    { id: "claude-acp", label: "Claude", command: "claude-agent-acp", args: [] },
    { id: "codex-acp", label: "Codex", command: "codex-acp", args: [] },
    { id: "gemini", label: "Gemini CLI", command: "gemini", args: ["--acp"] },
    { id: "opencode", label: "OpenCode", command: "opencode", args: ["acp"] },
    { id: "kimi", label: "Kimi Code", command: "kimi", args: ["acp"] },
];
export function cloneAcpHarnesses(harnesses) {
    return harnesses.map((harness) => ({
        ...harness,
        args: [...harness.args],
        ...(harness.env ? { env: { ...harness.env } } : {}),
    }));
}
/** Safely restores a persisted product-owned harness catalog. */
export function normalizeAcpHarnesses(value) {
    if (!Array.isArray(value))
        return [];
    const seen = new Set();
    return value.flatMap((candidate) => {
        const record = asRecord(candidate);
        const id = nonEmptyString(record?.id);
        const label = nonEmptyString(record?.label);
        const command = nonEmptyString(record?.command);
        const args = stringArray(record?.args);
        if (!id || !label || !command || !args || seen.has(id))
            return [];
        seen.add(id);
        const env = stringRecord(record?.env);
        return [{ id, label, command, args, ...(env ? { env } : {}) }];
    });
}
function asRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value
        : undefined;
}
function nonEmptyString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function stringArray(value) {
    return Array.isArray(value) && value.every((item) => typeof item === "string")
        ? [...value]
        : undefined;
}
function stringRecord(value) {
    const record = asRecord(value);
    if (!record || Object.values(record).some((item) => typeof item !== "string")) {
        return undefined;
    }
    return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, String(item)]));
}
//# sourceMappingURL=index.js.map