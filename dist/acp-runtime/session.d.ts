import type * as schema from "@agentclientprotocol/sdk";
import { type AcpForkSupport } from "./fork-support.js";
import type { AcpSession, ChildHandle, SessionOptions, SteeringOutcome } from "./types.js";
export type { AcpForkPoint } from "./fork-support.js";
export { acpForkRequestMeta } from "./fork-support.js";
export interface LegacyModelState {
    currentModelId: string;
    availableModels: Array<{
        modelId: string;
        name: string;
    }>;
}
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
    get protocolVersion(): schema.ProtocolVersion | null;
    get agentInfo(): schema.Implementation | null;
    get agentCapabilities(): schema.AgentCapabilities;
    get initializeMeta(): Record<string, unknown> | null;
    get sessionSetupMeta(): Record<string, unknown> | null;
    get configOptions(): readonly schema.SessionConfigOption[];
    get legacyModels(): LegacyModelState | null;
    get modes(): schema.SessionModeState | null;
    get promptCapabilities(): schema.PromptCapabilities;
    get supportsSessionFork(): boolean;
    get forkSupport(): AcpForkSupport;
    get supportsSessionList(): boolean;
    get supportsSessionDelete(): boolean;
    get supportsSessionResume(): boolean;
    get supportsSessionClose(): boolean;
    get supportsAdditionalDirectories(): boolean;
    get supportsLogout(): boolean;
    get supportsProviders(): boolean;
    get supportsNes(): boolean;
    get nesCapabilities(): schema.NesCapabilities | null;
    get positionEncoding(): schema.PositionEncodingKind | null;
    get supportsSteering(): boolean;
    init(): Promise<void>;
    authenticate(methodId: string): Promise<void>;
    setMode(modeId: string): Promise<void>;
    setConfigOption(configId: string, value: string | boolean): Promise<readonly schema.SessionConfigOption[]>;
    listSessions(params?: schema.ListSessionsRequest): Promise<schema.ListSessionsResponse>;
    deleteSession(sessionId: string): Promise<void>;
    logout(): Promise<void>;
    listProviders(): Promise<schema.ListProvidersResponse>;
    setProvider(params: schema.SetProviderRequest): Promise<void>;
    disableProvider(providerId: schema.ProviderId): Promise<void>;
    requestExtension(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
    notifyExtension(method: string, params?: Record<string, unknown>): Promise<void>;
    startNes(params: schema.StartNesRequest): Promise<schema.StartNesResponse>;
    suggestNes(params: schema.SuggestNesRequest): Promise<schema.SuggestNesResponse>;
    closeNes(params: schema.CloseNesRequest): Promise<schema.CloseNesResponse | void>;
    didOpenDocument(params: schema.DidOpenDocumentNotification): Promise<void>;
    didChangeDocument(params: schema.DidChangeDocumentNotification): Promise<void>;
    didCloseDocument(params: schema.DidCloseDocumentNotification): Promise<void>;
    didSaveDocument(params: schema.DidSaveDocumentNotification): Promise<void>;
    didFocusDocument(params: schema.DidFocusDocumentNotification): Promise<void>;
    acceptNes(params: schema.AcceptNesNotification): Promise<void>;
    rejectNes(params: schema.RejectNesNotification): Promise<void>;
    prompt(input: string | readonly schema.ContentBlock[], options?: {
        abortSignal?: AbortSignal;
    }): AsyncIterable<unknown>;
    steer(input: string | readonly schema.ContentBlock[]): Promise<SteeringOutcome>;
    cancelCurrentTurn(): Promise<void>;
    provideToolResult(toolCallId: string, result: unknown): Promise<void>;
    drainPendingEvents(): unknown[];
    isAlive(): boolean;
    dispose(): Promise<void>;
}
/** Clone `configOptions` from a session-setup response. When the response
 * still carries the retired `models` catalog and no option already has
 * category or id `model`, append a select marked as legacy model state. */
export declare function sessionConfigOptionsFromResponse(value: unknown): schema.SessionConfigOption[];
/** Merge a host capability overlay into the runtime's initialize advertisement.
 * `fs` and `session.configOptions` merge one level. `auth._meta` and top-level
 * `_meta` merge key by key. Overlay values win. */
export declare function mergeClientCapabilities(base: schema.ClientCapabilities | undefined, extra: schema.ClientCapabilities): schema.ClientCapabilities;
//# sourceMappingURL=session.d.ts.map