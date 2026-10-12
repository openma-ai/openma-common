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
/** Orders by UTF-16 code unit, the same on every machine. `localeCompare` follows the host locale. */
export declare function compareCodePoints(left: string, right: string): number;
export declare function isExactVersion(version: string | undefined): version is string;
/** Dependency pins in a stable order. Throws when one is not an exact version. */
export declare function exactDependencyPins(pins: Record<string, string> | undefined): Array<[string, string]>;
export interface AcpHarnessPinnedPackages {
    package: {
        name: string;
        version: string;
    };
    dependencies: Array<[string, string]>;
}
/**
 * The exact versions an entry pins. Throws when the entry pins nothing or
 * names anything other than an exact version: the installer and the state
 * reader refuse the same input.
 */
export declare function acpHarnessPinnedPackages(entry: KnownAgentEntry): AcpHarnessPinnedPackages;
/**
 * Where a pinned install lives. Its launcher name and its state directory
 * differ from the product install's, so the two can share one bin directory
 * and install root without overwriting each other.
 */
export declare function pinnedAcpHarnessPaths(entry: KnownAgentEntry, binDir: string, options?: {
    platform?: NodeJS.Platform;
}): {
    stateId: string;
    launcherName: string;
    launcherPath: string;
};
/**
 * Compares the install a pinned launcher points at with the exact versions
 * the registry entry pins. Reads only local files. Null when the entry pins
 * nothing; throws when its pins are not exact versions.
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