import { type CallbackCategory, type CallbackRequestedData, type CallbackRequestedEvent, type JsonObject, type JsonValue, type OpenMAEvent, type OpenMAEventSource, type TurnTerminalEvent } from "../session-events/openma.js";
export * from "../session-events/openma.js";
export type AgentPlacement = "local" | "remote" | "managed";
export interface AgentSessionHandle {
    readonly connectorId: string;
    readonly externalSessionId: string;
    readonly placement: AgentPlacement;
    readonly resumeToken?: string;
    readonly metadata?: JsonObject;
}
export declare function createAgentSessionHandle(input: AgentSessionHandle): Readonly<AgentSessionHandle>;
export type AgentSessionPersistence = "ephemeral" | "resumable" | "persistent";
export interface AgentCapabilities {
    readonly sessionPersistence: AgentSessionPersistence;
    readonly streaming: boolean;
    readonly cancellation: boolean;
    readonly permissions: boolean;
    readonly elicitation: boolean;
    readonly steering?: boolean;
    readonly customTools?: boolean;
    readonly mcp?: boolean;
    readonly extensions?: JsonObject;
}
export interface AgentSessionInput {
    readonly agentId: string;
    readonly cwd?: string;
    readonly additionalDirectories?: readonly string[];
    readonly resume?: AgentSessionHandle;
    readonly metadata?: JsonObject;
}
export interface AgentContentBlock {
    readonly type: string;
    readonly [key: string]: JsonValue;
}
export type AgentContent = string | readonly AgentContentBlock[];
export interface AgentTurnInput {
    readonly turnId: string;
    readonly contextDigest?: string;
    readonly content: AgentContent;
    readonly grants?: readonly string[];
    readonly workspace?: {
        readonly cwd?: string;
        readonly additionalDirectories?: readonly string[];
    };
    readonly metadata?: JsonObject;
}
export type AgentCommand = {
    type: "turn.steer";
    content: AgentContent;
} | {
    type: "turn.cancel";
    turnId: string;
} | {
    type: "callback.respond";
    callbackId: string;
    result?: JsonValue;
    error?: JsonValue;
};
export interface OpenMAAgentConnector {
    readonly id: string;
    capabilities(): Promise<AgentCapabilities>;
    open(input: AgentSessionInput): Promise<AgentSessionHandle>;
    execute(session: AgentSessionHandle, input: AgentTurnInput): AsyncIterable<OpenMAEvent>;
    send(session: AgentSessionHandle, command: AgentCommand): Promise<void>;
    close(session: AgentSessionHandle): Promise<void>;
}
export interface AgentEventContext {
    readonly eventId: string;
    readonly sessionId: string;
    readonly occurredAt: string;
    readonly source?: OpenMAEventSource;
    readonly sessionThreadId?: string;
    readonly turnId: string;
    readonly workItemId?: string;
    readonly parentEventId?: string;
    readonly parentId?: string;
    readonly seq: number;
}
export declare function agentEventEnvelope(context: AgentEventContext, defaultSource: OpenMAEventSource): {
    event_id: string;
    session_id: string;
    source: OpenMAEventSource;
    occurred_at: string;
    session_thread_id?: string;
    turn_id: string;
    work_item_id?: string;
    parent_event_id?: string;
    parent_id?: string;
    seq: number;
};
export type AgentTurnTerminalStatus = "completed" | "failed" | "cancelled" | "interrupted";
export declare function turnTerminalStatus(event: OpenMAEvent): AgentTurnTerminalStatus | undefined;
export declare function isTurnTerminalEvent(event: OpenMAEvent): event is TurnTerminalEvent;
export type CallbackRequestEventFor<TCategory extends CallbackCategory> = Omit<CallbackRequestedEvent, "data"> & {
    data: CallbackRequestedData & {
        category: TCategory;
    };
};
export declare function isCallbackRequestEvent<TCategory extends CallbackCategory>(event: OpenMAEvent, category: TCategory): event is CallbackRequestEventFor<TCategory>;
export declare function isCallbackRequestEvent(event: OpenMAEvent): event is CallbackRequestedEvent;
export declare function isPermissionRequestEvent(event: OpenMAEvent): event is CallbackRequestEventFor<"permission">;
export declare function isElicitationRequestEvent(event: OpenMAEvent): event is CallbackRequestEventFor<"elicitation">;
export declare function callbackFingerprint(context: Pick<AgentEventContext, "sessionId" | "turnId">, category: CallbackCategory, method: string, callbackId: string, params: unknown): string;
//# sourceMappingURL=index.d.ts.map