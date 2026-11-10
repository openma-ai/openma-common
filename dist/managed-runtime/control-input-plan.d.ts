import { type WireSessionEvent } from "../session-events/managed.js";
/** Derive answer admission from canonical history, not an independent mutable
 * pending-call ledger. The shared event normalizer owns status/tool decoding. */
export declare function planManagedControlAnswer(history: readonly WireSessionEvent[], event: WireSessionEvent): "partial" | "release" | "closed";
export declare function managedControlAnswerId(event: WireSessionEvent): string | null;
//# sourceMappingURL=control-input-plan.d.ts.map