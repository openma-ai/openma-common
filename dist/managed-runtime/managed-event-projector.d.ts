import type { SessionHostEvent } from "../session-kernel/index.js";
export type ManagedRuntimeEventWire = Record<string, unknown> & {
    id: string;
    type: string;
    processed_at: string;
};
export interface ManagedAcpEventProjectorOptions {
    nextEventId(): string;
    now(): Date;
}
/**
 * Stateful ACP-to-Managed-Events boundary for one Work generation.
 *
 * The projector intentionally emits only persisted canonical events. Stream
 * chunks stay local until their message boundary closes; retrying the HTTP
 * publication is then safe because every projected record has a stable ID.
 */
export declare class ManagedAcpEventProjector {
    #private;
    private readonly options;
    constructor(options: ManagedAcpEventProjectorOptions);
    /** Explicit managed-adapter start boundary, before a native permission
     * callback can publish a pause. Legacy consumers still start on first event. */
    startTurn(turnId: string): ManagedRuntimeEventWire[];
    project(event: SessionHostEvent): ManagedRuntimeEventWire[];
}
//# sourceMappingURL=managed-event-projector.d.ts.map