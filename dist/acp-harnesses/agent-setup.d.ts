import { type TerminalAuthLaunchOptions } from "../acp-runtime/probe.js";
export type { TerminalAuthLaunchOptions } from "../acp-runtime/probe.js";
export interface AcpAgentSetupAuthMethod {
    id: string;
    name?: string;
    description?: string;
    type?: string;
    form?: "fields";
    vars?: Array<{
        name: string;
        label?: string;
        secret?: boolean;
        optional?: boolean;
    }>;
    link?: string;
}
export interface AcpAgentSetupAuth {
    status: "configured" | "needs-auth" | "unknown";
    message: string;
    methodId?: string;
    methodName?: string;
    methods?: AcpAgentSetupAuthMethod[];
}
export interface AcpAgentCapabilityInspection {
    status: "ready" | "blocked-auth" | "degraded";
    inspected_at: string;
    error?: string;
}
export interface AcpAgentSetupInfo {
    id: string;
    label: string;
    icon?: string;
    command: string;
    installHint?: string;
    homepage?: string;
    featured?: boolean;
    detected: boolean;
    available?: boolean;
    installed?: boolean;
    installedVersion?: string;
    latestVersion?: string;
    updateAvailable?: boolean;
    installable?: boolean;
    installSource?: "registry" | "adapter";
    custom?: boolean;
    auth?: AcpAgentSetupAuth;
    config_options?: unknown[];
    available_commands?: unknown[];
    session_modes?: unknown;
    capability_inspection?: AcpAgentCapabilityInspection;
}
export interface AcpAgentSetupOverride {
    id: string;
    label?: string;
    command?: string;
    args?: readonly string[];
    env?: Record<string, string | undefined> | ReadonlyArray<{
        readonly name: string;
        readonly value: string;
    }>;
}
export interface AcpAgentSetupServiceDeps {
    registryCachePath: string;
    probeCachePath?: string;
    acpBinDir: string;
    acpInstallRoot: string;
    npmCommand?: string;
    npmCommandArgs?: string[];
    npmEnv?: NodeJS.ProcessEnv;
    npmRegistryUrls?: string[];
    probeCwd?: string;
    authInspectionTimeoutMs?: number;
    capabilityInspectionTimeoutMs?: number;
    env?: Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
    refreshRegistry?: (opts: {
        refresh?: boolean;
    }) => Promise<void>;
    launchInteractiveAuth?: (options: TerminalAuthLaunchOptions) => Promise<void>;
    agentOverrides?: () => readonly AcpAgentSetupOverride[];
    getEnabledAgentIds?: () => readonly string[];
    managedByName?: string;
}
export interface AcpAgentSetupService {
    warmup(): Promise<void>;
    refreshEnabledAgents(): Promise<AcpAgentSetupInfo[]>;
    listAgents(): Promise<AcpAgentSetupInfo[]>;
    installAgent(id: string): Promise<AcpAgentSetupInfo[]>;
    upgradeAgent(id: string): Promise<AcpAgentSetupInfo[]>;
    uninstallAgent(id: string): Promise<AcpAgentSetupInfo[]>;
    authenticateAgent(id: string, options?: {
        methodId?: string;
        secret?: string;
        values?: Record<string, string>;
        gateway?: {
            baseUrl: string;
            headers?: Record<string, string>;
            providerName?: string;
        };
    }): Promise<AcpAgentSetupInfo[]>;
    observeAuth(id: string, observation: {
        status: "configured" | "needs-auth" | "unknown";
        message?: string;
        methodId?: string;
    }): Promise<AcpAgentSetupAuth>;
    observeSessionConfig(id: string, snapshot: {
        config_options?: unknown[];
        available_commands?: unknown[];
        session_modes?: unknown;
    }): Promise<void>;
    dispose(): Promise<void>;
}
export declare function createAcpAgentSetupService(deps: AcpAgentSetupServiceDeps): AcpAgentSetupService;
export interface LaunchTerminalAuthOptions {
    returnInstruction?: string;
}
export declare function launchTerminalAuth(options: TerminalAuthLaunchOptions, launchOptions?: LaunchTerminalAuthOptions): Promise<void>;
//# sourceMappingURL=agent-setup.d.ts.map