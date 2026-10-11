import type { KnownAgentEntry } from "./known-agents.js";
export declare const ACP_NPM_INSTALL_TIMEOUT_MS: number;
interface AcpRegistryNpxDistribution {
    package: string;
    args?: string[];
    env?: Record<string, string>;
}
interface AcpRegistryUvxDistribution {
    package: string;
    args?: string[];
    env?: Record<string, string>;
}
interface AcpRegistryTargetConfig {
    archive: string;
    cmd: string;
    args?: string[];
    env?: Record<string, string>;
    sha256?: string;
}
export interface AcpRegistryAgent {
    id: string;
    name?: string;
    version?: string;
    description?: string;
    website?: string;
    repository?: string;
    distribution?: {
        binary?: Record<string, AcpRegistryTargetConfig>;
        npx?: AcpRegistryNpxDistribution;
        uvx?: AcpRegistryUvxDistribution;
    };
}
export interface InstallAcpRegistryAgentOptions {
    registryId: string;
    registryAgent?: AcpRegistryAgent;
    shimName: string;
    binDir: string;
    fetchImpl?: typeof fetch;
    npmCommand?: string;
    npmCommandArgs?: string[];
    npmEnv?: NodeJS.ProcessEnv;
    npmRegistryUrls?: string[];
    installRoot?: string;
    shimArgs?: string[];
    shimEnv?: Record<string, string | undefined>;
    env?: NodeJS.ProcessEnv;
    /**
     * npm installs only: dependency name to exact version. Written as npm
     * `overrides`, so every copy in the tree is that version, and checked
     * against what npm installed.
     */
    npmOverrides?: Record<string, string>;
}
export interface AcpRegistryCatalogAgent {
    id: string;
    name: string;
    version?: string;
    description?: string;
    homepage?: string;
    installable: boolean;
    args?: string[];
    env?: Record<string, string>;
}
export interface InstallManagedAdapterOptions {
    id: string;
    label: string;
    command: string;
    args?: string[];
    downloadUrl: string;
    binDir: string;
    fetchImpl?: typeof fetch;
}
export interface InstallResult {
    commandPath: string;
    version?: string;
    /** Installed versions of the dependencies named in `npmOverrides`. */
    dependencies?: Record<string, string>;
}
export interface AcpRegistryInstallMetadata {
    source: "registry";
    registryId: string;
    shimName: string;
    version?: string;
    /** Present for an install made with `npmOverrides`. */
    dependencies?: Record<string, string>;
    installedAt: string;
}
export interface UninstallAcpRegistryAgentOptions {
    registryId: string;
    shimName: string;
    binDir: string;
    installRoot?: string;
}
export interface UninstallManagedAdapterOptions {
    command: string;
    binDir: string;
}
export declare function listAcpRegistryCatalog(options?: {
    fetchImpl?: typeof fetch;
}): Promise<AcpRegistryCatalogAgent[]>;
export declare function readAcpRegistryInstallMetadata(options: {
    registryId: string;
    binDir: string;
    installRoot?: string;
}): Promise<AcpRegistryInstallMetadata | null>;
/**
 * Rebuild a managed shim whose installed command moved together with the ACP
 * install root. The command is derived from its registry-relative suffix, so
 * no previous storage location is read or treated as a fallback.
 */
export declare function repairRelocatedAcpRegistryShim(options: {
    registryId: string;
    shimName: string;
    binDir: string;
    installRoot?: string;
}): Promise<boolean>;
export declare function installAcpRegistryAgent(options: InstallAcpRegistryAgentOptions): Promise<InstallResult>;
export type InstallPinnedAcpHarnessOptions = Pick<InstallAcpRegistryAgentOptions, "binDir" | "installRoot" | "npmCommand" | "npmCommandArgs" | "npmEnv" | "npmRegistryUrls" | "env" | "fetchImpl"> & {
    entry: KnownAgentEntry;
};
/**
 * Installs a harness at the exact versions its registry entry pins
 * (`KnownAgentEntry.pinned`), for hosts that need the same agent on every
 * machine. Product installs keep using `installAcpRegistryAgent`.
 */
export declare function installPinnedAcpHarness(options: InstallPinnedAcpHarnessOptions): Promise<InstallResult>;
export { readAcpHarnessInstallState, readAcpHarnessPinState, type AcpHarnessInstallState, type AcpHarnessPinState, type ReadAcpHarnessInstallStateOptions, OPENMA_NPM_HARNESS_IDS, usesOpenMaNpmLatestSource, latestNpmPackageVersion, npmPackageNameFromSpec, npmVersionFromSpec, readInstalledNpmPackageVersion, installedNpmPackageVersionFromShim, isStrictlyNewerVersion, } from "./install-state.js";
export declare function installManagedAdapter(options: InstallManagedAdapterOptions): Promise<InstallResult>;
export declare function uninstallAcpRegistryAgent(options: UninstallAcpRegistryAgentOptions): Promise<void>;
export declare function uninstallManagedAdapter(options: UninstallManagedAdapterOptions): Promise<void>;
//# sourceMappingURL=installer.d.ts.map