import { expect, it, describe, vi } from "vitest";
import { createManagedHarnessHttpControlChannel, createManagedAcpSupervisorHarness } from "../src/managed-runtime/index.js";
import { acpSessionFixture } from "./acp-fixtures.js";
const scope = { workspaceId: "w", environmentId: "e", sessionId: "s", workId: "work" };
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
const message = (id: string) => ({ id, type: "user.message", processed_at: null, content: [{ type: "text", text: id }] });

async function setup(hooks: boolean, outcome: "injected" | "startedNewTurn" | "promptRequired" | "failed" | "throw" = "injected", receiptFails = false, permission = false, interrupt = false) {
  const first = deferred(), accepted = deferred(), permissionGate = deferred(), finishFeed = deferred();
  const log: string[] = [];
  let page = 0;
  const channel = createManagedHarnessHttpControlChannel({
    scope, harness: { id: "acp", version: "1" }, workspacePath: "/workspace", apiBaseUrl: "https://test", sessionsToken: "token",
    scheduler: { sleep: async () => {} },
    fetch: async (_url, init) => new Response(JSON.stringify(init?.method === "POST" ? {} : { id: "s", environment_id: "e" })),
    eventReader: { async read({ signal }) {
      if (++page === 1) return { events: [message("first")], cursor: "r1", hasMore: false };
      if (page === 2) { await vi.waitFor(() => expect(log).toContain("prompt:first")); return { events: [message("steer")], cursor: "r2", hasMore: false }; }
      if (page === 3 && interrupt) {
        await vi.waitFor(() => expect(log).toContain("steer:promptRequired"));
        return { events: [{ id: "interrupt", type: "user.interrupt", processed_at: null }], cursor: "interrupt", hasMore: false };
      }
      await Promise.race([finishFeed.promise, new Promise<void>(r => signal.addEventListener("abort", () => r(), { once: true }))]);
      return { events: [{ id: "end", type: "session.status_terminated", processed_at: "done" }], cursor: "r3", hasMore: false };
    } },
    ...(hooks ? {
      onBeforeDispatch: async ({ input }: { input: { eventId: string } }) => { log.push("gate:" + input.eventId); },
      onConsumed: async ({ input, acceptance }: { input: { eventId: string }; acceptance: string }) => {
        log.push("receipt:" + input.eventId + ":" + acceptance);
        if (input.eventId === "steer" && receiptFails) throw new Error("receipt offline");
      },
    } : {}),
  });
  const session = acpSessionFixture({ acpSessionId: "native", supportsSteering: true,
    openPermissionRequests: () => permission ? 1 : 0, whenPermissionsSettled: () => permissionGate.promise,
    async *prompt(text, options) {
      log.push("prompt:" + text); await options?.onDispatched?.();
      if (text === "first") await first.promise;
      log.push("end:" + text);
      yield { type: "promptComplete", response: {} };
    },
    async steer() { log.push("steer:sent"); await accepted.promise; if (outcome === "throw") throw new Error("unknown transport"); log.push("steer:" + outcome); return outcome; },
  });
  const harness = createManagedAcpSupervisorHarness({ connect: async () => channel, acpRuntime: { start: async () => session },
    sessionPreparation: { prepare: async () => ({ agent: { command: "acp" } }) },
    sessionState: { beforeStart: async command => ({ command }), onReady: async () => {}, checkpoint: async () => {}, release: async () => {} },
    drainDeadlineMs: 0, abortGraceMs: 0,
  });
  const run = await harness.start({ scope, harness: { id: "acp", version: "1" }, workspacePath: "/workspace", outputPath: null, checkpoint: async () => {}, signal: new AbortController().signal });
  const settled = run.completed.then(value => ({ value }), error => ({ error }));
  const close = async () => { first.resolve(); accepted.resolve(); permissionGate.resolve(); finishFeed.resolve(); await run.stop("aborted"); await settled; };
  return { log, first, accepted, permissionGate, finishFeed, run, settled, close };
}

