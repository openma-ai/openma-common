import type { AgentNotification, AgentRequest, AgentResponse, ClientNotification, ClientRequest, ClientResponse, RequestId, SessionNotification } from "@agentclientprotocol/sdk";
import { type OpenMAEvent } from "../../session-events/openma.js";
export type AcpSessionNotification = SessionNotification;
export type AcpEventMappingFidelity = "exact" | "lossy" | "unsupported";
export interface AcpEventMappingDiagnostic {
    code: string;
    message: string;
}
export interface AcpDecodeContext {
    /** Stable identity assigned at the ACP transport boundary. */
    eventId: string;
    /** Observation time assigned at the ACP transport boundary. */
    occurredAt: string;
    ingestedAt?: string;
    turnId?: string;
    seq?: number;
}
export interface AcpRequestDecodeContext extends AcpDecodeContext {
    sessionId: string;
}
export interface AcpResponseDecodeContext extends AcpRequestDecodeContext {
    method: string;
}
export interface AcpDecodeResult {
    fidelity: AcpEventMappingFidelity;
    event: OpenMAEvent;
    diagnostics: AcpEventMappingDiagnostic[];
}
export interface AcpEncodeContext {
    requestId?: RequestId;
}
export interface AcpEncodeResult {
    fidelity: AcpEventMappingFidelity;
    message?: ClientRequest | ClientNotification | ClientResponse;
    diagnostics: AcpEventMappingDiagnostic[];
}
export declare function decodeAcpAgentRequest(request: AgentRequest, context: AcpRequestDecodeContext): AcpDecodeResult;
export declare function decodeAcpAgentNotification(notification: AgentNotification, context: AcpRequestDecodeContext): AcpDecodeResult;
export declare function decodeAcpClientResponse(response: ClientResponse, context: AcpResponseDecodeContext): AcpDecodeResult;
export declare function decodeAcpAgentResponse(response: AgentResponse, context: AcpResponseDecodeContext): AcpDecodeResult;
export declare function encodeAcpInput(event: OpenMAEvent, context?: AcpEncodeContext): AcpEncodeResult;
export declare function decodeAcpSessionNotification(notification: AcpSessionNotification, context: AcpDecodeContext): AcpDecodeResult;
//# sourceMappingURL=index.d.ts.map