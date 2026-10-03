import type { AcpHarnessInstallSource } from "./source.js";
/** One schema for every managed harness; only `source` varies. */
export interface AcpCatalogHarness {
    id: string;
    label: string;
    /** Exact release version passed to artifact resolution. */
    version: string;
    source: AcpHarnessInstallSource;
    /** Extra argv/env merged onto the prepared launch command (not used for install). */
    launch?: {
        args?: string[];
        env?: Record<string, string>;
    };
}
/**
 * OpenMA-managed harness catalog. All current entries use `{ type: "npm", package }`
 * with versions pinned to npm registry releases verified at catalog update time.
 *
 * All entries use npm; versions and bin names are verified on the npm registry.
 */
export declare const OPENMA_ACP_HARNESS_CATALOG: readonly AcpCatalogHarness[];
export declare function catalogHarnessById(id: string, catalog?: readonly AcpCatalogHarness[]): AcpCatalogHarness | undefined;
export declare function selectCatalogHarnesses(ids: readonly string[] | undefined, catalog?: readonly AcpCatalogHarness[]): AcpCatalogHarness[];
//# sourceMappingURL=catalog.d.ts.map