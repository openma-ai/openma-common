import type { SessionCompleteEvent } from "../session-kernel/index.js";
import type { ManagedHarnessPromptCommand } from "./index.js";

export interface ManagedHarnessFinalizationContext {
  /** Canonical input identity, not the last internal outcome-revision identity. */
  command: ManagedHarnessPromptCommand;
  signal: AbortSignal;
  /** Flush already-enqueued runtime events; not a tool/subagent drain. */
  flush(): Promise<void>;
}

/** Opt-in safe-point contract. Both functions are required; no default noop.
 *
 * Common first awaits the native prompt iterator, all outcome revisions and
 * admitted native steer calls/receipts, and fences new model dispatch. The host
 * must then join its ACTUAL turn-owned subagent/tool executions in drainTurn
 * (including effects not visible in ACP events), close their admission, and
 * release turn tools. Do not destroy a resident ACP session or call runtime.drain.
 * Keep that admission closed through afterTerminal; future turns may reopen it.
 * A promptComplete event or projected child status is not proof of quiescence.
 *
 * Order: drainTurn -> event flush -> sessionState.checkpoint (native) ->
 * start(input).checkpoint (strict canonical Memory/workspace persistence) ->
 * channel.publish(session.complete) -> afterTerminal (artifact publication).
 * Hosts keep ownership/renewal for this entire sequence. Every persistence Port
 * must check its real authority and reject conflicts; common invents no fence.
 */
export interface ManagedHarnessFinalizationPort {
  drainTurn(context: ManagedHarnessFinalizationContext): Promise<void>;
  afterTerminal(context: ManagedHarnessFinalizationContext & {
    /** Successfully acknowledged by channel.publish, NOT a durable receipt
     * supplied by common. The channel must resolve only after persistence. */
    completion: SessionCompleteEvent;
  }): Promise<void>;
}

export type ManagedHarnessFinalizationPhase =
  | "drain-turn"
  | "native-checkpoint"
  | "checkpoint"
  | "terminal"
  | "after-terminal";

/** Local diagnostic, never an authorization grant or a crash-recovery ledger.
 * An unknown/published terminal must NOT be retried by rerunning the model.
 * Across restart, the host must resolve the authoritative canonical terminal
 * and select its existing publication-only recovery path BEFORE harness start.
 */
export class ManagedHarnessFinalizationError extends Error {
  readonly name = "ManagedHarnessFinalizationError";
  readonly terminalState: "not-published" | "unknown" | "published";
  constructor(
    readonly phase: ManagedHarnessFinalizationPhase,
    readonly completion: SessionCompleteEvent,
    cause: unknown,
  ) {
    super(`Managed turn finalization failed (${phase}): ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.terminalState = phase === "after-terminal" ? "published"
      : phase === "terminal" ? "unknown" : "not-published";
  }
}

export async function finalizeManagedTurn(input: {
  port: ManagedHarnessFinalizationPort;
  context: ManagedHarnessFinalizationContext;
  completion: SessionCompleteEvent;
  nativeCheckpoint(): Promise<void>;
  checkpoint(): Promise<void>;
  publish(): Promise<void>;
}): Promise<void> {
  let phase: ManagedHarnessFinalizationPhase = "drain-turn";
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
  } catch (cause) {
    throw new ManagedHarnessFinalizationError(phase, input.completion, cause);
  }
}
