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