import type {
  AcpRuntime,
  AcpSession,
  SessionOptions,
} from "../acp-runtime/index.js";
import type { SessionHostEvent } from "../session-kernel/index.js";
import type {
  ManagedAgentsSessionCheckpoint,
  ManagedAgentsSessionCheckpointStore,
} from "./checkpoint.js";

export type ManagedAgentsInputAcceptance = "prompt-dispatched" | "injected" | "startedNewTurn";

/** Per-dispatch control-plane hooks. Neither hook creates a reservation ledger.
 * A dispatched prompt is not proof of remote acceptance or exactly-once execution. */
export interface ManagedAgentsInputDispatchHooks {
  signal?: AbortSignal;
  beforeDispatch(kind?: "prompt" | "steer"): Promise<void>;
  onConsumed(acceptance: ManagedAgentsInputAcceptance): Promise<void>;
  /** Wrap only a confirmed prompt fallback, after permission has settled.
   * The supplied dispatch retains the original gate and receipt hooks. */
  runPromptFallback?(input: ManagedAgentsSessionPromptInput, dispatch: () => Promise<void>): Promise<void>;
}

/** Lifecycle controls do not opt into fenced consumption semantics. */
export interface ManagedAgentsDispatchLifecycle {
  signal?: AbortSignal;
  runPromptFallback?(input: ManagedAgentsSessionPromptInput, dispatch: () => Promise<void>): Promise<void>;
}

export class ManagedAgentsInputDispatchError extends Error {
  readonly name = "ManagedAgentsInputDispatchError";
  readonly outcome = "unknown";
  constructor(readonly inputId: string, readonly phase: "dispatch" | "receipt", cause: unknown) {
    super(
      `Input ${inputId} has unknown ${phase} outcome; do not automatically replay`,
      { cause },
    );
  }
}

async function waitForPermission(wait: Promise<void>, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (!signal) return wait;
  let abort!: () => void;
  try {
    await Promise.race([wait, new Promise<never>((_, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
    })]);
  } finally { signal.removeEventListener("abort", abort); }
}

export interface ManagedAgentsSessionHostDependencies {
  runtime: AcpRuntime;
  emit(event: SessionHostEvent): void;
  scheduler?: ManagedAgentsRuntimeScheduler;
  /** Grace after ACP session/cancel before a stuck child is disposed. When
   * omitted the host preserves the legacy abort-only behavior. */
  cancelGraceMs?: number;
  checkpointStore?: ManagedAgentsSessionCheckpointStore;
  /** Unique per running host process/isolate. Required with a checkpoint
   * store so generations can fence stale restored copies. */
  hostInstanceId?: string;
}

export interface ManagedAgentsRuntimeScheduler {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface ManagedAgentsDrainOptions {
  deadlineMs: number;
  pollIntervalMs?: number;
  abortGraceMs?: number;
  onProgress?(activeTurns: number, msLeft: number): void;
}

export interface ManagedAgentsDrainReport {
  initialTurns: number;
  abortedTurns: number;
  sessions: number;
}

export const systemRuntimeScheduler: ManagedAgentsRuntimeScheduler = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export interface ManagedAgentsSessionStartInput {
  sessionId: string;
  options: SessionOptions;
}

export interface ManagedAgentsSessionPromptInput {
  sessionId: string;
  turnId: string;
  text: string;
}

export interface ManagedAgentsSessionSteerInput {
  sessionId: string;
  eventId: string;
  text: string;
}

interface ActiveSession {
  acp: AcpSession;
  dispatchAbort: AbortController;
  turns: Map<string, AbortController>;
  completedTurns: Set<string>;
  inputFailures: Map<string, ManagedAgentsInputDispatchError>;
  inputDispatches: Map<string, Promise<void>>;
  checkpoint?: ManagedAgentsSessionCheckpoint;
}

export class ManagedAgentsSessionHost {
  readonly #runtime: AcpRuntime;
  readonly #emit: (event: SessionHostEvent) => void;
  readonly #scheduler: ManagedAgentsRuntimeScheduler;
  readonly #cancelGraceMs: number | undefined;
  readonly #checkpointStore: ManagedAgentsSessionCheckpointStore | undefined;
  readonly #hostInstanceId: string | undefined;
  readonly #sessions = new Map<string, ActiveSession>();
  readonly #resumeSessionIds = new Map<string, string>();
  #draining = false;

