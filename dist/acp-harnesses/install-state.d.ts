import type { KnownAgentEntry } from "./known-agents.js";
/** Harness ids whose latest version comes from npm, not the public ACP registry snapshot. */
export declare const OPENMA_NPM_HARNESS_IDS: Set<string>;
export interface AcpHarnessInstallState {
    installed: boolean;
    installedVersion?: string;
    latestVersion?: string;
    updateAvailable?: boolean;
}
export interface ReadAcpHarnessInstallStateOptions {
    entry: KnownAgentEntry;
    binDir: string;
    installRoot?: string;
    fetchImpl?: typeof fetch;
    npmRegistryUrls?: string[];
}
export declare function usesOpenMaNpmLatestSource(entry: KnownAgentEntry): boolean;
export declare function readAcpHarnessInstallState(options: ReadAcpHarnessInstallStateOptions): Promise<AcpHarnessInstallState>;
export interface AcpHarnessPinState {
    package: {
        name: string;
        pinned: string;
        installed?: string;
    };
    dependencies: Array<{
        name: string;
        pinned: string;
        installed?: string;
    }>;
    /** Every pinned package is installed at exactly its pinned version. */
    satisfied: boolean;
}
/**
 * Compares the install a managed shim points at with the exact versions the
 * registry entry pins. Reads only local files. Null when the entry pins
 * nothing.
 */
export declare function readAcpHarnessPinState(options: {
    entry: KnownAgentEntry;
    shimPath: string;
}): Promise<AcpHarnessPinState | null>;
export declare function npmPackageNameFromSpec(packageSpec: string): string;
export declare function npmVersionFromSpec(packageSpec: string): string | undefined;
export declare function latestNpmPackageVersion(packageName: string, options?: {
    fetchImpl?: typeof fetch;
    npmRegistryUrls?: string[];
}): Promise<string | undefined>;
export declare function readInstalledNpmPackageVersion(options: {
    shimPath: string;
    packageName: string;
    installRoot?: string;
    registryId?: string;
}): Promise<string | undefined>;
export declare function installedNpmPackageVersionFromShim(shimPath: string, packageName: string): Promise<string | undefined>;
export declare function isStrictlyNewerVersion(candidate?: string, current?: string): boolean;
//# sourceMappingURL=install-state.d.ts.map