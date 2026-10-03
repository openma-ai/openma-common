import { type AcpRelease, type ArtifactOptions } from "../acp-artifacts/index.js";
import type { AcpCatalogHarness } from "./catalog.js";
export type { AcpHarnessInstallSource } from "./source.js";
export type { AcpCatalogHarness } from "./catalog.js";
export { OPENMA_ACP_HARNESS_CATALOG, catalogHarnessById, selectCatalogHarnesses } from "./catalog.js";
export interface AcpHarnessInstallResult {
    id: string;
    label: string;
    version: string;
    command: string;
    args: string[];
    env: Record<string, string>;
    release: AcpRelease;
}
export interface AcpHarnessInstallOptions extends ArtifactOptions {
    /** Directory where harness releases are prepared (idempotent cache root). */
    root: string;
    /** Install every catalog entry when omitted or empty. */
    ids?: readonly string[];
    /** Catalog to install from; defaults to {@link OPENMA_ACP_HARNESS_CATALOG}. */
    catalog?: readonly AcpCatalogHarness[];
}
/** Prepare catalog harnesses into `root` and return launch commands. Idempotent. */
export declare function installAcpHarnesses(options: AcpHarnessInstallOptions): Promise<AcpHarnessInstallResult[]>;
/** Re-run installation for the requested catalog entries (new versions get new digest dirs). */
export declare function upgradeAcpHarnesses(options: AcpHarnessInstallOptions): Promise<AcpHarnessInstallResult[]>;
/** Return a prepared harness when it is already cached under `root`, without network I/O. */
export declare function detectInstalledAcpHarness(entry: AcpCatalogHarness, options: Pick<AcpHarnessInstallOptions, "root"> & Partial<Pick<AcpHarnessInstallOptions, "nodePath" | "npmCliPath" | "env" | "signal">>): Promise<AcpHarnessInstallResult | null>;
//# sourceMappingURL=install.d.ts.map