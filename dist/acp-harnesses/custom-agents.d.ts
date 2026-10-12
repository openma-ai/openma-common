/**
 * Custom ACP agent definitions shared under `~/.oma` (OpenMA root).
 *
 * Canonical store: `<oma>/agents.json`
 *
 * ```json
 * { "version": 1, "agents": [{ "id", "label", "command", "args", "env" }] }
 * ```
 *
 * One definition per agent — the same shape as `AcpHarnessSpec` (and Zed's
 * `agent_servers`): `id`, `label`, `command`, `args`, optional `env`.
 * Versions the user writes in `args` (for example `@openma/pi-acp@beta`)
 * are kept exactly as written: nothing here rewrites pins or tags.
 *
 * Existing product files keep working through compatible reads:
 * `~/.oma/config.toml` `[[agents]]` rows that carry `command_override`
 * (Backchat) and `~/.oma/settings.json` `harnesses[]` rows (Martty) still
 * produce definitions. They merge with `agents.json`, deduplicated by
 * `id` — the canonical file wins. Writes always go to `agents.json`.
 */
import type { AcpHarnessSpec } from "./index.js";
export declare const OMA_AGENTS_FILENAME = "agents.json";
/** File name of Backchat's settings inside the shared OpenMA root. */
export declare const OMA_CONFIG_FILENAME = "config.toml";
/** File name of Martty's settings inside the shared OpenMA root. */
export declare const OMA_SETTINGS_FILENAME = "settings.json";
export declare function customAcpAgentsPath(omaDir: string): string;
/**
 * Strict validation for definitions a caller wants to persist. Throws with
 * the first violated rule; stored reads use {@link normalizeCustomAcpAgent}
 * instead, which drops malformed rows instead of failing the whole file.
 */
export declare function validateCustomAcpAgent(value: unknown): AcpHarnessSpec;
/** Forgiving read of one stored definition. Returns `undefined` for malformed rows. */
export declare function normalizeCustomAcpAgent(value: unknown): AcpHarnessSpec | undefined;
/** Forgiving read of a stored definition list; first row wins per `id`. */
export declare function normalizeCustomAcpAgents(value: unknown): AcpHarnessSpec[];
/** Merge definition lists, keeping the first occurrence of each `id`. */
export declare function mergeCustomAcpAgents(...lists: readonly AcpHarnessSpec[][]): AcpHarnessSpec[];
/**
 * Custom agents inside a parsed Martty `settings.json`: the `harnesses[]`
 * rows are already the canonical shape, so this only validates.
 */
export declare function customAcpAgentsFromSettingsJson(settings: unknown): AcpHarnessSpec[];
/**
 * Custom agents inside a parsed Backchat `config.toml`: `[[agents]]` rows
 * are per-agent overrides — only rows with `command_override` describe a
 * custom agent; rows with just `enabled`/`env` tune registry agents and
 * stay product-local.
 */
export declare function customAcpAgentsFromConfigToml(config: unknown): AcpHarnessSpec[];
/** Definitions in `<oma>/agents.json` — the canonical shared store. */
export declare function readCustomAcpAgentsFile(omaDir: string): AcpHarnessSpec[];
/**
 * Every custom agent definition under `omaDir`: `agents.json` first, then
 * the Backchat `config.toml` overrides and Martty `settings.json`
 * `harnesses[]` for back-compatibility, deduplicated by `id`.
 */
export declare function readCustomAcpAgents(omaDir: string): AcpHarnessSpec[];
/** Atomically rewrite `agents.json` (temp file + rename). */
export declare function writeCustomAcpAgentsFile(omaDir: string, agents: readonly AcpHarnessSpec[]): void;
/** Insert or replace one definition in `agents.json`. Returns the stored list. */
export declare function upsertCustomAcpAgent(omaDir: string, agent: unknown): AcpHarnessSpec[];
/** Remove one definition from `agents.json`. Returns the stored list. */
export declare function removeCustomAcpAgent(omaDir: string, id: string): AcpHarnessSpec[];
//# sourceMappingURL=custom-agents.d.ts.map