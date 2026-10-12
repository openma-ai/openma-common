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
export declare function buildAcpHeadlessLaunch(entry: KnownAgentEntry, options?: AcpHeadlessLaunchOptions): AcpHeadlessLaunch;
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
export declare function resolveAcpHeadlessThinkingLevel(configOptions: readonly SessionConfigOption[], requested: string): AcpHeadlessThinkingLevel;
//# sourceMappingURL=headless-launch.d.ts.map