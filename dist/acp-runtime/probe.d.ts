import { type AuthMethod, type SessionConfigOption, type SessionModeState } from "@agentclientprotocol/sdk";
import type { AgentSpec, Spawner } from "./types.js";
export interface ProbeAcpSessionOptions {
    agent: AgentSpec;
    cwd?: string;
    env?: Record<string, string | undefined>;
    /** Maximum time allowed for initialize, session/new, and capability updates. */
    timeoutMs?: number;
    /** Bounded grace period for post-session/new capability notifications. */
    capabilitySettleMs?: number;
    spawner?: Spawner;
}
export interface ProbeAcpSessionResult {
    sessionId: string;
    configOptions: SessionConfigOption[];
    availableCommands: unknown[];
    modes: SessionModeState | null;
    authMethods: AuthMethod[];
}
export interface ProbeAgentConfigOptionsOptions {
    agent: AgentSpec;
    cwd?: string;
    env?: Record<string, string | undefined>;
    /** Bounded collection window for capability notifications published after session/new. */
    capabilitySettleMs?: number;
    timeoutMs?: number;
    spawner?: Spawner;
}
export interface ProbeAgentSessionConfigResult {
    configOptions: SessionConfigOption[];
    availableCommands: unknown[];
    modes?: SessionModeState | null;
    auth: ProbeAgentAuthStatus;
}
/**
 * Disposable capability probe used during product cold start. It deliberately
 * never returns the child as a real session: callers must start a fresh ACP
 * session after consuming this snapshot.
 */
export declare function probeAcpSession(options: ProbeAcpSessionOptions): Promise<ProbeAcpSessionResult>;
/** Disposable session/capability probe that also reports auth status from the same child. */
export declare function probeAgentSessionConfig(options: ProbeAgentConfigOptionsOptions): Promise<ProbeAgentSessionConfigResult>;
/** Dispose every in-flight capability probe, auth probe, and background
 * authentication child before a product shuts down. */
export declare function disposeAllAcpProbes(): Promise<void>;
export interface ProbeAgentAuthStatusOptions {
    agent: AgentSpec;
    cwd?: string;
    env?: Record<string, string | undefined>;
    timeoutMs?: number;
    spawner?: Spawner;
}
export interface ProbeAgentAuthMethod {
    id: string;
    name?: string;
    description?: string;
    type: string;
    form?: "fields";
    vars?: Array<{
        name: string;
        label?: string;
        secret?: boolean;
        optional?: boolean;
    }>;
    link?: string;
    terminalLaunch?: TerminalAuthLaunchOptions;
}
export interface ProbeAgentAuthStatus {
    status: "configured" | "needs-auth" | "none" | "unknown";
    methodId?: string;
    methodName?: string;
    methods?: ProbeAgentAuthMethod[];
    message?: string;
}
export interface TerminalAuthLaunchOptions {
    label: string;
    command: string;
    args: string[];
    env?: Record<string, string>;
    cwd?: string;
}
export interface AuthenticateAgentOptions {
    agent: AgentSpec;
    cwd?: string;
    env?: Record<string, string | undefined>;
    timeoutMs?: number;
    /** When positive, a still-pending agent authenticate is reported as started
     * after this many milliseconds and left running in the background. */
    agentAuthLaunchGraceMs?: number;
    /** How long a background authenticate may keep its child alive. Defaults to 10 minutes. */
    backgroundAuthTimeoutMs?: number;
    spawner?: Spawner;
    methodId?: string;
    /** Ephemeral fields encoded into authenticate `_meta`. The runtime does not persist them. */
    values?: Record<string, string>;
    launchInteractiveAuth?: (launch: TerminalAuthLaunchOptions) => Promise<void>;
}
export interface AuthenticateAgentResult {
    status: "completed" | "started";
}
export declare function probeAgentAuthStatus(options: ProbeAgentAuthStatusOptions): Promise<ProbeAgentAuthStatus>;
export declare function authenticateAgent(options: AuthenticateAgentOptions): Promise<AuthenticateAgentResult>;
//# sourceMappingURL=probe.d.ts.map