  constructor(dependencies: ManagedAgentsSessionHostDependencies) {
    this.#runtime = dependencies.runtime;
    this.#emit = dependencies.emit;
    this.#scheduler = dependencies.scheduler ?? systemRuntimeScheduler;
    this.#cancelGraceMs = dependencies.cancelGraceMs;
    this.#checkpointStore = dependencies.checkpointStore;
    this.#hostInstanceId = dependencies.hostInstanceId;
    if (this.#checkpointStore && !this.#hostInstanceId) {
      throw new Error("hostInstanceId is required when checkpointStore is configured");
    }
  }

  has(sessionId: string): boolean {
    return this.#liveSession(sessionId) !== undefined;
  }

  sessionCount(): number {
    this.#pruneDeadSessions();
    return this.#sessions.size;
  }

  announce(sessionId: string): boolean {
    const session = this.#liveSession(sessionId);
    if (!session) return false;
    this.#emit({
      type: "session.ready",
      sessionId,
      acpSessionId: session.acp.acpSessionId,
    });
    return true;
  }

  announceAll(): void {
    for (const sessionId of [...this.#sessions.keys()]) {
      const session = this.#liveSession(sessionId);
      if (!session) continue;
      this.#emit({
        type: "session.ready",
        sessionId,
        acpSessionId: session.acp.acpSessionId,
      });
    }
  }

  activeTurnCount(): number {
    let count = 0;
    for (const session of this.#sessions.values()) count += session.turns.size;
    return count;
  }

  async start(input: ManagedAgentsSessionStartInput): Promise<void> {
    if (this.#draining) {
      this.#emit({
        type: "session.error",
        sessionId: input.sessionId,
        message: "runtime is draining; retry on another runtime",
      });
      return;
    }
    if (this.announce(input.sessionId)) return;

    let claimedCheckpoint: ManagedAgentsSessionCheckpoint | undefined;
    let durableCheckpoint: ManagedAgentsSessionCheckpoint | null = null;
    if (this.#checkpointStore) {
      try {
        durableCheckpoint = await this.#checkpointStore.load(input.sessionId);
        const nextGeneration = (durableCheckpoint?.generation ?? 0) + 1;
        claimedCheckpoint = {
          sessionId: input.sessionId,
          generation: nextGeneration,
          ownerId: this.#hostInstanceId!,
          acpSessionId: durableCheckpoint?.acpSessionId ?? "",
          phase: "recovering",
          updatedAt: this.#scheduler.now(),
          ...(durableCheckpoint?.lastCompletedTurnId
            ? { lastCompletedTurnId: durableCheckpoint.lastCompletedTurnId }
            : {}),
        };
        const claimed = await this.#checkpointStore.compareAndSet({
          expectedGeneration: durableCheckpoint?.generation ?? null,
          checkpoint: claimedCheckpoint,
        });
        if (!claimed) {
          this.#emitLeaseLost(input.sessionId);
          return;
        }
      } catch (error) {
        this.#emit({
          type: "session.error",
          sessionId: input.sessionId,
          message: `session checkpoint failed: ${error instanceof Error ? error.message : String(error)}`,
        });
        return;
      }
    }

    const recoverySessionId = this.#resumeSessionIds.get(input.sessionId)
      ?? durableCheckpoint?.acpSessionId;
    const options = recoverySessionId && !input.options.resumeAcpSessionId
      ? { ...input.options, resumeAcpSessionId: recoverySessionId }
      : input.options;
    let session: AcpSession;
    try {
      session = await this.#runtime.start(options);
    } catch (error) {
      this.#emit({
        type: "session.error",
        sessionId: input.sessionId,
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    this.#sessions.set(input.sessionId, {
      acp: session,
      dispatchAbort: new AbortController(),
      turns: new Map(),
      inputFailures: new Map(),
      inputDispatches: new Map(),
      completedTurns: new Set(
        durableCheckpoint?.lastCompletedTurnId
          ? [durableCheckpoint.lastCompletedTurnId]
          : [],
      ),
      ...(claimedCheckpoint ? { checkpoint: claimedCheckpoint } : {}),
    });

    if (claimedCheckpoint && this.#checkpointStore) {
      const readyCheckpoint: ManagedAgentsSessionCheckpoint = {
        ...claimedCheckpoint,
        acpSessionId: session.acpSessionId,
        phase: "ready",
        updatedAt: this.#scheduler.now(),
      };
      const retained = await this.#checkpointStore.compareAndSet({
        expectedGeneration: claimedCheckpoint.generation,
        checkpoint: readyCheckpoint,
      }).catch(() => false);
      if (!retained) {
        this.#sessions.delete(input.sessionId);
        await session.dispose().catch(() => undefined);
        this.#emitLeaseLost(input.sessionId);
        return;
      }
      this.#sessions.get(input.sessionId)!.checkpoint = readyCheckpoint;
    }
    this.#resumeSessionIds.delete(input.sessionId);
    this.#emit({
      type: "session.ready",
      sessionId: input.sessionId,
      acpSessionId: session.acpSessionId,
    });
  }

  async prompt(input: ManagedAgentsSessionPromptInput, hooks?: ManagedAgentsInputDispatchHooks, lifecycle?: ManagedAgentsDispatchLifecycle): Promise<void> {
    const session = this.#liveSession(input.sessionId);
    if (!session) {
      this.#emit({
        type: "session.error",
        sessionId: input.sessionId,
        turnId: input.turnId,
        message: "no such session",
      });
      return;
    }
    const previousFailure = session.inputFailures.get(input.turnId);
    if (previousFailure) throw previousFailure;
    if (session.completedTurns.has(input.turnId)) {
      this.#emit({
        type: "session.complete",
        sessionId: input.sessionId,
        turnId: input.turnId,
      });
      return;
    }
    if (session.turns.has(input.turnId)) return;
    // Draining closes admission for new turns on retained sessions too.
    // Existing in-flight/complete turn IDs above remain idempotent.
    const rejectDuringDrain = () => {
      if (!this.#draining) return false;
      this.#emit({
        type: "session.error",
        sessionId: input.sessionId,
        turnId: input.turnId,
        message: "runtime is draining; retry on another runtime",
      });
      return true;
    };
    if (rejectDuringDrain()) return;
    if (!await this.#retainGenerationLease(input.sessionId, session)) return;
    // Lease storage may yield while shutdown starts.
    if (rejectDuringDrain()) return;
    const controller = new AbortController();
    const signal = lifecycle?.signal ?? hooks?.signal;
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    session.turns.set(input.turnId, controller);
    let promptError: string | undefined;
    let dispatched = false;
    let attempted = false;
    try {
      signal?.throwIfAborted();
      if (hooks) {
        hooks.signal?.throwIfAborted();
        await waitForPermission(hooks.beforeDispatch("prompt"), hooks.signal);
        hooks.signal?.throwIfAborted();
        controller.signal.throwIfAborted();
      }
      signal?.throwIfAborted();
      controller.signal.throwIfAborted();
      // Every async admission/lease wait is now over. Keep this check and
      // the ACP invocation in the same synchronous dispatch boundary.
      if (this.#draining || this.#sessions.get(input.sessionId) !== session || !session.acp.isAlive()) {
        throw new Error("Session no longer admits input dispatch");
      }
      attempted = true;
      for await (const event of session.acp.prompt(input.text, {
        abortSignal: controller.signal,
        ...(hooks ? { onDispatched: async () => {
          dispatched = true;
          try { await hooks.onConsumed("prompt-dispatched"); }
          catch (error) { throw new ManagedAgentsInputDispatchError(input.turnId, "receipt", error); }
        } } : {}),
      })) {
        if (controller.signal.aborted) break;
        const sentinel = event as {
          type?: unknown;
          error?: unknown;
        } | null;
        if (sentinel?.type === "promptComplete") {
          this.#emit({
            type: "session.event",
            sessionId: input.sessionId,
            turnId: input.turnId,
            event,
          });
          continue;
        }
        if (sentinel?.type === "promptError") {
          promptError = typeof sentinel.error === "string"
            ? sentinel.error
            : "ACP prompt error (no message)";
          continue;
        }
        this.#emit({
          type: "session.event",
          sessionId: input.sessionId,
          turnId: input.turnId,
          event,
        });
      }
      if (hooks && !dispatched) throw new Error("ACP adapter did not report prompt dispatch");
      if (hooks && promptError) throw new ManagedAgentsInputDispatchError(input.turnId, "dispatch", promptError);
      if (promptError) {
        this.#emit({
            type: "session.error",
            sessionId: input.sessionId,
            turnId: input.turnId,
            message: promptError,
        });
      } else {
        if (!await this.#commitCompletedTurn(input.sessionId, session, input.turnId)) {
          return;
        }
        session.completedTurns.add(input.turnId);
        this.#emit({
          type: "session.complete",
          sessionId: input.sessionId,
          turnId: input.turnId,
        });
      }
    } catch (error) {
      if (hooks) {
        if (attempted || error instanceof ManagedAgentsInputDispatchError) {
          const failure = error instanceof ManagedAgentsInputDispatchError ? error : new ManagedAgentsInputDispatchError(input.turnId, "dispatch", error);
          session.inputFailures.set(input.turnId, failure);
          controller.abort(failure);
          throw failure;
        }
        throw error;
      }
      this.#emit({
        type: "session.error",
        sessionId: input.sessionId,
        turnId: input.turnId,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      signal?.removeEventListener("abort", abort);
      session.turns.delete(input.turnId);
    }
  }

  async steer(input: ManagedAgentsSessionSteerInput, hooks?: ManagedAgentsInputDispatchHooks, lifecycle?: ManagedAgentsDispatchLifecycle): Promise<void> {
    const session = this.#liveSession(input.sessionId);
    if (!session) {
      this.#emit({
        type: "session.error",
        sessionId: input.sessionId,
        turnId: input.eventId,
        message: "no such session",
      });
      return;
    }
    const failure = session.inputFailures.get(input.eventId);
    if (failure) throw failure;
    if (hooks && session.completedTurns.has(input.eventId)) return;
    if (hooks) {
      const pending = session.inputDispatches.get(input.eventId);
      if (pending) return pending;
      // Host disposal must revoke admission even when callers omit a signal
      // and adapters keep reporting isAlive() after disposal.
      const signal = hooks.signal
        ? AbortSignal.any([hooks.signal, session.dispatchAbort.signal])
        : session.dispatchAbort.signal;
      const assertCurrent = () => {
        signal.throwIfAborted();
        if (this.#draining || this.#sessions.get(input.sessionId) !== session || !session.acp.isAlive()) {
          throw new Error("Session changed before input dispatch");
        }
      };
      const task = Promise.resolve().then(async () => {
        const fallback = async () => {
          if ((session.acp.openPermissionRequests ?? 0) > 0 && session.acp.whenPermissionsSettled) {
            await waitForPermission(session.acp.whenPermissionsSettled(), signal);
          }
          assertCurrent();
          const prompt = { sessionId: input.sessionId, turnId: input.eventId, text: input.text };
          // The host admission signal only guards the pre-dispatch wait.
          // Once submitted, the prompt retains caller cancellation and its
          // turn controller; drain must allow its normal grace period.
          const dispatch = () => this.prompt(prompt, {
            ...hooks,
            beforeDispatch: async () => {
              assertCurrent();
              await waitForPermission(hooks.beforeDispatch("prompt"), signal);
              assertCurrent();
            },
          });
          if (hooks.runPromptFallback) await hooks.runPromptFallback(prompt, dispatch);
          else await dispatch();
        };
        if (session.turns.size === 0 || !session.acp.supportsSteering) return fallback();
        assertCurrent();
        await waitForPermission(hooks.beforeDispatch("steer"), signal);
        assertCurrent();
        let outcome;
        try { outcome = await session.acp.steer(input.text); }
        catch (error) {
          const failure = new ManagedAgentsInputDispatchError(input.eventId, "dispatch", error);
          session.inputFailures.set(input.eventId, failure);
          throw failure;
        }
        if (outcome === "promptRequired") return fallback();
        if (outcome !== "injected" && outcome !== "startedNewTurn") {
          const failure = new ManagedAgentsInputDispatchError(input.eventId, "dispatch", outcome);
          session.inputFailures.set(input.eventId, failure);
          throw failure;
        }
        // Acceptance remains a fact even if cancellation raced the response.
        try { await hooks.onConsumed(outcome); }
        catch (error) {
          const failure = new ManagedAgentsInputDispatchError(input.eventId, "receipt", error);
          session.inputFailures.set(input.eventId, failure);
          throw failure;
        }
        session.completedTurns.add(input.eventId);
        return;
      });
      session.inputDispatches.set(input.eventId, task);
      try { await task; }
      finally { session.inputDispatches.delete(input.eventId); }
      return;
    }
    if (lifecycle?.runPromptFallback) {
      // Completion-only observers preserve legacy failed/throw fallback policy.
      // Do not catch errors from fallback/evaluation as native steer failures.
      const fallback = async () => {
        if ((session.acp.openPermissionRequests ?? 0) > 0 && session.acp.whenPermissionsSettled) {
          await waitForPermission(session.acp.whenPermissionsSettled().catch(() => undefined), lifecycle.signal);
        }
        lifecycle.signal?.throwIfAborted();
        const prompt = { sessionId: input.sessionId, turnId: input.eventId, text: input.text };
        await lifecycle.runPromptFallback!(prompt, () => this.prompt(prompt, undefined, lifecycle));
      };
      lifecycle.signal?.throwIfAborted();
      if (session.turns.size === 0 || !session.acp.supportsSteering) return fallback();
      let outcome;
      try { outcome = await session.acp.steer(input.text); }
      catch { return fallback(); }
      if (outcome === "promptRequired" || outcome === "failed") await fallback();
      return;
    }
    if (session.turns.size === 0) {
      await this.prompt({
        sessionId: input.sessionId,
        turnId: input.eventId,
        text: input.text,
      });
      return;
    }
    // Unsupported steering / promptRequired / failed / throw → queue as a
    // normal prompt (no session.error, message is not dropped). When another
    // turn is already in flight, do not await: steer must return promptly and
    // the fallback prompt runs concurrently (ACP backends serialize).
    // While session/request_permission is open, a fallback prompt would race
    // the blocked turn (and some agents cancel the running prompt, which
    // cancels the permission request and hides its card). Match
    // claude-agent-acp's "later" steering: wait for the permission to settle,
    // never cancel it; only an explicit session/cancel ends it.
    const queueAsPrompt = () => {
      const send = () => {
        void this.prompt({
          sessionId: input.sessionId,
          turnId: input.eventId,
          text: input.text,
        });
      };
      if ((session.acp.openPermissionRequests ?? 0) > 0 && session.acp.whenPermissionsSettled) {
        void session.acp.whenPermissionsSettled().then(send, send);
        return;
      }
      send();
    };
    if (!session.acp.supportsSteering) {
      queueAsPrompt();
      return;
    }
    try {
      const outcome = await session.acp.steer(input.text);
      if (outcome === "promptRequired" || outcome === "failed") {
        queueAsPrompt();
      }
    } catch (error) {
      void error;
      queueAsPrompt();
    }
  }

  async dispose(sessionId: string): Promise<void> {
    const session = this.#sessions.get(sessionId);
    if (session) {
      session.dispatchAbort.abort(new Error("Session disposed"));
      for (const controller of session.turns.values()) controller.abort();
      await session.acp.dispose().catch(() => undefined);
      if (this.#sessions.get(sessionId) === session) this.#sessions.delete(sessionId);
    }
    this.#resumeSessionIds.delete(sessionId);
    if (this.#checkpointStore) {
      await this.#checkpointStore.delete({
        sessionId,
        ...(session?.checkpoint
          ? {
              expectedGeneration: session.checkpoint.generation,
              ownerId: session.checkpoint.ownerId,
            }
          : {}),
      }).catch(() => undefined);
    }
    this.#emit({ type: "session.disposed", sessionId });
  }

  async disposeAll(): Promise<void> {
    const sessions = [...this.#sessions.entries()];
    await Promise.all(sessions.map(async ([sessionId, session]) => {
      session.dispatchAbort.abort(new Error("Session disposed"));
      for (const controller of session.turns.values()) controller.abort();
      await session.acp.dispose().catch(() => undefined);
      if (this.#sessions.get(sessionId) === session) this.#sessions.delete(sessionId);
    }));
  }

  async drain(options: ManagedAgentsDrainOptions): Promise<ManagedAgentsDrainReport> {
    this.#draining = true;
    // Close admission immediately, not after the active-turn grace period.
    // Already submitted steer calls still settle their acceptance receipts.
    for (const session of this.#sessions.values()) {
      session.dispatchAbort.abort(new Error("Session host draining"));
    }
    const initialTurns = this.activeTurnCount();
    const sessions = this.sessionCount();
    const startedAt = this.#scheduler.now();
    const pollIntervalMs = options.pollIntervalMs ?? 200;

    while (this.activeTurnCount() > 0) {
      const elapsed = this.#scheduler.now() - startedAt;
      if (elapsed >= options.deadlineMs) break;
      const msLeft = options.deadlineMs - elapsed;
      options.onProgress?.(this.activeTurnCount(), msLeft);
      await this.#scheduler.sleep(Math.min(pollIntervalMs, msLeft));
    }

    let abortedTurns = 0;
    for (const session of this.#sessions.values()) {
      for (const controller of session.turns.values()) {
        if (!controller.signal.aborted) {
          controller.abort();
          abortedTurns += 1;
        }
      }
    }
    if (abortedTurns > 0 && (options.abortGraceMs ?? 2_000) > 0) {
      await this.#scheduler.sleep(options.abortGraceMs ?? 2_000);
    }
    await this.disposeAll();
    return { initialTurns, abortedTurns, sessions };
  }

  async cancel(sessionId: string, turnId: string): Promise<void> {
    const session = this.#sessions.get(sessionId);
    const controller = session?.turns.get(turnId);
    if (!session || !controller) return;
    controller.abort();
    if (this.#cancelGraceMs === undefined) return;

    await this.#scheduler.sleep(this.#cancelGraceMs);
    if (this.#sessions.get(sessionId) !== session || !session.turns.has(turnId)) {
      return;
    }
    session.dispatchAbort.abort(new Error("Session no longer live"));
    this.#rememberForRecovery(sessionId, session);
    this.#sessions.delete(sessionId);
    await session.acp.dispose().catch(() => undefined);
  }

  #liveSession(sessionId: string): ActiveSession | undefined {
    const session = this.#sessions.get(sessionId);
    if (!session) return undefined;
    if (session.acp.isAlive()) return session;
    session.dispatchAbort.abort(new Error("Session no longer live"));
    this.#rememberForRecovery(sessionId, session);
    this.#sessions.delete(sessionId);
    void session.acp.dispose().catch(() => undefined);
    return undefined;
  }

  #pruneDeadSessions(): void {
    for (const sessionId of [...this.#sessions.keys()]) {
      this.#liveSession(sessionId);
    }
  }

  #rememberForRecovery(sessionId: string, session: ActiveSession): void {
    if (session.acp.acpSessionId) {
      this.#resumeSessionIds.set(sessionId, session.acp.acpSessionId);
    }
    if (session.checkpoint && this.#checkpointStore) {
      const recovering: ManagedAgentsSessionCheckpoint = {
        ...session.checkpoint,
        acpSessionId: session.acp.acpSessionId,
        phase: "recovering",
        updatedAt: this.#scheduler.now(),
      };
      void this.#checkpointStore.compareAndSet({
        expectedGeneration: session.checkpoint.generation,
        checkpoint: recovering,
      }).then((saved) => {
        if (saved) session.checkpoint = recovering;
      }).catch(() => undefined);
    }
  }

  async #retainGenerationLease(
    sessionId: string,
    session: ActiveSession,
  ): Promise<boolean> {
    if (!session.checkpoint || !this.#checkpointStore) return true;
    const retainedCheckpoint: ManagedAgentsSessionCheckpoint = {
      ...session.checkpoint,
      updatedAt: this.#scheduler.now(),
    };
    const retained = await this.#checkpointStore.compareAndSet({
      expectedGeneration: session.checkpoint.generation,
      checkpoint: retainedCheckpoint,
    }).catch(() => false);
    if (retained) {
      session.checkpoint = retainedCheckpoint;
      return true;
    }
    session.dispatchAbort.abort(new Error("Session generation lease lost"));
    if (this.#sessions.get(sessionId) === session) {
      this.#sessions.delete(sessionId);
    }
    await session.acp.dispose().catch(() => undefined);
    this.#emitLeaseLost(sessionId);
    return false;
  }

  async #commitCompletedTurn(
    sessionId: string,
    session: ActiveSession,
    turnId: string,
  ): Promise<boolean> {
    if (!session.checkpoint || !this.#checkpointStore) return true;
    const completedCheckpoint: ManagedAgentsSessionCheckpoint = {
      ...session.checkpoint,
      lastCompletedTurnId: turnId,
      updatedAt: this.#scheduler.now(),
    };
    const committed = await this.#checkpointStore.compareAndSet({
      expectedGeneration: session.checkpoint.generation,
      checkpoint: completedCheckpoint,
    }).catch(() => false);
    if (committed) {
      session.checkpoint = completedCheckpoint;
      return true;
    }
    session.dispatchAbort.abort(new Error("Session generation lease lost"));
    if (this.#sessions.get(sessionId) === session) {
      this.#sessions.delete(sessionId);
    }
    await session.acp.dispose().catch(() => undefined);
    this.#emitLeaseLost(sessionId);
    return false;
  }

  #emitLeaseLost(sessionId: string): void {
    this.#emit({
      type: "session.error",
      sessionId,
      message: "runtime lost the session generation lease",
    });
  }
}
