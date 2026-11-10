import { expect, it } from "vitest";
import { ManagedAgentsSessionHost } from "../src/local-runtime/session-host.js";
import type { ManagedAgentsSessionCheckpoint } from "../src/local-runtime/checkpoint.js";
import { planManagedControlAnswer } from "../src/managed-runtime/control-input-plan.js";
import { acpSessionFixture } from "./acp-fixtures.js";

it("revokes the local session when completion loses its generation CAS", async () => {
  let saved: ManagedAgentsSessionCheckpoint | null = null;
  let disposals = 0;
  let completionAttempted = false;
  const events: Array<{ type: string }> = [];
  const host = new ManagedAgentsSessionHost({
    hostInstanceId: "owner",
    runtime: { async start() { return acpSessionFixture({
      acpSessionId: "native", async *prompt() { yield { type: "promptComplete", response: {} }; },
      async dispose() { disposals++; },
    }); } },
    emit: event => events.push(event),
    checkpointStore: {
      async load() { return saved; },
      async compareAndSet({ checkpoint }) {
        if (checkpoint.lastCompletedTurnId) { completionAttempted = true; return false; }
        saved = checkpoint; return true;
      },
      async delete() {},
    },
  });
  try {
    await host.start({ sessionId: "s", options: { agent: { command: "fixture" } } });
    await host.prompt({ sessionId: "s", turnId: "t", text: "hello" });
    expect(completionAttempted).toBe(true);
    expect(disposals).toBe(1);
    expect(host.has("s")).toBe(false);
    expect(events.filter(event => event.type === "session.complete")).toEqual([]);
    expect(events).toContainEqual(expect.objectContaining({ type: "session.error", message: "runtime lost the session generation lease" }));
  } finally { await host.dispose("s"); }
});

it.each(["session.status_running", "session.status_terminated"])("%s clears the preceding partial-answer wait boundary", type => {
  const history = [
    { id: "pause", type: "session.status_idle", stop_reason: { type: "requires_action", event_ids: ["a", "b"] } },
    { id: "transition", type },
  ];
  expect(planManagedControlAnswer(history, { id: "answer", type: "user.custom_tool_result", custom_tool_use_id: "a", content: [] })).toBe("release");
});

it("does not steer when a session stops being alive between lookup and dispatch", async () => {
  let probes = 0, prompts = 0, steers = 0;
  const host = new ManagedAgentsSessionHost({
    runtime: { async start() { return acpSessionFixture({
      acpSessionId: "native", isAlive: () => ++probes === 1,
      async *prompt() { prompts++; }, async steer() { steers++; return "injected"; },
    }); } }, emit() {},
  });
  await host.start({ sessionId: "s", options: { agent: { command: "fixture" } } });
  try {
    probes = 0;
    await expect(host.steer({ sessionId: "s", eventId: "input", text: "late" }, {
      async beforeDispatch() {}, async onConsumed() { throw Error("unexpected receipt"); },
    })).rejects.toThrow("Session changed before input dispatch");
    expect(prompts).toBe(0); expect(steers).toBe(0);
  } finally { await host.dispose("s"); }
});

it("legacy completion observers wait for permissions before an idle fallback prompt", async () => {
  let release!: () => void;
  const permissions = new Promise<void>(resolve => { release = resolve; });
  let waiting!: () => void;
  const entered = new Promise<void>(resolve => { waiting = resolve; });
  const prompts: string[] = [];
  const host = new ManagedAgentsSessionHost({
    runtime: { async start() { return acpSessionFixture({
      acpSessionId: "native", openPermissionRequests: () => 1,
      whenPermissionsSettled: () => { waiting(); return permissions; },
      async *prompt(text) { prompts.push(String(text)); },
    }); } }, emit() {},
  });
  await host.start({ sessionId: "s", options: { agent: { command: "fixture" } } });
  const run = host.steer({ sessionId: "s", eventId: "fallback", text: "next" }, undefined, {
    async runPromptFallback(_input, dispatch) { await dispatch(); },
  });
  try {
    await entered; expect(prompts).toEqual([]);
    release(); await run; expect(prompts).toEqual(["next"]);
  } finally { release(); await run; await host.dispose("s"); }
});
