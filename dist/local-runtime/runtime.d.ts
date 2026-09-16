import type { AcpRuntime, SessionOptions } from "../acp-runtime/index.js";
import type { SessionCommand, SessionStartCommand, SessionHostEvent } from "../session-kernel/index.js";
export interface ManagedAgentsSessionSteerCommand {
    type: "session.steer";
    sessionId: string;
    eventId: string;
    text: string;
}
export type ManagedAgentsSessionCommand = SessionCommand | ManagedAgentsSessionSteerCommand;
import { type ManagedAgentsDrainOptions, type ManagedAgentsDrainReport, type ManagedAgentsRuntimeScheduler } from "./session-host.js";
import type { ManagedAgentsSessionCheckpointStore } from "./checkpoint.js";
export interface ManagedAgentsSessionPreparationPort {
    prepare(command: SessionStartCommand): Promise<SessionOptions>;
}
export interface ManagedAgentsRuntimeEventSink {
    publish(event: SessionHostEvent): void;
}
export interface ManagedAgentsRuntimeDependencies {
    acpRuntime: AcpRuntime;
    sessionPreparation: ManagedAgentsSessionPreparationPort;
    scheduler?: ManagedAgentsRuntimeScheduler;
    cancelGraceMs?: number;
    checkpointStore?: ManagedAgentsSessionCheckpointStore;
    hostInstanceId?: string;
}
export interface ManagedAgentsRuntime {
    attach(sink: ManagedAgentsRuntimeEventSink): void;
    dispatch(command: ManagedAgentsSessionCommand): Promise<void>;
    drain(options: ManagedAgentsDrainOptions): Promise<ManagedAgentsDrainReport>;
    announceAll(): void;
    hasSession(sessionId: string): boolean;
    sessionCount(): number;
    activeTurnCount(): number;
}
export declare function createManagedAgentsRuntime(dependencies: ManagedAgentsRuntimeDependencies): ManagedAgentsRuntime;
//# sourceMappingURL=runtime.d.ts.map