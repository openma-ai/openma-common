/**
 * Builds the launch of an ACP harness for one unattended run from the
 * harness's own recipe (`KnownAgentEntry.headless`). Hosts pass generic
 * options; every flag and variable name comes from the registry entry.
 *
 * Browser-safe (no node deps).
 */
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
    /** Reasoning effort, in the harness's own vocabulary (for example `medium`). */
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
//# sourceMappingURL=headless-launch.d.ts.map