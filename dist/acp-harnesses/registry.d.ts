/**
 * Agent registry — merges the official ACP registry with the desktop's static
 * overlay, exposes a sync `which`-style detector.
 *
 * Two layers:
 *   - **overlay** (known-agents.ts): hand-curated featured entries plus a few
 *     agents the official registry doesn't carry (hermes, openclaw).
 *   - **official** (registry-fetch.ts): live JSON from
 *     cdn.agentclientprotocol.com, fetched once at startup, cached to disk.
 *
 * Detection rule: registry-managed entries resolve from Backchat's managed
 * ACP bin directory. Only entries marked systemPath, plus custom overrides,
 * fall back to the user's system PATH.
 *
 * Vendored from @open-managed-agents/acp-runtime (Apache-2.0).
 */
import { type KnownAgentEntry } from "./known-agents.js";
export { OVERLAY_AGENTS, registryShimName, resolveOverlayAgent, type KnownAgentEntry, } from "./known-agents.js";
export interface ResolveAgentCommandOptions {
    env?: NodeJS.ProcessEnv;
    systemPathFallbackDirs?: string[];
    managedBinDirs?: string[];
}
export declare function loadRegistry(opts?: {
    cachePath?: string;
    ttlMs?: number;
    forceRefresh?: boolean;
    cacheOnly?: boolean;
}): Promise<KnownAgentEntry[]>;
export declare function getKnownAgents(): readonly KnownAgentEntry[];
export declare function resolveKnownAgent(id: string): KnownAgentEntry | null;
export declare function _resetRegistryCache(): void;
export declare function detect(id: string, options?: ResolveAgentCommandOptions): Promise<KnownAgentEntry | null>;
export declare function detectEntry(entry: KnownAgentEntry, options?: ResolveAgentCommandOptions): Promise<KnownAgentEntry | null>;
export declare function detectAll(options?: ResolveAgentCommandOptions): Promise<KnownAgentEntry[]>;
//# sourceMappingURL=registry.d.ts.map