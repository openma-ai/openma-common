import { type Attributes, type Tracer } from "@opentelemetry/api";
export interface SessionStartInfo {
    sessionId: string;
    agentName: string;
    /** Extra metadata for every span of the session (ids and flags only). */
    attributes?: Attributes;
}
export interface TurnStartInfo {
    sessionId: string;
    turnId: string;
    promptChars?: number;
}
export declare class AcpTraceObserver {
    #private;
    private readonly tracer;
    constructor(tracer: Tracer);
    /**
     * Record the caller's traceparent for a turn that may start later. The
     * turn span adopts it as remote parent. Invalid values are ignored.
     */
    linkTurn(sessionId: string, turnId: string, traceparent: string | undefined): void;
    /**
     * A start command. Hosts may re-send start for a session that is already
     * running (an idempotent re-ack); that opens no new `create_agent` span.
     */
    sessionStarting(info: SessionStartInfo): void;
    /** A turn begins executing (not merely queued). */
    turnStarting(info: TurnStartInfo): void;
    /** Every message the session manager sends out. Never throws. */
    observe(message: {
        readonly type: string;
        readonly [key: string]: unknown;
    }): void;
}
//# sourceMappingURL=acp-session-tracing.d.ts.map