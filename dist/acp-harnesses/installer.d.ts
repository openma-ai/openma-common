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
}
export interface AcpRegistryInstallMetadata {
    source: "registry";
    registryId: string;
    shimName: string;
    version?: string;
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
export declare function installManagedAdapter(options: InstallManagedAdapterOptions): Promise<InstallResult>;
export declare function uninstallAcpRegistryAgent(options: UninstallAcpRegistryAgentOptions): Promise<void>;
export declare function uninstallManagedAdapter(options: UninstallManagedAdapterOptions): Promise<void>;
export {};
//# sourceMappingURL=installer.d.ts.map