import { type SessionModeState } from "@agentclientprotocol/sdk";
import type * as schema from "@agentclientprotocol/sdk";
import type { AcpPromptInput, AcpSession, AcpSessionEvent, ChildHandle, SessionOptions } from "./types.js";
export interface AcpSessionConstructOptions {
    child: ChildHandle;
    options: SessionOptions;
    id: string;
}
export declare class AcpSessionImpl implements AcpSession {
    #private;
    readonly id: string;
    readonly options: SessionOptions;
    constructor(deps: AcpSessionConstructOptions);
    get acpSessionId(): string;
    get authMethods(): readonly schema.AuthMethod[];
    get agentInfo(): schema.Implementation | null;
    get configOptions(): readonly schema.SessionConfigOption[];
    get modes(): schema.SessionModeState | undefined;
    get promptCapabilities(): schema.PromptCapabilities;
    get supportsSessionFork(): boolean;
    get loadedReplayEvents(): readonly AcpSessionEvent[];
    init(): Promise<void>;
    authenticate(methodId: string): Promise<void>;
    setMode(modeId: string): Promise<SessionModeState | undefined>;
    setConfigOption(configId: string, value: string | boolean): Promise<readonly schema.SessionConfigOption[]>;
    prompt(input: AcpPromptInput, options?: {
        abortSignal?: AbortSignal;
    }): AsyncIterable<AcpSessionEvent>;
    provideToolResult(toolCallId: string, result: unknown): Promise<void>;
    drainPendingEvents(): AcpSessionEvent[];
    isAlive(): boolean;
    dispose(): Promise<void>;
}
//# sourceMappingURL=session.d.ts.map