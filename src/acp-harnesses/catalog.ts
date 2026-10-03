import type { AcpHarnessInstallSource } from "./source.js";

/** One schema for every managed harness; only `source` varies. */
export interface AcpCatalogHarness {
  id: string;
  label: string;
  /** Exact release version passed to artifact resolution. */
  version: string;
  source: AcpHarnessInstallSource;
  /** Extra argv/env merged onto the prepared launch command (not used for install). */
  launch?: { args?: string[]; env?: Record<string, string> };
}

/**
 * OpenMA-managed harness catalog. Upstream agents use `{ type: "registry" }` and
 * resolve launch metadata from the public ACP registry at install time.
 * OpenMA-owned adapters use pinned `{ type: "npm", package }` releases.
 */
export const OPENMA_ACP_HARNESS_CATALOG: readonly AcpCatalogHarness[] = [
  {
    id: "codex-acp",
    label: "Codex",
    version: "2.1.1",
    source: { type: "registry" },
  },
  {
    id: "claude-acp",
    label: "Claude",
    version: "0.85.1",
    source: { type: "registry" },
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    version: "0.62.0",
    source: { type: "registry" },
  },
  {
    id: "opencode",
    label: "OpenCode",
    version: "1.18.34",
    source: { type: "registry" },
  },
  {
    id: "kimi",
    label: "Kimi Code",
    version: "1.52.0",
    source: { type: "registry" },
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
] as const;

export function catalogHarnessById(
  id: string,
  catalog: readonly AcpCatalogHarness[] = OPENMA_ACP_HARNESS_CATALOG,
): AcpCatalogHarness | undefined {
  return catalog.find((entry) => entry.id === id);
}

export function selectCatalogHarnesses(
  ids: readonly string[] | undefined,
  catalog: readonly AcpCatalogHarness[] = OPENMA_ACP_HARNESS_CATALOG,
): AcpCatalogHarness[] {
  if (!ids || ids.length === 0) return [...catalog];
  const wanted = new Set(ids);
  const selected = catalog.filter((entry) => wanted.has(entry.id));
  const missing = ids.filter((id) => !selected.some((entry) => entry.id === id));
  if (missing.length > 0) {
    throw new Error(`Unknown catalog harness id(s): ${missing.join(", ")}`);
  }
  return selected;
}
