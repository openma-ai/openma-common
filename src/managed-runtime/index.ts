import {
  finalizeManagedTurn,
  ManagedHarnessFinalizationError,
  type ManagedHarnessFinalizationPort,
} from "./finalization.js";
export {
  ManagedHarnessFinalizationError,
  type ManagedHarnessFinalizationPort,
  type ManagedHarnessFinalizationContext,
  type ManagedHarnessFinalizationPhase,
} from "./finalization.js";
import type { AcpRuntime } from "../acp-runtime/index.js";
import type { HarnessSupervisorHarness } from "./contracts.js";
import {
  createManagedAgentsRuntime,
  type ManagedAgentsSessionSteerCommand,
  type ManagedAgentsInputDispatchHooks,
  type ManagedAgentsInputAcceptance,
  type ManagedAgentsSessionPreparationPort,
} from "../local-runtime/index.js";
import type {
  SessionCommand,
  SessionHostEvent,
  SessionStartCommand,
  SessionPromptCommand,
  SessionCompleteEvent,
} from "../session-kernel/index.js";

export * from "./semantic-recovery.js";
export * from "./managed-event-projector.js";
export * from "./http-control.js";

export type ManagedHarnessRecoveryReason =
  | "native-state-missing"
  | "native-state-stale";

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
  runRevision(input: { turnId: string; text: string }): Promise<void>;
  cancel(): Promise<void>;
  flush(): Promise<void>;
}

export type ManagedHarnessControlMessage =
  | Exclude<SessionCommand, SessionPromptCommand>
  | ManagedHarnessPromptCommand
  | ManagedHarnessSteerCommand
  | ManagedHarnessSessionStartCommand
  | {
      type: "control.complete";
      workId: string;
    };

export interface ManagedHarnessRecoveryWarning {
  type: "session.warning";
  sessionId: string;
  source: "acp_semantic_recovery";
  message: string;
  details: { reason: ManagedHarnessRecoveryReason };
}

