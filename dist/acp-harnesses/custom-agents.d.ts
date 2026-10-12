/**
 * Custom ACP agent definitions shared under `~/.oma` (OpenMA root).
 *
 * The single shared store is `~/.oma/config.toml` `[[agents]]` — Backchat's
 * per-agent override format: one row per agent holding `id`, optional
 * `enabled`, `env = [{name, value}]` pairs, and — for custom agents —
 * `command_override`, `args_override`, `label_override`. A row *is* a
 * custom agent definition iff it carries `command_override`; rows with only
 * `enabled`/`env` tune registry agents and stay product-local.
 *
 * Definitions surface in the `AcpHarnessSpec` shape (`id`, `label`,
 * `command`, `args`, optional `env`) plus the optional `enabled` flag the
 * store carries, so a disabled custom agent stays disabled instead of
 * silently reappearing.
 *
 * Versions the user writes in `args` (for example `@openma/pi-acp@beta`)
 * are kept exactly as written: nothing here rewrites pins or tags.
 *
 * Martty's legacy `~/.oma/settings.json` `harnesses[]` still read through
 * for compatibility; every write migrates them into `config.toml` and
 * removes the `harnesses` key, so removed or replaced definitions cannot
 * resurface from the old file.
 *
 * Write paths refuse to touch a `config.toml` that does not parse — they
 * throw instead of clobbering a file the user may have hand-edited. Only a
 * missing file counts as empty. Writes preserve every unrelated key and
 * section (the file is reserialized, comments outside the leading header
 * are not kept — the same trade-off Backchat's own writer makes).
 */
import type { AcpHarnessSpec } from "./index.js";
/** A custom agent definition: the canonical shape plus the store's enabled flag. */
export type CustomAcpAgent = AcpHarnessSpec & {
    /** `false` keeps the definition but disables the agent locally. */
    enabled?: boolean;
};
export declare const OMA_CONFIG_FILENAME = "config.toml";
export declare const OMA_SETTINGS_FILENAME = "settings.json";
export declare function customAcpAgentsConfigPath(omaDir: string): string;
/**
 * Strict validation for definitions a caller wants to persist. Throws with
 * the first violated rule; stored reads use {@link normalizeCustomAcpAgent}
 * instead, which drops malformed rows instead of failing the whole file.
 */
export declare function validateCustomAcpAgent(value: unknown): CustomAcpAgent;
/** Forgiving read of one stored definition. Returns `undefined` for malformed rows. */
export declare function normalizeCustomAcpAgent(value: unknown): CustomAcpAgent | undefined;
/** Forgiving read of a stored definition list; first row wins per `id`. */
export declare function normalizeCustomAcpAgents(value: unknown): CustomAcpAgent[];
/** Merge definition lists, keeping the first occurrence of each `id`. */
export declare function mergeCustomAcpAgents(...lists: readonly CustomAcpAgent[][]): CustomAcpAgent[];
/** The definition a `config.toml` `[[agents]]` row carries, if it is one. */
export declare function customAcpAgentFromConfigTomlRow(row: unknown): CustomAcpAgent | undefined;
/** The `[[agents]]` row a definition writes back as. */
export declare function configTomlRowFromCustomAcpAgent(agent: CustomAcpAgent): Record<string, unknown>;
/**
 * Custom agents inside a parsed Backchat `config.toml`: `[[agents]]` rows
 * with `command_override`, each carrying its `enabled` flag through.
 */
export declare function customAcpAgentsFromConfigToml(config: unknown): CustomAcpAgent[];
/**
 * Custom agents inside a parsed Martty `settings.json`: the `harnesses[]`
 * rows are already the canonical shape, so this only validates.
 */
export declare function customAcpAgentsFromSettingsJson(settings: unknown): CustomAcpAgent[];
/**
 * Every custom agent definition under `omaDir`: `config.toml` first, then
 * Martty's `settings.json` leftovers for back-compatibility, deduplicated by
 * `id`. Throws when `config.toml` exists but does not parse — a corrupt
 * file is user data, not an empty store.
 */
export declare function readCustomAcpAgents(omaDir: string): CustomAcpAgent[];
/**
 * Move every `settings.json` `harnesses[]` definition into `config.toml`
 * (idempotent; rows already defined there win). Returns whether it wrote.
 */
export declare function migrateLegacyAcpAgents(omaDir: string): boolean;
/** Insert or replace one definition. Returns the stored list. */
export declare function upsertCustomAcpAgent(omaDir: string, agent: unknown): CustomAcpAgent[];
/** Remove one definition. Returns the stored list. */
export declare function removeCustomAcpAgent(omaDir: string, id: string): CustomAcpAgent[];
//# sourceMappingURL=custom-agents.d.ts.map