describe("nullable native feed through channel/supervisor/runtime", () => {
  it.each([[false, "injected"], [true, "injected"], [false, "startedNewTurn"], [true, "startedNewTurn"]] as const)("injects into the unfinished turn with hooks=%s outcome=%s", async (hooks, outcome) => {
    const f = await setup(hooks, outcome);
    try {
      await vi.waitFor(() => expect(f.log).toContain("steer:sent"));
      expect(f.log).not.toContain("end:first");
      expect(f.log).not.toContain("receipt:steer:" + outcome);
      f.accepted.resolve();
      await vi.waitFor(() => expect(f.log).toContain("steer:" + outcome));
      if (hooks) {
        await vi.waitFor(() => expect(f.log).toContain("receipt:steer:" + outcome));
        expect(f.log.filter(x => x.startsWith("receipt:steer:"))).toHaveLength(1);
      }
      expect(f.log).not.toContain("end:first");
      expect(f.log).not.toContain("prompt:steer");
      f.first.resolve(); f.finishFeed.resolve();
      expect(await f.settled).toEqual({ value: { exitCode: 0 } });
    } finally { await f.close(); }
  });
  it.each(["failed", "throw"] as const)("propagates native %s without fallback or reinjection", async outcome => {
    const f = await setup(true, outcome);
    try {
      await vi.waitFor(() => expect(f.log).toContain("steer:sent")); f.accepted.resolve();
      const result = await f.settled;
      expect(result).toMatchObject({ error: { outcome: "unknown", inputId: "steer" } });
      expect(f.log).not.toContain("prompt:steer");
      expect(f.log.filter(x => x === "steer:sent")).toHaveLength(1);
    } finally { await f.close(); }
  });
  it("propagates accepted receipt failure without fallback", async () => {
    const f = await setup(true, "injected", true);
    try {
      await vi.waitFor(() => expect(f.log).toContain("steer:sent")); f.accepted.resolve();
      expect(await f.settled).toMatchObject({ error: { outcome: "unknown", phase: "receipt" } });
      expect(f.log).not.toContain("prompt:steer");
      expect(f.log.filter(x => x === "steer:sent")).toHaveLength(1);
    } finally { await f.close(); }
  });
  it.each([false, true])("waits for permission before fallback receipt hooks=%s", async hooks => {
    const f = await setup(hooks, "promptRequired", false, true);
    try {
      await vi.waitFor(() => expect(f.log).toContain("steer:sent")); f.accepted.resolve();
      await vi.waitFor(() => expect(f.log).toContain("steer:promptRequired"));
      expect(f.log).not.toContain("prompt:steer");
      expect(f.log.some(x => x.startsWith("receipt:steer"))).toBe(false);
      f.permissionGate.resolve();
      await vi.waitFor(() => expect(f.log).toContain("prompt:steer"));
      if (hooks) expect(f.log.filter(x => x === "receipt:steer:prompt-dispatched")).toHaveLength(1);
      expect(f.log).not.toContain("end:first");
      f.first.resolve(); f.finishFeed.resolve(); expect(await f.settled).toEqual({ value: { exitCode: 0 } });
    } finally { await f.close(); }
  });
  it("canonical interrupt cancels permission-waiting fallback without consuming it", async () => {
    const f = await setup(true, "promptRequired", false, true, true);
    try {
      await vi.waitFor(() => expect(f.log).toContain("steer:sent")); f.accepted.resolve();
      await vi.waitFor(() => expect(f.log).toContain("steer:promptRequired"));
      await new Promise(resolve => setTimeout(resolve, 20));
      f.permissionGate.resolve(); f.first.resolve(); f.finishFeed.resolve();
      await f.settled;
      expect(f.log).not.toContain("prompt:steer");
      expect(f.log.some(x => x.startsWith("receipt:steer"))).toBe(false);
    } finally { await f.close(); }
  });

  it("stop while permission is pending does not dispatch or consume fallback", async () => {
    const f = await setup(true, "promptRequired", false, true);
    try {
      await vi.waitFor(() => expect(f.log).toContain("steer:sent")); f.accepted.resolve();
      await vi.waitFor(() => expect(f.log).toContain("steer:promptRequired"));
      await f.run.stop("aborted"); f.permissionGate.resolve(); f.first.resolve();
      await f.settled;
      expect(f.log).not.toContain("prompt:steer");
      expect(f.log.some(x => x.startsWith("receipt:steer"))).toBe(false);
    } finally { await f.close(); }
  });
});
