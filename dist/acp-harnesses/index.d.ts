export type { AcpHarnessInstallSource } from "./source.js";
export type { AcpCatalogHarness } from "./catalog.js";
export { OPENMA_ACP_HARNESS_CATALOG, catalogHarnessById, selectCatalogHarnesses } from "./catalog.js";
export interface AcpHarnessSpec {
    /** Stable id persisted by products and attached to sessions. */
    id: string;
    label: string;
    command: string;
    args: string[];
    env?: Record<string, string>;
}
/**
 * Browser-safe baseline catalog for OpenMA products that launch ACP agents
 * from the user's PATH. Products may append or replace entries when they also
 * implement managed installation or registry discovery.
 */
export declare const DEFAULT_ACP_HARNESSES: readonly AcpHarnessSpec[];
export declare function cloneAcpHarnesses(harnesses: readonly AcpHarnessSpec[]): AcpHarnessSpec[];
/** Safely restores a persisted product-owned harness catalog. */
export declare function normalizeAcpHarnesses(value: unknown): AcpHarnessSpec[];
//# sourceMappingURL=index.d.ts.map