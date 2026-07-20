import type * as schema from "@agentclientprotocol/sdk";
import type { AcpSession, ChildHandle, SessionOptions } from "./types.js";
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
    get promptCapabilities(): schema.PromptCapabilities;
    get supportsSessionFork(): boolean;
    init(): Promise<void>;
    authenticate(methodId: string): Promise<void>;
    setMode(modeId: string): Promise<void>;
    setConfigOption(configId: string, value: string | boolean): Promise<readonly schema.SessionConfigOption[]>;
    prompt(input: string | readonly schema.ContentBlock[], options?: {
        abortSignal?: AbortSignal;
    }): AsyncIterable<unknown>;
    provideToolResult(toolCallId: string, result: unknown): Promise<void>;
    drainPendingEvents(): unknown[];
    isAlive(): boolean;
    dispose(): Promise<void>;
}
//# sourceMappingURL=session.d.ts.map