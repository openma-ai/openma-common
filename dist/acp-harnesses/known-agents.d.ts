/**
 * Static overlay over the official ACP registry.
 *
 * The official registry at
 * https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json is the
 * source of truth for ACP-compatible agents (~35 entries, auto-updated). This
 * file holds only the deltas the desktop needs on top:
 *
 *   1. Featured-agent ordering (the four we promote in the agent picker).
 *   2. Agents not in the official registry yet (hermes, openclaw).
 *
 * Browser-safe (no node deps): the renderer can import this directly when it
 * just needs an entry's display label / install hint without rewinding through
 * IPC. The main process additionally fetches the full official registry at
 * runtime (registry-fetch.ts) and merges.
 */
import type { AgentSpec } from "../acp-runtime/types.js";
export interface KnownAgentRegistryDistribution {
    binary?: Record<string, {
        archive: string;
        cmd: string;
        args?: string[];
        env?: Record<string, string>;
        sha256?: string;
    }>;
    npx?: {
        package: string;
        args?: string[];
        env?: Record<string, string>;
    };
    uvx?: {
        package: string;
        args?: string[];
        env?: Record<string, string>;
    };
}
export interface KnownAgentConfigSelectValue {
    value: string;
    name: string;
    description?: string | null;
}
export interface KnownAgentConfigOption {
    id: string;
    name: string;
    type: "select" | "boolean" | "string";
    category?: string | null;
    description?: string | null;
    currentValue?: string;
    options?: KnownAgentConfigSelectValue[];
}
export interface KnownAgentEntry {
    /** Canonical id used by hosts and dropdowns. Slug-only, no spaces. */
    id: string;
    label: string;
    /** Official registry icon URL, when advertised by the agent. */
    icon?: string;
    spec: AgentSpec;
    /** Registry-advertised version string (semver). Used by
     *  acp-binary-update.ts to compare against the locally-installed
     *  binary's reported version. Optional because overlay entries
     *  (claude-acp, openclaw, …) don't ship versions; only entries that
     *  pass through `mapOfficialAgent` carry one. */
    version?: string;
    installHint?: string;
    homepage?: string;
    /** UI signal: render in the picker's first group. */
    featured?: boolean;
    /** Native ACP CLI supplied by the user's system PATH. Registry-managed
     *  shims are resolved from Backchat's managed ACP bin directory first. */
    systemPath?: boolean;
    /** PATH command used when the managed registry shim is not installed.
     *  `spec.args` are passed to this command. */
    systemCommand?: string;
    /** Public ACP registry id. Used for app-managed installs. */
    registryId?: string;
    /** Exact distribution from the registry snapshot used to render this entry.
     *  Passing it to the installer avoids a second network fetch. */
    registryDistribution?: KnownAgentRegistryDistribution;
    /** Install source for entries Backchat can install into its managed bin dir. */
    installSource?: "registry" | "adapter";
    /** Backchat-hosted executable URL for app-managed adapter installs. */
    downloadUrl?: string;
    /** Only lightweight ACP adapters/shims may be app-managed downloads. */
    downloadKind?: "adapter";
    /** Initial UI seed. Live ACP session config_options override this. */
    configOptions?: KnownAgentConfigOption[];
    /** If set, this entry is an ACP wrapper around a separate upstream binary
     *  (e.g. claude-acp wraps `claude`). Used by the Settings → Agents page to
     *  distinguish "you have claude but need the wrapper" from "the agent
     *  itself isn't installed". */
    wraps?: string;
    /** How to install. `npm` is auto-installable from the UI; `binary` needs the
     *  user to download and place on PATH. */
    install?: {
        kind: "npm";
        package: string;
    } | {
        kind: "binary";
        archives: Partial<Record<string, {
            url: string;
            cmd: string;
        }>>;
        downloadUrl?: string;
    };
}
export declare function registryShimName(id: string): string;
export declare const OVERLAY_AGENTS: KnownAgentEntry[];
export declare function resolveOverlayAgent(id: string): KnownAgentEntry | null;
//# sourceMappingURL=known-agents.d.ts.map