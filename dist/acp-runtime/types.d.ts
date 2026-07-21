import type * as schema from "@agentclientprotocol/sdk";
export type AcpSessionEvent = schema.SessionUpdate | {
    type: "requestPermission";
    params: schema.RequestPermissionRequest;
} | {
    type: "requestPermissionError";
    error: string;
} | {
    type: "promptComplete";
    response: schema.PromptResponse;
} | {
    type: "promptError";
    error: string;
};
export type AcpPromptInput = string | readonly schema.ContentBlock[];
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
    /** Hard cap on initialize/auth/session creation. 0 disables it. */
    initTimeoutMs?: number;
    resumeAcpSessionId?: string;
    forkFromAcpSessionId?: string;
    mcpServers?: schema.McpServer[];
    clientCallbacks?: ClientCallbacks;
    /** Extra capabilities a host can advertise in addition to callback-derived ones. */
    clientCapabilities?: schema.ClientCapabilities;
    /** Retry session open once with the first agent-handled auth method. Defaults to true. */
    autoAuthenticate?: boolean;
    /** Mirror permission requests into the session event stream. Defaults to false. */
    emitPermissionEvents?: boolean;
}
export interface AcpSession {
    readonly id: string;
    readonly acpSessionId: string;
    readonly options: SessionOptions;
    readonly authMethods: readonly schema.AuthMethod[];
    readonly agentInfo: schema.Implementation | null;
    readonly configOptions: readonly schema.SessionConfigOption[];
    readonly modes?: schema.SessionModeState;
    readonly promptCapabilities: schema.PromptCapabilities;
    readonly supportsSessionFork: boolean;
    /** Transcript-like updates produced by session/load, excluded from live prompts. */
    readonly loadedReplayEvents?: readonly AcpSessionEvent[];
    prompt(input: AcpPromptInput, opts?: {
        abortSignal?: AbortSignal;
    }): AsyncIterable<unknown>;
    /** Compatibility hook for older hosts; ACP tool results are handled through client callbacks. */
    provideToolResult?(toolCallId: string, result: unknown): Promise<void>;
    drainPendingEvents(): unknown[];
    setConfigOption(configId: string, value: string | boolean): Promise<readonly schema.SessionConfigOption[]>;
    authenticate(methodId: string): Promise<void>;
    setMode(modeId: string): Promise<schema.SessionModeState | undefined>;
    isAlive(): boolean;
    dispose(): Promise<void>;
}
export interface AcpRuntime {
    start(options: SessionOptions): Promise<AcpSession>;
}
//# sourceMappingURL=types.d.ts.map