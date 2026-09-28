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
/**
 * Disposable capability probe used during product cold start. It deliberately
 * never returns the child as a real session: callers must start a fresh ACP
 * session after consuming this snapshot.
 */
export declare function probeAcpSession(options: ProbeAcpSessionOptions): Promise<ProbeAcpSessionResult>;
/** Dispose every in-flight cold-start probe before a product shuts down. */
export declare function disposeAllAcpProbes(): Promise<void>;
//# sourceMappingURL=probe.d.ts.map