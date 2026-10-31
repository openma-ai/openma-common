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
/**
 * HTTP body for `DELETE /v1/oma/sessions/:id/pending/:event_id` (OMA queue
 * cancel). The client (Console enter-edit, remove, edit-save) branches on
 * this payload immediately; the live stream still emits
 * `system.user_message_cancelled` → OpenMA `turn.cancelled` on success so
 * observers stay in sync.
 *
 * Success (HTTP 200): `{ cancelled: true, id, cancelled_at }`
 * Too late (HTTP 409): `{ cancelled: false, reason, id, processed_at? }`
 *   reason ∈ already_processing | already_cancelled | already_completed | not_found
 */
export type OmaQueueCancelReason = "already_processing" | "already_cancelled" | "already_completed" | "not_found";
export type OmaQueueCancelResponse = {
    cancelled: true;
    id: string;
    cancelled_at: string;
} | {
    cancelled: false;
    reason: OmaQueueCancelReason;
    id: string;
    processed_at?: string;
};
/** Encode a cancel outcome for the DELETE pending response body. */
export declare function encodeOmaQueueCancelResponse(input: {
    cancelled: true;
    id: string;
    cancelledAt: string;
} | {
    cancelled: false;
    id: string;
    reason: OmaQueueCancelReason;
    processedAt?: string;
}): OmaQueueCancelResponse;
/** Decode / validate a cancel HTTP JSON body. Returns null if malformed. */
export declare function decodeOmaQueueCancelResponse(value: unknown): OmaQueueCancelResponse | null;
export declare function decodeManagedSessionEvent(event: ManagedSessionEvent, context: ManagedEventDecodeContext): ManagedEventDecodeResult;
export declare function decodeManagedStreamEvent(event: ManagedStreamEvent, context: ManagedEventDecodeContext): ManagedEventDecodeResult;
export declare function encodeManagedSessionInput(event: OpenMAEvent): ManagedEventEncodeResult;
export { sessionInputIdentityPrefix } from "./input-identity.js";
//# sourceMappingURL=index.d.ts.map