export type ManagedHarnessPublishedEvent =
  | SessionHostEvent
  | ManagedHarnessRecoveryWarning;

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
  beforeStart(
    command: ManagedHarnessSessionStartCommand,
  ): Promise<ManagedHarnessSessionStatePreparation>;
  onReady(event: Extract<SessionHostEvent, { type: "session.ready" }>): Promise<void>;
  checkpoint(input: { sessionId: string; turnId?: string }): Promise<void>;
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
export function createManagedAcpSupervisorHarness(
  options: ManagedAcpSupervisorHarnessOptions,
): HarnessSupervisorHarness {
  if (options.finalization !== undefined && (
    typeof options.finalization.drainTurn !== "function" ||
    typeof options.finalization.afterTerminal !== "function"
  )) throw new TypeError("finalization requires drainTurn and afterTerminal");
  const drainDeadlineMs = options.drainDeadlineMs ?? 5_000;
  const drainPollIntervalMs = options.drainPollIntervalMs ?? 25;
  const abortGraceMs = options.abortGraceMs ?? 1_000;
  assertNonNegativeInteger(drainDeadlineMs, "drainDeadlineMs");
  assertPositiveInteger(drainPollIntervalMs, "drainPollIntervalMs");
  assertNonNegativeInteger(abortGraceMs, "abortGraceMs");

  return {
    async start(input) {
      if (options.finalization && typeof input.checkpoint !== "function") {
        throw new TypeError("finalization requires input.checkpoint");
      }
      const controller = new AbortController();
      const forwardAbort = () => controller.abort(input.signal.reason);
      if (input.signal.aborted) forwardAbort();
      else input.signal.addEventListener("abort", forwardAbort, { once: true });

      const channel = await options.connect({
        scope: input.scope,
        harness: input.harness,
        workspacePath: input.workspacePath,
        outputPath: input.outputPath,
        signal: controller.signal,
      });
      const runtime = createManagedAgentsRuntime({
        acpRuntime: options.acpRuntime,
        sessionPreparation: options.sessionPreparation,
      });
      const liveSessions = new Set<string>();
      const ownedSessions = new Set<string>();
      const recoveryReasons = new Map<string, ManagedHarnessRecoveryReason>();
      let eventChain = Promise.resolve();
      let finalized = false;
      let queuedPrompts = 0;
      let promptTail = Promise.resolve();
      let dispatchFailure: { error: unknown } | undefined;
      const cancelledTurns = new Set<string>();
      const turnControllers = new Map<string, AbortController>();
      const activeTurnIds = new Map<string, string>();
      const heldCompletions = new Map<string, SessionCompleteEvent | undefined>();
      const turnErrors = new Map<string, string>();
      // Only native dispatch/receipt settlement, NOT steer fallback promises:
      // fallback is queued behind the current turn and must not deadlock it.
      const nativeSteers = new Set<Promise<void>>();
      type Continuation = {command: ManagedHarnessPromptCommand; dispatch: () => Promise<void>; order: number; resolve(): void; reject(error: unknown): void};
      const continuations = new Map<string, Continuation[]>();
      const continuationRoots = new Map<string,string>();
      let steerOrder = 0;
      let finalizingTurn = false;
      let finalizationTask: Promise<void> | undefined;

      const publish = (event: SessionHostEvent) => {
        eventChain = eventChain.then(async () => {
          if (event.type === "session.ready") {
            liveSessions.add(event.sessionId);
            await options.sessionState.onReady(event);
          } else if (event.type === "session.complete" && !options.finalization) {
            await options.sessionState.checkpoint({
              sessionId: event.sessionId,
              turnId: event.turnId,
            });
          } else if (event.type === "session.disposed") {
            await options.sessionState.release({
              sessionId: event.sessionId,
              reason: "destroy",
            });
            liveSessions.delete(event.sessionId);
            ownedSessions.delete(event.sessionId);
            recoveryReasons.delete(event.sessionId);
          }
          await channel.publish(event);
          if (event.type === "session.complete" && !options.finalization) {
            await input.checkpoint({
              sessionId: event.sessionId,
              turnId: event.turnId,
            });
          }
        });
        // Observe every chain link immediately, even while ACP is still
        // streaming. Retain the rejected chain for flush/completed, and fence
        // admission rather than silently swallowing a publication failure.
        void eventChain.catch((error: unknown) => {
          if (!controller.signal.aborted) {
            dispatchFailure ??= { error };
            controller.abort(error);
          }
        });
      };
      runtime.attach({
        publish(event) {
          if (event.type === "session.complete" && heldCompletions.has(event.turnId)) {
            heldCompletions.set(event.turnId, event);
            return;
          }
          if (event.type === "session.error" && event.turnId !== undefined) {
            turnErrors.set(event.turnId, event.message);
          }
          // Native continuation id is local dispatch correlation, not a new
          // canonical turn/span. Permission and content stay with their root.
          if (event.type === "session.event" && continuationRoots.has(event.turnId)) {
            publish({...event,turnId:continuationRoots.get(event.turnId)!});
          } else publish(event);
        },
      });

      const runPrompt = async (
        command: ManagedHarnessPromptCommand,
        fallbackDispatch?: () => Promise<void>,
        signal = controller.signal,
      ) => {
        controller.signal.throwIfAborted();
        if (cancelledTurns.has(command.turnId)) return;
        const turnController = new AbortController();
        signal.throwIfAborted();
        const abort = () => turnController.abort(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        turnControllers.set(command.turnId, turnController);
        let activeTurnId = command.turnId;
        activeTurnIds.set(command.turnId, activeTurnId);
        const pendingContinuations: Continuation[] = [];
        continuations.set(command.turnId, pendingContinuations);
        let revisionTail = Promise.resolve();
        let closed = false;
        const flush = async () => { await eventChain; };
        const cancel = async () => {
          turnController.abort(new Error("Managed turn cancelled"));
          await runtime.dispatch({ type: "session.cancel", sessionId: command.sessionId, turnId: activeTurnId });
          await flush();
        };
        try {
          if (!fallbackDispatch && channel.beforeDispatch) {
            await waitForDispatchGate(channel.beforeDispatch(command, turnController.signal), turnController.signal);
          }
          if (turnController.signal.aborted) return;
          if (options.onTurnComplete !== undefined || options.finalization || channel.fallbackOwner) heldCompletions.set(command.turnId, undefined);
          if (fallbackDispatch) await fallbackDispatch();
          else await runtime.dispatch(command, channel.onConsumed ? {
            signal: turnController.signal,
            beforeDispatch: async () => {},
            onConsumed: acceptance => channel.onConsumed!(command, acceptance),
          } : undefined, { signal: turnController.signal });
          await flush();
          // Close admission BEFORE joining admitted steer RPCs. Their confirmed
          // continuations belong to this root and must run before outcome/drain.
          finalizingTurn = true;
          await Promise.all(nativeSteers);
          pendingContinuations.sort((a,b) => a.order-b.order);
          for (const continuation of pendingContinuations) {
            turnController.signal.throwIfAborted();
            activeTurnId = continuation.command.turnId;
            activeTurnIds.set(command.turnId, activeTurnId);
            heldCompletions.set(activeTurnId, undefined);
            continuationRoots.set(activeTurnId, command.turnId);
            try {
              await continuation.dispatch();
              await flush();
              turnController.signal.throwIfAborted();
              const error = turnErrors.get(activeTurnId);
              if (error !== undefined) throw new Error(error);
              if (!heldCompletions.get(activeTurnId)) throw new Error("Continuation did not complete");
              continuation.resolve();
            } catch (error) { continuation.reject(error); throw error; }
            finally { heldCompletions.delete(activeTurnId); turnErrors.delete(activeTurnId); continuationRoots.delete(activeTurnId); }
          }
          const completion = heldCompletions.get(command.turnId);
          if (options.finalization && completion === undefined && !turnController.signal.aborted) {
            throw new Error(turnErrors.get(command.turnId) ?? "Native turn did not complete");
          }
          if (completion !== undefined && !turnController.signal.aborted && options.onTurnComplete) {
            await options.onTurnComplete({
              command,
              signal: turnController.signal,
              cancel,
              flush,
              runRevision(revision) {
                if (closed) return Promise.reject(new Error("Turn completion boundary is closed"));
                if (turnController.signal.aborted) return Promise.reject(turnController.signal.reason);
                const next = revisionTail.then(async () => {
                  turnController.signal.throwIfAborted();
                  if (revision.turnId === command.turnId) throw new Error("Revision requires a distinct turnId");
                  activeTurnId = revision.turnId;
                  activeTurnIds.set(command.turnId, activeTurnId);
                  heldCompletions.set(revision.turnId, undefined);
                  try {
                    await runtime.dispatch({ type: "session.prompt", sessionId: command.sessionId, ...revision }, undefined, { signal: turnController.signal });
                    await flush();
                    const error = turnErrors.get(revision.turnId);
                    if (error !== undefined) throw new Error(error);
                    if (heldCompletions.get(revision.turnId) === undefined) throw new Error("Revision did not complete");
                  } finally {
                    heldCompletions.delete(revision.turnId);
                    turnErrors.delete(revision.turnId);
                  }
                });
                revisionTail = next;
                void next.catch(() => undefined);
                return next;
              },
            });
          }
          closed = true;
          await revisionTail;
          await flush();
          if (completion !== undefined && options.finalization) {
            // A control interrupt cancels one turn, not its resident worker.
            // Do not enter a new persistence sequence for that cancelled turn.
            // Already-started finalization remains joined and failure-visible.
            if (cancelledTurns.has(command.turnId)) return;
            // Shut native steer admission synchronously, then join the calls
            // already admitted. Queued prompts/fallbacks remain behind us.
            finalizingTurn = true;
            await Promise.all(nativeSteers);
            await flush();
            if (cancelledTurns.has(command.turnId)) return;
            finalizationTask = finalizeManagedTurn({
              port: options.finalization,
              context: { command, signal: turnController.signal, flush },
              completion,
              nativeCheckpoint: () => options.sessionState.checkpoint({ sessionId: command.sessionId, turnId: command.turnId }),
              checkpoint: () => input.checkpoint({ sessionId: command.sessionId, turnId: command.turnId }),
              // Await the ACK directly so publication failure is classified
              // before the shared event-chain observer aborts the run.
              publish: () => channel.publish(completion),
            });
            await finalizationTask;
          } else if (completion !== undefined && !controller.signal.aborted && !turnController.signal.aborted && !cancelledTurns.has(command.turnId)) {
            publish(completion);
            await flush();
          }
        } finally {
          continuations.delete(command.turnId);
          for (const continuation of pendingContinuations) continuation.reject(new Error("Root continuation boundary closed"));
          finalizingTurn = false;
          closed = true;
          heldCompletions.delete(command.turnId);
          turnErrors.delete(command.turnId);
          turnControllers.delete(command.turnId);
          activeTurnIds.delete(command.turnId);
          signal.removeEventListener("abort", abort);
        }
      };

      const enqueuePrompt = (command: ManagedHarnessPromptCommand, fallbackDispatch?: () => Promise<void>, signal?: AbortSignal) => {
        const dispatched = queuedPrompts === 0
          ? runPrompt(command, fallbackDispatch, signal)
          : promptTail.then(() => runPrompt(command, fallbackDispatch, signal));
        queuedPrompts += 1;
        promptTail = dispatched.finally(() => { queuedPrompts -= 1; });
        void promptTail.catch((error: unknown) => {
          // Keep an acknowledged/unknown terminal failure even when external
          // cancellation raced the ACK. Never report clean success for it.
          if (controller.signal.aborted && !(error instanceof ManagedHarnessFinalizationError)) return;
          dispatchFailure ??= { error };
          controller.abort(error);
        });
        return promptTail;
      };

      const steerTasks = new Set<Promise<void>>();
      const steerControllers = new Map<string, AbortController>();
      const runSteer = async (command: ManagedHarnessSteerCommand) => {
        const canonical: ManagedHarnessPromptCommand = {
          type: "session.prompt", sessionId: command.sessionId, turnId: command.eventId,
          text: command.text, ...(command.input ? { input: command.input } : {}),
        };
        if ((options.finalization || channel.fallbackOwner) && finalizingTurn) {
          await enqueuePrompt(canonical);
          return;
        }
        const order = steerOrder++;
        let attemptedSteer = false;
        let settleNative!: () => void;
        const nativeSettled = new Promise<void>(resolve => { settleNative = resolve; });
        if (options.finalization || channel.fallbackOwner) nativeSteers.add(nativeSettled);
        const finishNative = () => { nativeSteers.delete(nativeSettled); settleNative(); };
        const local = new AbortController();
        const abort = () => local.abort(controller.signal.reason);
        controller.signal.addEventListener("abort", abort, { once: true });
        turnControllers.set(command.eventId, local);
        steerControllers.set(command.eventId, local);
        const fallback = async (_input: unknown, dispatch: () => Promise<void>) => {
          const owner = attemptedSteer ? await channel.fallbackOwner?.(canonical, local.signal) : null;
          if (owner != null) {
            const queue = continuations.get(owner);
            if (!queue || cancelledTurns.has(owner) || local.signal.aborted) throw new Error("Continuation root is unavailable");
            const completed = new Promise<void>((resolve,reject) => queue.push({command:canonical,dispatch,order,resolve,reject}));
            finishNative();
            await completed;
            return;
          }
          finishNative();
          if (options.finalization || channel.fallbackOwner) await enqueuePrompt(canonical, dispatch, local.signal);
          else await runPrompt(canonical, dispatch, local.signal);
        };
        const hooks: ManagedAgentsInputDispatchHooks | undefined = channel.beforeDispatch || channel.onConsumed ? {
          signal: local.signal,
          beforeDispatch: async kind => { if (kind === "steer") attemptedSteer = true; await channel.beforeDispatch?.(canonical, local.signal, kind); },
          onConsumed: async acceptance => { await channel.onConsumed?.(canonical, acceptance); },
          runPromptFallback: fallback,
        } : undefined;
        try {
          await runtime.dispatch(command, hooks, options.onTurnComplete || options.finalization ? {
            signal: local.signal,
            runPromptFallback: fallback,
          } : undefined);
          await eventChain;
        }
        catch (error) {
          if (options.finalization || !local.signal.aborted || (error instanceof Error && error.name === "ManagedAgentsInputDispatchError")) throw error;
        }
        finally {
          finishNative();
          steerControllers.delete(command.eventId);
          turnControllers.delete(command.eventId);
          controller.signal.removeEventListener("abort", abort);
        }
      };

      const closeChannel = async () => {
        await channel.close();
      };

      const quiesce = async () => {
        if (finalized) return;
        finalized = true;
        // Do not dispose/checkpoint resident native state concurrently with
        // persistence or publication already in flight at the safe point.
        if (options.finalization) await finalizationTask?.catch(() => undefined);
        await runtime.drain({
          deadlineMs: drainDeadlineMs,
          pollIntervalMs: drainPollIntervalMs,
          abortGraceMs,
        });
        // drain() reaches here only after completed has already observed the
        // event chain; stop() aborts first. A remaining rejection is therefore
        // necessarily a late result from fenced work and must not escape.
        await eventChain.catch(() => undefined);
        for (const sessionId of ownedSessions) {
          if (liveSessions.has(sessionId)) {
            await options.sessionState.checkpoint({ sessionId });
          }
          await options.sessionState.release({ sessionId, reason: "shutdown" });
        }
        liveSessions.clear();
        ownedSessions.clear();
        recoveryReasons.clear();
        await closeChannel();
      };

      const completed = (async (): Promise<{ exitCode: number }> => {
        try {
          let cleanCompletion = false;
          for await (const originalCommand of channel.commands(controller.signal)) {
            controller.signal.throwIfAborted();
            if (originalCommand.type === "control.complete") {
              if (originalCommand.workId !== input.scope.workId) {
                throw new Error(
                  `Harness control attempted cross-work completion ${originalCommand.workId}`,
                );
              }
              cleanCompletion = true;
              break;
            }
            if (originalCommand.sessionId !== input.scope.sessionId) {
              throw new Error(
                `Harness control attempted cross-session command ${originalCommand.sessionId}`,
              );
            }
            let command = originalCommand;
            if (command.type === "session.cancel") {
              cancelledTurns.add(command.turnId);
              for (const pending of steerControllers.values()) pending.abort(new Error("Managed turn interrupted"));
              turnControllers.get(command.turnId)?.abort(new Error("Managed turn cancelled"));
              command = { ...command, turnId: activeTurnIds.get(command.turnId) ?? command.turnId };
            }
            if (command.type === "session.start") {
              const prepared = await options.sessionState.beforeStart(command);
              ownedSessions.add(command.sessionId);
              command = prepared.command;
              if (prepared.semanticRecoveryReason !== undefined) {
                recoveryReasons.set(command.sessionId, prepared.semanticRecoveryReason);
              }
            } else if (command.type === "session.prompt") {
              const reason = recoveryReasons.get(command.sessionId);
              if (reason !== undefined) {
                if (options.semanticRecovery === undefined) {
                  throw new Error(
                    "Native ACP state is unavailable and no semantic recovery Port is configured",
                  );
                }
                command = {
                  ...command,
                  text: await options.semanticRecovery.build({
                    sessionId: command.sessionId,
                    reason,
                    currentPrompt: command.text,
                  }),
                };
                await channel.publish({
                  type: "session.warning",
                  sessionId: command.sessionId,
                  source: "acp_semantic_recovery",
                  message: "Agent-native session state was unavailable; continued from canonical OpenMA history.",
                  details: { reason },
                });
                recoveryReasons.delete(command.sessionId);
              }
            }
            if (command.type === "session.prompt") {
              // A prompt can run for minutes. Keep the control stream live so
              // steer and cancel commands reach that same ACP session while
              // the turn is in flight. True next-turn prompts remain ordered.
              enqueuePrompt(command);
            } else if (command.type === "session.steer") {
              const task = runSteer(command);
              steerTasks.add(task);
              void task.then(() => steerTasks.delete(task), error => {
                steerTasks.delete(task);
                if (!controller.signal.aborted) { dispatchFailure = { error }; controller.abort(error); }
              });
            } else {
              if (command.type === "session.dispose") {
                await Promise.all(steerTasks);
                await promptTail;
                await eventChain;
              }
              await runtime.dispatch(command);
              await eventChain;
            }
          }
          if (!cleanCompletion) {
            throw new Error("Harness control stream closed before control.complete");
          }
          await waitForDispatchGate(promptTail, controller.signal);
          await Promise.all(steerTasks);
          if (dispatchFailure) throw dispatchFailure.error;
          await eventChain;
          return { exitCode: 0 };
        } catch (error) {
          const wasAborted = controller.signal.aborted;
          // Revoke gates before failure handoff; already submitted steers
          // must settle their outcome/receipt rather than outlive the job.
          controller.abort(error);
          await Promise.allSettled(steerTasks);
          // Opt-in finalization may be awaiting an IO ACK that ignores abort.
          // Join it before deciding success/failure: a post-terminal failure
          // must not be erased by the cancellation race above.
          if (options.finalization) await Promise.allSettled([promptTail]);
          if (dispatchFailure !== undefined) throw dispatchFailure.error;
          if (wasAborted) return { exitCode: 0 };
          throw error;
        }
      })();

      return {
        completed,
        async drain() {
          await completed;
          await quiesce();
          input.signal.removeEventListener("abort", forwardAbort);
        },
        async stop() {
          controller.abort(new Error("Managed ACP harness stopped"));
          await quiesce();
          input.signal.removeEventListener("abort", forwardAbort);
        },
      };
    },
  };
}

// The gate may be backed by IO that ignores cancellation. Revoke our wait and
// keep observing its late settlement; never resume dispatch after revocation.
function waitForDispatchGate(wait: Promise<void>, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    wait.then(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, error => {
      signal.removeEventListener("abort", abort);
      reject(error);
    });
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative integer`);
  }
}

export * from "./claimed-environment-work.js";
export type { RuntimeResourceScope, HarnessSupervisorHarness, HarnessSupervisorRun } from "./contracts.js";

export * from "./acp-subagents.js";
export * from "./input-identity.js";
