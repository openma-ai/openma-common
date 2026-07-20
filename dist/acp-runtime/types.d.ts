import type * as schema from "@agentclientprotocol/sdk";
export interface AgentSpec {
    command: string;
    args?: string[];
    env?: Record<string, string | undefined>;
    cwd?: string;
    onDiagnosticLine?: (line: string) => void;
}
export interface ChildHandle {
    stdin: WritableStream<Uint8Array>;
    stdout: ReadableStream<Uint8Array>;
    stderr: ReadableStream<Uint8Array>;
    kill(signal?: "SIGTERM" | "SIGKILL"): Promise<void>;
    exited: Promise<{
        code: number | null;
        signal: string | null;
    }>;
}
export interface Spawner {
    spawn(spec: AgentSpec): Promise<ChildHandle>;
}
export interface RestartPolicy {
    mode: "never" | "on-crash" | "always";
    maxRestarts?: number;
    windowMs?: number;
}
export interface ClientCallbacks {
    requestPermission?(params: schema.RequestPermissionRequest): Promise<schema.RequestPermissionResponse>;
    readTextFile?(params: schema.ReadTextFileRequest): Promise<schema.ReadTextFileResponse>;
    writeTextFile?(params: schema.WriteTextFileRequest): Promise<schema.WriteTextFileResponse>;
    createTerminal?(params: schema.CreateTerminalRequest): Promise<schema.CreateTerminalResponse>;
    terminalOutput?(params: schema.TerminalOutputRequest): Promise<schema.TerminalOutputResponse>;
    releaseTerminal?(params: schema.ReleaseTerminalRequest): Promise<schema.ReleaseTerminalResponse | void>;
    waitForTerminalExit?(params: schema.WaitForTerminalExitRequest): Promise<schema.WaitForTerminalExitResponse>;
    killTerminal?(params: schema.KillTerminalRequest): Promise<schema.KillTerminalResponse | void>;
}
export interface SessionOptions {
    agent: AgentSpec;
    restart?: RestartPolicy;
    idleTimeoutMs?: number;
    perTurnTimeoutMs?: number;
    resumeAcpSessionId?: string;
    forkFromAcpSessionId?: string;
    mcpServers?: schema.McpServer[];
    clientCallbacks?: ClientCallbacks;
}
export interface AcpSession {
    readonly id: string;
    readonly acpSessionId: string;
    readonly options: SessionOptions;
    readonly authMethods: readonly schema.AuthMethod[];
    readonly agentInfo: schema.Implementation | null;
    readonly configOptions: readonly schema.SessionConfigOption[];
    readonly promptCapabilities: schema.PromptCapabilities;
    readonly supportsSessionFork: boolean;
    prompt(input: string | readonly schema.ContentBlock[], opts?: {
        abortSignal?: AbortSignal;
    }): AsyncIterable<unknown>;
    /** Compatibility hook for older hosts; ACP tool results are handled through client callbacks. */
    provideToolResult?(toolCallId: string, result: unknown): Promise<void>;
    drainPendingEvents(): unknown[];
    setConfigOption(configId: string, value: string | boolean): Promise<readonly schema.SessionConfigOption[]>;
    authenticate(methodId: string): Promise<void>;
    setMode(modeId: string): Promise<void>;
    isAlive(): boolean;
    dispose(): Promise<void>;
}
export interface AcpRuntime {
    start(options: SessionOptions): Promise<AcpSession>;
}
//# sourceMappingURL=types.d.ts.map