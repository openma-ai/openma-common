/**
 * OpenMA-managed harness catalog. All current entries use `{ type: "npm", package }`
 * with versions pinned to npm registry releases verified at catalog update time.
 *
 * All entries use npm; versions and bin names are verified on the npm registry.
 */
export const OPENMA_ACP_HARNESS_CATALOG = [
    {
        id: "codex-acp",
        label: "Codex",
        version: "2.1.1",
        source: { type: "npm", package: "@agentclientprotocol/codex-acp" },
    },
    {
        id: "claude-acp",
        label: "Claude",
        version: "0.85.1",
        source: { type: "npm", package: "@agentclientprotocol/claude-agent-acp" },
    },
    {
        id: "gemini",
        label: "Gemini CLI",
        version: "0.62.0",
        source: { type: "npm", package: "@google/gemini-cli" },
        launch: { args: ["--acp"] },
    },
    {
        id: "opencode",
        label: "OpenCode",
        version: "1.18.34",
        source: { type: "npm", package: "opencode-ai" },
        launch: { args: ["acp"] },
    },
    {
        id: "kimi",
        label: "Kimi Code",
        version: "2.1.1",
        source: { type: "npm", package: "@moonshot-ai/kimi-code" },
        launch: { args: ["acp"] },
    },
    {
        id: "dsh-acp",
        label: "DeepSeek Harness",
        version: "0.4.37",
        source: { type: "npm", package: "@openma/deepseek-harness-acp" },
    },
    {
        id: "pi-acp",
        label: "Pi",
        version: "0.1.6",
        source: { type: "npm", package: "@openma/pi-acp" },
    },
];
export function catalogHarnessById(id, catalog = OPENMA_ACP_HARNESS_CATALOG) {
    return catalog.find((entry) => entry.id === id);
}
export function selectCatalogHarnesses(ids, catalog = OPENMA_ACP_HARNESS_CATALOG) {
    if (!ids || ids.length === 0)
        return [...catalog];
    const wanted = new Set(ids);
    const selected = catalog.filter((entry) => wanted.has(entry.id));
    const missing = ids.filter((id) => !selected.some((entry) => entry.id === id));
    if (missing.length > 0) {
        throw new Error(`Unknown catalog harness id(s): ${missing.join(", ")}`);
    }
    return selected;
}
//# sourceMappingURL=catalog.js.map