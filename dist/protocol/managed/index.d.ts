import type { BetaManagedAgentsEventParams, BetaManagedAgentsSessionEvent, BetaManagedAgentsStreamSessionEvents } from "@anthropic-ai/sdk/resources/beta/sessions/events";
import { type OpenMAEvent } from "../../session-events/openma.js";
export type ManagedSessionEvent = BetaManagedAgentsSessionEvent;
export type ManagedStreamEvent = BetaManagedAgentsStreamSessionEvents;
export type ManagedWireEvent = ManagedStreamEvent;
export type ManagedEventMappingFidelity = "exact" | "lossy" | "unsupported";
export interface ManagedEventMappingDiagnostic {
    code: string;
    message: string;
}
export interface ManagedEventDecodeContext {
    sessionId: string;
    turnId?: string;
    ingestedAt?: string;
    seq?: number;
}
export interface ManagedEventDecodeResult {
    fidelity: ManagedEventMappingFidelity;
    event: OpenMAEvent;
    diagnostics: ManagedEventMappingDiagnostic[];
}
export type ManagedSessionInputEvent = BetaManagedAgentsEventParams;
export interface ManagedEventEncodeResult {
    fidelity: ManagedEventMappingFidelity;
    event?: ManagedSessionInputEvent;
    diagnostics: ManagedEventMappingDiagnostic[];
}
export declare function decodeManagedSessionEvent(event: ManagedSessionEvent, context: ManagedEventDecodeContext): ManagedEventDecodeResult;
export declare function decodeManagedStreamEvent(event: ManagedStreamEvent, context: ManagedEventDecodeContext): ManagedEventDecodeResult;
export declare function encodeManagedSessionInput(event: OpenMAEvent): ManagedEventEncodeResult;
//# sourceMappingURL=index.d.ts.map