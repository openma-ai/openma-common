import type { OpenMAEventEnvelope } from "../session-events/openma.js";
export type CanonicalEvent = OpenMAEventEnvelope<string, Record<string, unknown>>;
export declare function generateStressTurn(seed: readonly CanonicalEvent[], { targetEvents }?: {
    targetEvents?: number;
}): CanonicalEvent[];
//# sourceMappingURL=stress-session.d.ts.map