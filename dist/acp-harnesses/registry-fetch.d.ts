/**
 * Official ACP Registry — fetch, cache, and map to our internal shape.
 *
 * Source of truth: https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json
 * Maintained by the ACP project (Apache 2.0). Auto-updated hourly by their CI
 * when upstream agents publish new versions.
 *
 *   1. App startup: try to fetch the official JSON. Cache to disk with
 *      `fetchedAt`.
 *   2. Subsequent loads: serve from cache while it's fresh (1h matches
 *      their cron).
 *   3. Network failure: keep using stale cache forever.
 *   4. Cold start with no cache and no network: caller falls back to the
 *      static overlay (see registry.ts:loadRegistry).
 *
 * Vendored from @open-managed-agents/acp-runtime (Apache-2.0).
 */
import { type KnownAgentEntry, type KnownAgentRegistryDistribution } from "./known-agents.js";
export interface OfficialRegistryAgent {
    id: string;
    name: string;
    icon?: string;
    version?: string;
    description?: string;
    repository?: string;
    website?: string;
    license?: string;
    distribution: KnownAgentRegistryDistribution;
}
interface OfficialRegistry {
    version: number;
    agents: OfficialRegistryAgent[];
    extensions?: unknown[];
}
export declare function fetchOfficialRegistry(opts?: {
    cachePath?: string;
    ttlMs?: number;
    cacheOnly?: boolean;
}): Promise<OfficialRegistry>;
export declare function mapOfficialAgent(o: OfficialRegistryAgent): KnownAgentEntry | null;
export {};
//# sourceMappingURL=registry-fetch.d.ts.map