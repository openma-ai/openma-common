import { it, expect } from "vitest";
import { createManagedAcpSupervisorHarness, type ManagedHarnessControlMessage } from "../src/managed-runtime/index.js";
import { acpSessionFixture } from "./acp-fixtures.js";
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
const scope = { workspaceId: "w", environmentId: "e", sessionId: "s", workId: "work" };
const start: ManagedHarnessControlMessage = { type: "session.start", sessionId: "s", agentId: "acp", runtime: "cloud" };
const first: ManagedHarnessControlMessage = { type: "session.prompt", sessionId: "s", turnId: "first", text: "first" };
const steer: ManagedHarnessControlMessage = { type: "session.steer", sessionId: "s", eventId: "steer", text: "steer" };

it("EOF revokes an unresolved steer gate before reporting failure", async () => {
  const active = deferred(), gate = deferred(), entered = deferred(), release = deferred();
  const log: string[] = []; let signal: AbortSignal | undefined;
  const harness = createManagedAcpSupervisorHarness({
    connect: async () => ({
      async *commands() { yield start; yield first; await active.promise; yield steer; await entered.promise; },
      publish: async () => {}, close: async () => {},
      beforeDispatch: async (command, s) => { if (command.turnId === "steer") { signal = s; entered.resolve(); await gate.promise; } },
      onConsumed: async command => { log.push("receipt:" + command.turnId); },
    }),
    acpRuntime: { start: async () => acpSessionFixture({ acpSessionId: "a", async *prompt(_, options) { await options?.onDispatched?.(); active.resolve(); await release.promise; }, async steer() { log.push("steer"); return "injected"; } }) },
    sessionPreparation: { prepare: async () => ({ agent: { command: "a" } }) },
    sessionState: { beforeStart: async command => ({ command }), onReady: async () => {}, checkpoint: async () => {}, release: async () => {} }, drainDeadlineMs: 0, abortGraceMs: 0,
  });
  const run = await harness.start({ scope, harness: { id: "a", version: "1" }, workspacePath: "/workspace", outputPath: null, checkpoint: async () => {}, signal: new AbortController().signal });
  try {
    await expect(run.completed).rejects.toThrow("closed before control.complete");
    expect(signal?.aborted).toBe(true);
    gate.resolve(); await new Promise(r => setTimeout(r, 10));
    expect(log).not.toContain("steer"); expect(log).not.toContain("receipt:steer");
  } finally { gate.resolve(); release.resolve(); await run.stop("failed"); }
});

it.each(["promptRequired", "failed", "throw"] as const)("completion-only fallback evaluates %s without enabling fenced consumption", async outcome => {
  const active = deferred(), release = deferred(); const log: string[] = [];
  const harness = createManagedAcpSupervisorHarness({
    connect: async () => ({
      async *commands() { yield start; yield first; await active.promise; yield steer; yield { type: "control.complete", workId: "work" }; },
      publish: async event => { if (event.type === "session.complete") log.push("complete:" + event.turnId); }, close: async () => {},
    }),
    acpRuntime: { start: async () => acpSessionFixture({ acpSessionId: "a", async *prompt(text, options) { log.push("prompt:" + text); await options?.onDispatched?.(); if (text === "first") { active.resolve(); await release.promise; } }, async steer() { release.resolve(); if (outcome === "throw") throw new Error("legacy transport"); return outcome; } }) },
    sessionPreparation: { prepare: async () => ({ agent: { command: "a" } }) },
    sessionState: { beforeStart: async command => ({ command }), onReady: async () => {}, checkpoint: async () => {}, release: async () => {} },
    async onTurnComplete(turn) { if (turn.command.turnId === "steer") { expect(log).not.toContain("complete:steer"); await turn.runRevision({ turnId: "revision", text: "revise" }); await turn.flush(); log.push("evaluated:steer"); } },
  });
  const run = await harness.start({ scope, harness: { id: "a", version: "1" }, workspacePath: "/workspace", outputPath: null, checkpoint: async () => {}, signal: new AbortController().signal });
  try { await run.completed; expect(log).toContain("prompt:revise"); expect(log).not.toContain("complete:revision"); expect(log.indexOf("evaluated:steer")).toBeLessThan(log.indexOf("complete:steer")); }
  finally { release.resolve(); await run.stop("aborted"); }
});

it("cancel of original turn aborts the fallback revision signal", async () => {
  const active = deferred(), release = deferred(), revision = deferred(), cancelSent = deferred(), releaseRevision = deferred();
  let revisionAborted = false;
  const harness = createManagedAcpSupervisorHarness({
    connect: async () => ({
      async *commands() { yield start; yield first; await active.promise; yield steer; await revision.promise; yield { type: "session.cancel", sessionId: "s", turnId: "first" }; cancelSent.resolve(); yield { type: "control.complete", workId: "work" }; },
      publish: async () => {}, close: async () => {}, onConsumed: async () => {},
    }),
    acpRuntime: { start: async () => acpSessionFixture({ acpSessionId: "a", async *prompt(text, options) {
      await options?.onDispatched?.();
      if (text === "first") { active.resolve(); await release.promise; }
      if (text === "revise") { options?.abortSignal?.addEventListener("abort", () => { revisionAborted = true; releaseRevision.resolve(); }, { once: true }); revision.resolve(); await releaseRevision.promise; }
    }, async steer() { return "promptRequired"; } }) },
    sessionPreparation: { prepare: async () => ({ agent: { command: "a" } }) },
    sessionState: { beforeStart: async command => ({ command }), onReady: async () => {}, checkpoint: async () => {}, release: async () => {} },
    async onTurnComplete(turn) { if (turn.command.turnId === "steer") await turn.runRevision({ turnId: "revision", text: "revise" }); },
  });
  const run = await harness.start({ scope, harness: { id: "a", version: "1" }, workspacePath: "/workspace", outputPath: null, checkpoint: async () => {}, signal: new AbortController().signal });
  const settled = run.completed.catch(() => {});
  try { await cancelSent.promise; await new Promise(r => setTimeout(r, 10)); expect(revisionAborted).toBe(true); }
  finally { release.resolve(); releaseRevision.resolve(); await settled; await run.stop("aborted"); }
});
