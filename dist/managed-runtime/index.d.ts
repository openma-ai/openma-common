import { type ManagedHarnessFinalizationPort } from "./finalization.js";
export { ManagedHarnessFinalizationError, type ManagedHarnessFinalizationPort, type ManagedHarnessFinalizationContext, type ManagedHarnessFinalizationPhase, } from "./finalization.js";
import type { AcpRuntime } from "../acp-runtime/index.js";
import type { HarnessSupervisorHarness } from "./contracts.js";
import { type ManagedAgentsSessionSteerCommand, type ManagedAgentsInputAcceptance, type ManagedAgentsSessionPreparationPort } from "../local-runtime/index.js";
import type { SessionCommand, SessionHostEvent, SessionStartCommand, SessionPromptCommand } from "../session-kernel/index.js";
export * from "./semantic-recovery.js";
export * from "./managed-event-projector.js";
export * from "./http-control.js";
export type ManagedHarnessRecoveryReason = "native-state-missing" | "native-state-stale";
/** Local supervisor extension. This never changes Anthropic's Session or
 * Environment Worker wire shapes; it carries the canonical completion fence
 * from the HTTP control adapter to the native-state adapter. */
export type ManagedHarnessSessionStartCommand = SessionStartCommand & {
    canonicalCompletedTurnId?: string;
};
/** Canonical input data is not a processing receipt or an authorization grant. */
export interface ManagedHarnessInputContext {
    eventId: string;
    event: Readonly<Record<string, unknown>>;
    outcome?: {
        id: string;
        description: string;
        rubric: unknown;
        maxIterations?: number | null;
    };
}
export type ManagedHarnessPromptCommand = SessionPromptCommand & {
    input?: ManagedHarnessInputContext;
};
export type ManagedHarnessSteerCommand = ManagedAgentsSessionSteerCommand & {
    input?: ManagedHarnessInputContext;
};
/** Runs after a successful native turn, outside the publication chain.
 * Await all revisions and evaluation writes before returning. Only then is the
 * canonical completion published. Revisions do not consume canonical inputs. */
export interface ManagedHarnessTurnCompletion {
    command: ManagedHarnessPromptCommand;
    signal: AbortSignal;
    runRevision(input: {
        turnId: string;
        text: string;
    }): Promise<void>;
    cancel(): Promise<void>;
    flush(): Promise<void>;
}
export type ManagedHarnessControlMessage = Exclude<SessionCommand, SessionPromptCommand> | ManagedHarnessPromptCommand | ManagedHarnessSteerCommand | ManagedHarnessSessionStartCommand | {
    type: "control.complete";
    workId: string;
};
export interface ManagedHarnessRecoveryWarning {
    type: "session.warning";
    sessionId: string;
    source: "acp_semantic_recovery";
    message: string;
    details: {
        reason: ManagedHarnessRecoveryReason;
    };
}
export type ManagedHarnessPublishedEvent = SessionHostEvent | ManagedHarnessRecoveryWarning;
export interface ManagedHarnessControlChannel {
    commands(signal: AbortSignal): AsyncIterable<ManagedHarnessControlMessage>;
    publish(event: ManagedHarnessPublishedEvent): Promise<void>;
    close(): Promise<void>;
    /** Awaited in the serial prompt lane immediately before runtime dispatch.
     * Throw to fence execution. Hosts own authorization, idempotency and receipts.
     * This gate is not a consumption receipt. Configuring either this gate or
     * onConsumed opts steer into fenced dispatch: failed/throw/receipt failure
     * is unknown, not legacy automatic fallback. With neither, legacy behavior
     * is retained. */
    beforeDispatch?(command: ManagedHarnessPromptCommand, signal: AbortSignal, kind?: "prompt" | "steer"): Promise<void>;
    /** Called only for a confirmed native promptRequired after steer admission. */
    fallbackOwner?(command: ManagedHarnessPromptCommand, signal: AbortSignal): Promise<string | null>;
    onConsumed?(command: ManagedHarnessPromptCommand, acceptance: ManagedAgentsInputAcceptance): Promise<void>;
}
export interface ManagedHarnessSessionStatePreparation {
    command: SessionStartCommand;
    semanticRecoveryReason?: ManagedHarnessRecoveryReason;
}
/** Durable state belongs to OpenMA. Implementations may copy a Harbor-derived
 * native-session allowlist, but publication and lifecycle are driven here. */
export interface ManagedHarnessSessionStatePort {
    beforeStart(command: ManagedHarnessSessionStartCommand): Promise<ManagedHarnessSessionStatePreparation>;
    onReady(event: Extract<SessionHostEvent, {
        type: "session.ready";
    }>): Promise<void>;
    checkpoint(input: {
        sessionId: string;
        turnId?: string;
    }): Promise<void>;
    release(input: {
        sessionId: string;
        reason: "shutdown" | "destroy";
    }): Promise<void>;
}
export interface ManagedHarnessSemanticRecoveryPort {
    build(input: {
        sessionId: string;
        reason: ManagedHarnessRecoveryReason;
        currentPrompt: string;
    }): Promise<string>;
}
export interface ManagedAcpSupervisorHarnessOptions {
    connect(input: {
        scope: Parameters<HarnessSupervisorHarness["start"]>[0]["scope"];
        harness: Parameters<HarnessSupervisorHarness["start"]>[0]["harness"];
        workspacePath: string;
        outputPath: string | null;
        signal: AbortSignal;
    }): Promise<ManagedHarnessControlChannel>;
    acpRuntime: AcpRuntime;
    sessionPreparation: ManagedAgentsSessionPreparationPort;
    sessionState: ManagedHarnessSessionStatePort;
    semanticRecovery?: ManagedHarnessSemanticRecoveryPort;
    onTurnComplete?(turn: ManagedHarnessTurnCompletion): Promise<void>;
    /** Opt in to strict pre-terminal persistence and post-terminal publication. */
    finalization?: ManagedHarnessFinalizationPort;
    drainDeadlineMs?: number;
    drainPollIntervalMs?: number;
    abortGraceMs?: number;
}
/**
 * Whole-brain ACP harness for the `openma_supervised` lane.
 *
 * The Session command stream, ACP runtime, native state hooks and event sink
 * all live in the supervisor process. The outer Runtime Host still owns the
 * Work claim, resource fence, workspace/output publication and hard kill.
 */
export declare function createManagedAcpSupervisorHarness(options: ManagedAcpSupervisorHarnessOptions): HarnessSupervisorHarness;
export * from "./claimed-environment-work.js";
export type { RuntimeResourceScope, HarnessSupervisorHarness, HarnessSupervisorRun } from "./contracts.js";
export * from "./acp-subagents.js";
export * from "./input-identity.js";
//# sourceMappingURL=index.d.ts.map