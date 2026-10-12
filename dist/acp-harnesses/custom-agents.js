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
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, win32 } from "node:path";
import { parse as parseToml, stringify as toToml } from "smol-toml";
export const OMA_CONFIG_FILENAME = "config.toml";
export const OMA_SETTINGS_FILENAME = "settings.json";
export function customAcpAgentsConfigPath(omaDir) {
    return join(omaDir, OMA_CONFIG_FILENAME);
}
// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
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
    return { ...record };
}
function serialize(agent) {
    return {
        id: agent.id,
        label: agent.label,
        command: agent.command,
        args: [...agent.args],
        ...(agent.env !== undefined ? { env: { ...agent.env } } : {}),
        ...(agent.enabled !== undefined ? { enabled: agent.enabled } : {}),
    };
}
/**
 * Strict validation for definitions a caller wants to persist. Throws with
 * the first violated rule; stored reads use {@link normalizeCustomAcpAgent}
 * instead, which drops malformed rows instead of failing the whole file.
 */
export function validateCustomAcpAgent(value) {
    const record = asRecord(value);
    if (!record)
        throw new Error("custom ACP agent must be an object");
    const id = nonEmptyString(record.id);
    if (!id)
        throw new Error("custom ACP agent id must be a non-empty string");
    const command = nonEmptyString(record.command);
    if (!command)
        throw new Error(`custom ACP agent ${id}: command must be a non-empty string`);
    const args = record.args === undefined ? [] : stringArray(record.args);
    if (!args)
        throw new Error(`custom ACP agent ${id}: args must be an array of strings`);
    if (record.env !== undefined && !stringRecord(record.env)) {
        throw new Error(`custom ACP agent ${id}: env must be an object of strings`);
    }
    if (record.enabled !== undefined && typeof record.enabled !== "boolean") {
        throw new Error(`custom ACP agent ${id}: enabled must be a boolean`);
    }
    const env = stringRecord(record.env);
    return serialize({
        id,
        label: nonEmptyString(record.label) ?? id,
        command,
        args,
        ...(env !== undefined ? { env } : {}),
        ...(typeof record.enabled === "boolean" ? { enabled: record.enabled } : {}),
    });
}
/** Forgiving read of one stored definition. Returns `undefined` for malformed rows. */
export function normalizeCustomAcpAgent(value) {
    try {
        return validateCustomAcpAgent(value);
    }
    catch {
        return undefined;
    }
}
/** Forgiving read of a stored definition list; first row wins per `id`. */
export function normalizeCustomAcpAgents(value) {
    if (!Array.isArray(value))
        return [];
    const seen = new Set();
    return value.flatMap((candidate) => {
        const agent = normalizeCustomAcpAgent(candidate);
        if (!agent || seen.has(agent.id))
            return [];
        seen.add(agent.id);
        return [agent];
    });
}
/** Merge definition lists, keeping the first occurrence of each `id`. */
export function mergeCustomAcpAgents(...lists) {
    const seen = new Set();
    return lists.flat().flatMap((agent) => {
        if (seen.has(agent.id))
            return [];
        seen.add(agent.id);
        return [serialize(agent)];
    });
}
// ---------------------------------------------------------------------------
// Row <-> definition mapping (config.toml override format)
// ---------------------------------------------------------------------------
function envPairsFromRow(value) {
    const table = stringRecord(value);
    if (table)
        return table;
    if (!Array.isArray(value))
        return undefined;
    const entries = value.flatMap((pair) => {
        const item = asRecord(pair);
        const name = nonEmptyString(item?.name);
        return name && typeof item?.value === "string" ? [[name, item.value]] : [];
    });
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
/** The definition a `config.toml` `[[agents]]` row carries, if it is one. */
export function customAcpAgentFromConfigTomlRow(row) {
    const record = asRecord(row);
    const id = nonEmptyString(record?.id);
    const command = nonEmptyString(record?.command_override);
    if (!record || !id || !command)
        return undefined;
    const args = record.args_override === undefined ? [] : stringArray(record.args_override);
    if (!args)
        return undefined;
    const env = envPairsFromRow(record.env);
    return serialize({
        id,
        label: nonEmptyString(record.label_override) ?? id,
        command,
        args,
        ...(env ? { env } : {}),
        ...(typeof record.enabled === "boolean" ? { enabled: record.enabled } : {}),
    });
}
/** The `[[agents]]` row a definition writes back as. */
export function configTomlRowFromCustomAcpAgent(agent) {
    return {
        id: agent.id,
        ...(agent.enabled !== undefined ? { enabled: agent.enabled } : {}),
        ...(agent.label !== agent.id ? { label_override: agent.label } : {}),
        command_override: agent.command,
        ...(agent.args.length > 0 ? { args_override: [...agent.args] } : {}),
        ...(agent.env !== undefined
            ? { env: Object.entries(agent.env).map(([name, value]) => ({ name, value })) }
            : {}),
    };
}
/**
 * Custom agents inside a parsed Backchat `config.toml`: `[[agents]]` rows
 * with `command_override`, each carrying its `enabled` flag through.
 */
export function customAcpAgentsFromConfigToml(config) {
    const agents = asRecord(config)?.agents;
    if (!Array.isArray(agents))
        return [];
    const seen = new Set();
    return agents.flatMap((row) => {
        const agent = customAcpAgentFromConfigTomlRow(row);
        if (!agent || seen.has(agent.id))
            return [];
        seen.add(agent.id);
        return [agent];
    });
}
// ---------------------------------------------------------------------------
// Compatible reads of Martty's legacy settings.json
// ---------------------------------------------------------------------------
// Rows Martty wrote before the shared store may carry runner flags it added
// itself; they are dropped on read so the launch argv stays clean. Versions
// and tags inside args are never touched.
const NPM_RUNNER = /^npx(?:\.(?:cmd|bat|exe))?$/i;
const LEGACY_NPX_FLAGS = new Set(["--yes", "--prefer-offline"]);
function marttyLegacyNpxArgs(agent) {
    if (!NPM_RUNNER.test(win32.basename(agent.command)))
        return agent;
    const args = agent.args.filter((arg) => !LEGACY_NPX_FLAGS.has(arg));
    return args.length === agent.args.length ? agent : { ...agent, args };
}
/**
 * Custom agents inside a parsed Martty `settings.json`: the `harnesses[]`
 * rows are already the canonical shape, so this only validates.
 */
export function customAcpAgentsFromSettingsJson(settings) {
    return normalizeCustomAcpAgents(asRecord(settings)?.harnesses).map(marttyLegacyNpxArgs);
}
// ---------------------------------------------------------------------------
// File IO
// ---------------------------------------------------------------------------
function readJsonFile(path) {
    try {
        return JSON.parse(readFileSync(path, "utf8"));
    }
    catch {
        return undefined;
    }
}
// smol-toml's parse yields the root table or throws; the caller decides
// whether a missing file (ENOENT handled upstream) or a corrupt file counts.
function readConfigToml(path) {
    return parseToml(readFileSync(path, "utf8"));
}
function writeAtomic(path, content) {
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(temporary, content);
    renameSync(temporary, path);
}
// Leading comment lines (Backchat's file header) survive a reserialize;
// everything else unrelated does by virtue of the parsed object.
function leadingComments(raw) {
    const lines = raw.split("\n");
    let end = 0;
    while (end < lines.length && (lines[end].startsWith("#") || !lines[end].trim()))
        end += 1;
    return lines.slice(0, end).join("\n");
}
/**
 * Every custom agent definition under `omaDir`: `config.toml` first, then
 * Martty's `settings.json` leftovers for back-compatibility, deduplicated by
 * `id`. Throws when `config.toml` exists but does not parse — a corrupt
 * file is user data, not an empty store.
 */
export function readCustomAcpAgents(omaDir) {
    const path = customAcpAgentsConfigPath(omaDir);
    const config = existsSync(path) ? readConfigToml(path) : {};
    return mergeCustomAcpAgents(customAcpAgentsFromConfigToml(config), customAcpAgentsFromSettingsJson(readJsonFile(join(omaDir, OMA_SETTINGS_FILENAME))));
}
/**
 * Rewrite the shared definitions: parse `config.toml` (refusing a corrupt
 * file), fold in any `settings.json` `harnesses[]`, apply `mutate`, then
 * write both files back — `config.toml` gets the merged `[[agents]]` rows
 * (every other key and section untouched) and `settings.json` loses its
 * migrated `harnesses` key so removed definitions cannot resurface.
 */
function rewriteSharedAgents(omaDir, mutate) {
    const configPath = customAcpAgentsConfigPath(omaDir);
    const raw = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
    const config = raw ? readConfigToml(configPath) : {};
    const settings = readJsonFile(join(omaDir, OMA_SETTINGS_FILENAME));
    const stored = mergeCustomAcpAgents(customAcpAgentsFromConfigToml(config), customAcpAgentsFromSettingsJson(settings));
    const next = mutate(stored);
    const nextById = new Map(next.map((agent) => [agent.id, agent]));
    const rows = Array.isArray(config.agents) ? config.agents : [];
    const rewrittenIds = new Set();
    const outRows = [];
    for (const row of rows) {
        const record = asRecord(row);
        const id = nonEmptyString(record?.id);
        if (!record || !id || rewrittenIds.has(id)) {
            outRows.push(row); // unparsed or duplicate-id rows stay byte-equivalent
            continue;
        }
        rewrittenIds.add(id);
        const agent = nextById.get(id);
        if (!agent) {
            // The definition was removed: drop the command keys but keep
            // product-local flags (enabled/env) when they are all that is left.
            const { command_override: _c, args_override: _a, label_override: _l, ...residual } = record;
            if (Object.keys(residual).length > 1)
                outRows.push(residual);
            continue;
        }
        // The definition wins command/label/args; `enabled` and `env` fall back
        // to what the row already carried when the definition does not set them.
        const enabled = agent.enabled ?? (typeof record.enabled === "boolean" ? record.enabled : undefined);
        outRows.push({
            id,
            ...(enabled !== undefined ? { enabled } : {}),
            ...(agent.label !== id ? { label_override: agent.label } : {}),
            command_override: agent.command,
            ...(agent.args.length > 0 ? { args_override: [...agent.args] } : {}),
            ...(agent.env !== undefined
                ? { env: Object.entries(agent.env).map(([name, value]) => ({ name, value })) }
                : record.env !== undefined ? { env: record.env } : {}),
        });
    }
    for (const agent of next) {
        if (!rewrittenIds.has(agent.id))
            outRows.push(configTomlRowFromCustomAcpAgent(agent));
    }
    const comments = leadingComments(raw);
    writeAtomic(configPath, `${comments}${toToml({ ...config, agents: outRows })}\n`);
    const settingsRecord = asRecord(settings);
    if (settingsRecord && Array.isArray(settingsRecord.harnesses)) {
        const { harnesses: _migrated, ...rest } = settingsRecord;
        writeAtomic(join(omaDir, OMA_SETTINGS_FILENAME), `${JSON.stringify(rest, null, 2)}\n`);
    }
    return next;
}
/**
 * Move every `settings.json` `harnesses[]` definition into `config.toml`
 * (idempotent; rows already defined there win). Returns whether it wrote.
 */
export function migrateLegacyAcpAgents(omaDir) {
    const settings = readJsonFile(join(omaDir, OMA_SETTINGS_FILENAME));
    if (!Array.isArray(asRecord(settings)?.harnesses))
        return false;
    rewriteSharedAgents(omaDir, (agents) => agents);
    return true;
}
/** Insert or replace one definition. Returns the stored list. */
export function upsertCustomAcpAgent(omaDir, agent) {
    const next = validateCustomAcpAgent(agent);
    return rewriteSharedAgents(omaDir, (agents) => {
        const index = agents.findIndex((candidate) => candidate.id === next.id);
        if (index === -1)
            return [...agents, next];
        return agents.map((candidate) => (candidate.id === next.id ? next : candidate));
    });
}
/** Remove one definition. Returns the stored list. */
export function removeCustomAcpAgent(omaDir, id) {
    return rewriteSharedAgents(omaDir, (agents) => agents.filter((agent) => agent.id !== id));
}
//# sourceMappingURL=custom-agents.js.map