/** Local diagnostic, never an authorization grant or a crash-recovery ledger.
 * An unknown/published terminal must NOT be retried by rerunning the model.
 * Across restart, the host must resolve the authoritative canonical terminal
 * and select its existing publication-only recovery path BEFORE harness start.
 */
export class ManagedHarnessFinalizationError extends Error {
    phase;
    completion;
    name = "ManagedHarnessFinalizationError";
    terminalState;
    constructor(phase, completion, cause) {
        super(`Managed turn finalization failed (${phase}): ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
        this.phase = phase;
        this.completion = completion;
        this.terminalState = phase === "after-terminal" ? "published"
            : phase === "terminal" ? "unknown" : "not-published";
    }
}
export async function finalizeManagedTurn(input) {
    let phase = "drain-turn";
    const check = () => input.context.signal.throwIfAborted();
    try {
        check();
        await input.port.drainTurn(input.context);
        check();
        await input.context.flush();
        check();
        phase = "native-checkpoint";
        await input.nativeCheckpoint();
        check();
        phase = "checkpoint";
        await input.checkpoint();
        check();
        // No abort race around publication: a late ACK still means committed.
        phase = "terminal";
        await input.publish();
        phase = "after-terminal";
        check();
        await input.port.afterTerminal({ ...input.context, completion: input.completion });
        check();
    }
    catch (cause) {
        throw new ManagedHarnessFinalizationError(phase, input.completion, cause);
    }
}
//# sourceMappingURL=finalization.js.map