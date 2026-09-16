/**
 * Host-neutral session scheduling state.
 *
 * ACP owns prompt completion; this class owns the client-side policy around
 * which prompt may start next. It deliberately contains no transport,
 * persistence, workspace provisioning, or UI behavior.
 */
export class SessionOrchestrator {
    sessionId;
    #now;
    #activeTurnId = null;
    #queued = [];
    #steeringTurnIds = new Set();
    #restartPending = false;
    #disposed = false;
    constructor(options) {
        this.sessionId = options.sessionId;
        this.#now = options.now ?? Date.now;
    }
    get activeTurnId() {
        return this.#activeTurnId;
    }
    get queued() {
        return this.#queued;
    }
    get steeringTurnIds() {
        return [...this.#steeringTurnIds];
    }
    get restartPending() {
        return this.#restartPending;
    }
    get disposed() {
        return this.#disposed;
    }
    isBusy() {
        return (this.#activeTurnId !== null
            || this.#queued.length > 0
            || this.#steeringTurnIds.size > 0);
    }
    tryStartTurn(turnId) {
        if (this.#disposed
            || this.#restartPending
            || this.#activeTurnId !== null
            || this.#queued.length > 0
            || this.#steeringTurnIds.size > 0)
            return false;
        this.#activeTurnId = turnId;
        return true;
    }
    finishTurn(turnId) {
        if (this.#activeTurnId !== turnId)
            return false;
        this.#activeTurnId = null;
        return true;
    }
    enqueue(turnId, value) {
        const existing = this.#queued.find((entry) => entry.turnId === turnId);
        if (existing) {
            existing.value = value;
            return existing;
        }
        const entry = {
            turnId,
            value,
            createdAt: this.#now(),
        };
        this.#queued.push(entry);
        return entry;
    }
    claimNext() {
        if (this.#disposed
            || this.#restartPending
            || this.#activeTurnId !== null
            || this.#steeringTurnIds.size > 0)
            return null;
        const next = this.#queued.shift();
        if (!next)
            return null;
        this.#activeTurnId = next.turnId;
        return next;
    }
    clearQueue() {
        return this.#queued.splice(0);
    }
    removeQueued(turnId) {
        const index = this.#queued.findIndex((entry) => entry.turnId === turnId);
        if (index < 0)
            return null;
        return this.#queued.splice(index, 1)[0] ?? null;
    }
    updateQueued(turnId, update) {
        const queued = this.#queued.find((entry) => entry.turnId === turnId);
        if (!queued)
            return false;
        queued.value = update(queued.value);
        return true;
    }
    reorderQueue(turnIds) {
        const order = new Map();
        for (const [index, turnId] of turnIds.entries()) {
            if (!order.has(turnId))
                order.set(turnId, index);
        }
        this.#queued.sort((left, right) => {
            const leftIndex = order.get(left.turnId);
            const rightIndex = order.get(right.turnId);
            if (leftIndex === undefined && rightIndex === undefined) {
                return left.createdAt - right.createdAt;
            }
            if (leftIndex === undefined)
                return 1;
            if (rightIndex === undefined)
                return -1;
            return leftIndex - rightIndex;
        });
    }
    beginSteering(turnId) {
        if (this.#disposed
            || this.#activeTurnId === null
            || this.#steeringTurnIds.has(turnId))
            return false;
        this.#steeringTurnIds.add(turnId);
        return true;
    }
    finishSteering(turnId) {
        return this.#steeringTurnIds.delete(turnId);
    }
    requestRestart(mode) {
        if (mode === "after-turn"
            && (this.#activeTurnId !== null || this.#steeringTurnIds.size > 0)) {
            this.#restartPending = true;
            return "pending";
        }
        return "ready";
    }
    clearRestart() {
        this.#restartPending = false;
    }
    dispose() {
        if (this.#disposed)
            return [];
        this.#disposed = true;
        this.#activeTurnId = null;
        this.#steeringTurnIds.clear();
        this.#restartPending = false;
        return this.clearQueue();
    }
}
/** Normalize session inheritance once before a host opens an ACP session. */
export function sessionInheritance(input) {
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
//# sourceMappingURL=index.js.map