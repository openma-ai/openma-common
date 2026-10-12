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
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, win32 } from "node:path";
import { parse as parseToml } from "smol-toml";
export const OMA_AGENTS_FILENAME = "agents.json";
/** File name of Backchat's settings inside the shared OpenMA root. */
export const OMA_CONFIG_FILENAME = "config.toml";
/** File name of Martty's settings inside the shared OpenMA root. */
export const OMA_SETTINGS_FILENAME = "settings.json";
export function customAcpAgentsPath(omaDir) {
    return join(omaDir, OMA_AGENTS_FILENAME);
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
    return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, String(item)]));
}
function serialize(agent) {
    return {
        id: agent.id,
        label: agent.label,
        command: agent.command,
        args: [...agent.args],
        ...(agent.env && Object.keys(agent.env).length > 0 ? { env: { ...agent.env } } : {}),
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
    const env = stringRecord(record.env);
    return serialize({
        id,
        label: nonEmptyString(record.label) ?? id,
        command,
        args,
        ...(env ? { env } : {}),
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
// Compatible reads of the product-owned files
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
/** Backchat writes env either as `env = [{name, value}]` rows or an inline table. */
function envFromConfigToml(value) {
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
/**
 * Custom agents inside a parsed Backchat `config.toml`: `[[agents]]` rows
 * are per-agent overrides — only rows with `command_override` describe a
 * custom agent; rows with just `enabled`/`env` tune registry agents and
 * stay product-local.
 */
export function customAcpAgentsFromConfigToml(config) {
    const agents = asRecord(config)?.agents;
    if (!Array.isArray(agents))
        return [];
    const seen = new Set();
    return agents.flatMap((entry) => {
        const record = asRecord(entry);
        const id = nonEmptyString(record?.id);
        const command = nonEmptyString(record?.command_override);
        if (!record || !id || !command || seen.has(id))
            return [];
        const args = record.args_override === undefined ? [] : stringArray(record.args_override);
        if (!args)
            return [];
        seen.add(id);
        const env = envFromConfigToml(record.env);
        return [serialize({
                id,
                label: nonEmptyString(record.label_override) ?? id,
                command,
                args,
                ...(env ? { env } : {}),
            })];
    });
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
function readTomlFile(path) {
    try {
        return parseToml(readFileSync(path, "utf8"));
    }
    catch {
        return undefined;
    }
}
/** Definitions in `<oma>/agents.json` — the canonical shared store. */
export function readCustomAcpAgentsFile(omaDir) {
    const value = readJsonFile(customAcpAgentsPath(omaDir));
    const agents = Array.isArray(value) ? value : asRecord(value)?.agents;
    return normalizeCustomAcpAgents(agents);
}
/**
 * Every custom agent definition under `omaDir`: `agents.json` first, then
 * the Backchat `config.toml` overrides and Martty `settings.json`
 * `harnesses[]` for back-compatibility, deduplicated by `id`.
 */
export function readCustomAcpAgents(omaDir) {
    return mergeCustomAcpAgents(readCustomAcpAgentsFile(omaDir), customAcpAgentsFromConfigToml(readTomlFile(join(omaDir, OMA_CONFIG_FILENAME))), customAcpAgentsFromSettingsJson(readJsonFile(join(omaDir, OMA_SETTINGS_FILENAME))));
}
/** Atomically rewrite `agents.json` (temp file + rename). */
export function writeCustomAcpAgentsFile(omaDir, agents) {
    const normalized = agents.map(validateCustomAcpAgent);
    const path = customAcpAgentsPath(omaDir);
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify({ version: 1, agents: normalized }, null, 2)}\n`);
    renameSync(temporary, path);
}
/** Insert or replace one definition in `agents.json`. Returns the stored list. */
export function upsertCustomAcpAgent(omaDir, agent) {
    const next = validateCustomAcpAgent(agent);
    const agents = readCustomAcpAgentsFile(omaDir);
    const index = agents.findIndex((candidate) => candidate.id === next.id);
    if (index === -1)
        agents.push(next);
    else
        agents[index] = next;
    writeCustomAcpAgentsFile(omaDir, agents);
    return agents;
}
/** Remove one definition from `agents.json`. Returns the stored list. */
export function removeCustomAcpAgent(omaDir, id) {
    const agents = readCustomAcpAgentsFile(omaDir).filter((agent) => agent.id !== id);
    writeCustomAcpAgentsFile(omaDir, agents);
    return agents;
}
//# sourceMappingURL=custom-agents.js.map