export type SessionRestartMode = "now" | "after-turn";
export type SessionRestartDisposition = "ready" | "pending";

export interface QueuedSessionTurn<T> {
  readonly turnId: string;
  value: T;
  readonly createdAt: number;
}

export interface SessionOrchestratorOptions {
  sessionId: string;
  now?: () => number;
}

/**
 * Host-neutral session scheduling state.
 *
 * ACP owns prompt completion; this class owns the client-side policy around
 * which prompt may start next. It deliberately contains no transport,
 * persistence, workspace provisioning, or UI behavior.
 */
export class SessionOrchestrator<T> {
  readonly sessionId: string;
  readonly #now: () => number;
  #activeTurnId: string | null = null;
  #queued: Array<QueuedSessionTurn<T>> = [];
  #steeringTurnIds = new Set<string>();
  #restartPending = false;
  #disposed = false;

  constructor(options: SessionOrchestratorOptions) {
    this.sessionId = options.sessionId;
    this.#now = options.now ?? Date.now;
  }

  get activeTurnId(): string | null {
    return this.#activeTurnId;
  }

  get queued(): readonly QueuedSessionTurn<T>[] {
    return this.#queued;
  }

  get steeringTurnIds(): readonly string[] {
    return [...this.#steeringTurnIds];
  }

  get restartPending(): boolean {
    return this.#restartPending;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  isBusy(): boolean {
    return (
      this.#activeTurnId !== null
      || this.#queued.length > 0
      || this.#steeringTurnIds.size > 0
    );
  }

  tryStartTurn(turnId: string): boolean {
    if (
      this.#disposed
      || this.#restartPending
      || this.#activeTurnId !== null
      || this.#queued.length > 0
      || this.#steeringTurnIds.size > 0
    ) return false;
    this.#activeTurnId = turnId;
    return true;
  }

  finishTurn(turnId: string): boolean {
    if (this.#activeTurnId !== turnId) return false;
    this.#activeTurnId = null;
    return true;
  }

  enqueue(turnId: string, value: T): QueuedSessionTurn<T> {
    const existing = this.#queued.find((entry) => entry.turnId === turnId);
    if (existing) {
      existing.value = value;
      return existing;
    }
    const entry: QueuedSessionTurn<T> = {
      turnId,
      value,
      createdAt: this.#now(),
    };
    this.#queued.push(entry);
    return entry;
  }

  claimNext(): QueuedSessionTurn<T> | null {
    if (
      this.#disposed
      || this.#restartPending
      || this.#activeTurnId !== null
      || this.#steeringTurnIds.size > 0
    ) return null;
    const next = this.#queued.shift();
    if (!next) return null;
    this.#activeTurnId = next.turnId;
    return next;
  }

  clearQueue(): QueuedSessionTurn<T>[] {
    return this.#queued.splice(0);
  }

  removeQueued(turnId: string): QueuedSessionTurn<T> | null {
    const index = this.#queued.findIndex((entry) => entry.turnId === turnId);
    if (index < 0) return null;
    return this.#queued.splice(index, 1)[0] ?? null;
  }

  updateQueued(turnId: string, update: (value: T) => T): boolean {
    const queued = this.#queued.find((entry) => entry.turnId === turnId);
    if (!queued) return false;
    queued.value = update(queued.value);
    return true;
  }

  reorderQueue(turnIds: readonly string[]): void {
    const order = new Map<string, number>();
    for (const [index, turnId] of turnIds.entries()) {
      if (!order.has(turnId)) order.set(turnId, index);
    }
    this.#queued.sort((left, right) => {
      const leftIndex = order.get(left.turnId);
      const rightIndex = order.get(right.turnId);
      if (leftIndex === undefined && rightIndex === undefined) {
        return left.createdAt - right.createdAt;
      }
      if (leftIndex === undefined) return 1;
      if (rightIndex === undefined) return -1;
      return leftIndex - rightIndex;
    });
  }

  beginSteering(turnId: string): boolean {
    if (
      this.#disposed
      || this.#activeTurnId === null
      || this.#steeringTurnIds.has(turnId)
    ) return false;
    this.#steeringTurnIds.add(turnId);
    return true;
  }

  finishSteering(turnId: string): boolean {
    return this.#steeringTurnIds.delete(turnId);
  }

  requestRestart(mode: SessionRestartMode): SessionRestartDisposition {
    if (
      mode === "after-turn"
      && (this.#activeTurnId !== null || this.#steeringTurnIds.size > 0)
    ) {
      this.#restartPending = true;
      return "pending";
    }
    return "ready";
  }

  clearRestart(): void {
    this.#restartPending = false;
  }

  dispose(): QueuedSessionTurn<T>[] {
    if (this.#disposed) return [];
    this.#disposed = true;
    this.#activeTurnId = null;
    this.#steeringTurnIds.clear();
    this.#restartPending = false;
    return this.clearQueue();
  }
}

export interface SessionForkSource {
  acpSessionId: string;
  sessionId?: string;
}

export interface SessionInheritanceInput {
  cwd: string;
  additionalDirectories?: readonly string[];
  resumeAcpSessionId?: string;
  forkFrom?: SessionForkSource;
}

export type SessionInheritance =
  | {
      kind: "new";
      cwd: string;
      additionalDirectories: string[];
    }
  | {
      kind: "resume";
      cwd: string;
      additionalDirectories: string[];
      resumeAcpSessionId: string;
    }
  | {
      kind: "fork";
      cwd: string;
      additionalDirectories: string[];
      parentSessionId?: string;
      forkFromAcpSessionId: string;
    };

/** Normalize session inheritance once before a host opens an ACP session. */
export function sessionInheritance(
  input: SessionInheritanceInput,
): SessionInheritance {
  if (input.resumeAcpSessionId && input.forkFrom?.acpSessionId) {
    throw new Error("cannot resume and fork the same session");
  }
  const base = {
    cwd: input.cwd,
    additionalDirectories: [...(input.additionalDirectories ?? [])],
  };
  if (input.forkFrom?.acpSessionId) {
    return {
      kind: "fork",
      ...base,
      ...(input.forkFrom.sessionId
        ? { parentSessionId: input.forkFrom.sessionId }
        : {}),
      forkFromAcpSessionId: input.forkFrom.acpSessionId,
    };
  }
  if (input.resumeAcpSessionId) {
    return {
      kind: "resume",
      ...base,
      resumeAcpSessionId: input.resumeAcpSessionId,
    };
  }
  return { kind: "new", ...base };
}
