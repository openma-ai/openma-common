/**
 * Builds the launch of an ACP harness for one unattended run from the
 * harness's own recipe (`KnownAgentEntry.headless`). Hosts pass generic
 * options; every flag and variable name comes from the registry entry.
 *
 * Browser-safe (no node deps).
 */

import type { SessionConfigOption } from "@agentclientprotocol/sdk";

import type { KnownAgentEntry } from "./known-agents.js";

export interface AcpHeadlessLaunchOptions {
  /** Directory for the harness's own session files. */
  sessionDir?: string;
  /** The agent's user-level configuration directory. */
  agentDir?: string;
  /** Load project-level resources in the working directory without asking. */
  trustProject?: boolean;
  provider?: string;
  model?: string;
  /**
   * Reasoning effort, in the harness's own vocabulary (for example `medium`).
   * The launch only requests it: a harness may run the model at another level.
   * `resolveAcpHeadlessThinkingLevel` reads the level the session really has.
   */
  thinkingLevel?: string;
}

export type AcpHeadlessLaunchOption = keyof AcpHeadlessLaunchOptions;

export interface AcpHeadlessLaunch {
  /** `spec.args`, then the recipe's fixed flags, then the option flags. */
  args: string[];
  /** `spec.env` plus the variables the options set. */
  env: Record<string, string>;
  /**
   * Requested options the recipe cannot express. The launch does not carry
   * them, so a host that depends on one (isolation, for instance) must stop.
   */
  unsupported: AcpHeadlessLaunchOption[];
}

function definedEnv(
  env: Record<string, string | undefined> | undefined,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env ?? {}).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

export function buildAcpHeadlessLaunch(
  entry: KnownAgentEntry,
  options: AcpHeadlessLaunchOptions = {},
): AcpHeadlessLaunch {
  const recipe = entry.headless;
  if (!recipe) {
    throw new Error(`${entry.label} (${entry.id}) has no headless launch recipe`);
  }
  const args = [...(entry.spec.args ?? []), ...(recipe.args ?? [])];
  const env = definedEnv(entry.spec.env);
  const unsupported: AcpHeadlessLaunchOption[] = [];

  if (options.sessionDir !== undefined) {
    if (recipe.sessionDir) args.push(recipe.sessionDir.flag, options.sessionDir);
    else unsupported.push("sessionDir");
  }
  if (options.agentDir !== undefined) {
    const { flag, env: variable } = recipe.agentDir ?? {};
    if (flag) args.push(flag, options.agentDir);
    if (variable) env[variable] = options.agentDir;
    if (!flag && !variable) unsupported.push("agentDir");
  }
  if (options.trustProject) {
    if (recipe.trustProject) args.push(recipe.trustProject.flag);
    else unsupported.push("trustProject");
  }

  const { model, provider, thinkingLevel } = options;
  if (model !== undefined) {
    if (recipe.model) {
      const { flag, providerSeparator, thinkingSeparator } = recipe.model;
      const prefix =
        provider !== undefined && providerSeparator !== undefined
          ? `${provider}${providerSeparator}`
          : "";
      const suffix =
        thinkingLevel !== undefined && thinkingSeparator !== undefined
          ? `${thinkingSeparator}${thinkingLevel}`
          : "";
      // A model id that already names its provider is not prefixed twice.
      args.push(
        flag,
        `${prefix && !model.startsWith(prefix) ? prefix : ""}${model}${suffix}`,
      );
    } else {
      unsupported.push("model");
    }
  }
  // Provider and thinking level travel inside the model value. Without a
  // model, or without the syntax for them, the launch does not carry them.
  if (provider !== undefined && (model === undefined || recipe.model?.providerSeparator === undefined)) {
    unsupported.push("provider");
  }
  if (thinkingLevel !== undefined && (model === undefined || recipe.model?.thinkingSeparator === undefined)) {
    unsupported.push("thinkingLevel");
  }
  return { args, env, unsupported };
}

export interface AcpHeadlessThinkingLevel {
  /** The level the launch asked for. */
  requested: string;
  /** The level the session runs at. Absent when the session reports none. */
  effective?: string;
  /** Every level the session offers for its model, in the agent's order. */
  available: string[];
  /**
   * `applied`: the session runs at the requested level. `adjusted`: the
   * harness chose another level, because the model does not offer the
   * requested one. `unreported`: the session has no thinking level at all, so
   * the request had no effect.
   */
  status: "applied" | "adjusted" | "unreported";
}

/**
 * Compares the thinking level a headless launch requested with the one the
 * started session reports in its ACP `thought_level` config option. A harness
 * resolves the level against the model's own capabilities and does not fail
 * when it differs, so the launch arguments alone do not say what ran.
 */
export function resolveAcpHeadlessThinkingLevel(
  configOptions: readonly SessionConfigOption[],
  requested: string,
): AcpHeadlessThinkingLevel {
  const option = configOptions.find(
    (candidate) => candidate.type === "select" && candidate.category === "thought_level",
  );
  if (option?.type !== "select") {
    return { requested, available: [], status: "unreported" };
  }
  const available = option.options.flatMap((choice) =>
    "options" in choice ? choice.options.map(({ value }) => value) : [choice.value],
  );
  return {
    requested,
    effective: option.currentValue,
    available,
    status: option.currentValue === requested ? "applied" : "adjusted",
  };
}
