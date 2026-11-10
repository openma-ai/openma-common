import { describe, expect, it, vi } from "vitest";
import { ManagedAgentsSessionHost } from "../src/local-runtime/session-host.js";
import type { ManagedAgentsInputDispatchHooks } from "../src/local-runtime/session-host.js";
import { acpSessionFixture } from "./acp-fixtures.js";

function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
async function fixture(outcome: "injected" | "startedNewTurn" | "promptRequired" | "failed" | "throw", permission = false) {
  const active = deferred(), permissions = deferred();
  const log: string[] = [];
  const session = acpSessionFixture({ acpSessionId: "a", supportsSteering: true,
    openPermissionRequests: () => permission ? 1 : 0, whenPermissionsSettled: () => permissions.promise,
    async steer() { log.push("steer"); if (outcome === "throw") throw new Error("transport lost"); return outcome; },
    async *prompt(text, options) { log.push("prompt:" + text); await options?.onDispatched?.(); if (text === "active") await active.promise; yield { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "ok" } }; },
  });
  const host = new ManagedAgentsSessionHost({ runtime: { start: async () => session }, emit: () => {} });
  await host.start({ sessionId: "s", options: { agent: { command: "test" } } });
  const running = host.prompt({ sessionId: "s", turnId: "active", text: "active" });
  await vi.waitFor(() => expect(log).toContain("prompt:active"));
  const hooks: ManagedAgentsInputDispatchHooks = {
    beforeDispatch: async () => { log.push("gate"); },
    onConsumed: async result => { log.push("receipt:" + result); },
  };
  const steer = () => host.steer({ sessionId: "s", eventId: "input", text: "next" }, hooks);
  const close = async () => { active.resolve(); permissions.resolve(); await running; await host.dispose("s"); };
  return { host, log, hooks, steer, close, permissions };
}

describe("actual input dispatch boundary", () => {
  it.each(["injected", "startedNewTurn"] as const)("keeps %s native steer live and consumes only after acceptance", async outcome => {
    const f = await fixture(outcome);
    try {
      await f.steer();
      expect(f.log).toEqual(["prompt:active", "gate", "steer", "receipt:" + outcome]);
      await f.steer();
      expect(f.log.filter(x => x === "steer")).toHaveLength(1);
    } finally { await f.close(); }
  });
  it("waits for permission before fallback gate/receipt, without cancelling the active turn", async () => {
    const f = await fixture("promptRequired", true);
    try {
      const pending = f.steer();
      await vi.waitFor(() => expect(f.log).toContain("steer"));
      expect(f.log).toEqual(["prompt:active", "gate", "steer"]);
      f.permissions.resolve(); await pending;
      expect(f.log).toEqual(["prompt:active", "gate", "steer", "gate", "prompt:next", "receipt:prompt-dispatched"]);
    } finally { await f.close(); }
  });
  it.each(["failed", "throw"] as const)("surfaces %s as unknown and refuses reinjection", async outcome => {
    const f = await fixture(outcome);
    try {
      await expect(f.steer()).rejects.toMatchObject({ name: "ManagedAgentsInputDispatchError", outcome: "unknown", inputId: "input" });
      await expect(f.steer()).rejects.toMatchObject({ outcome: "unknown" });
      expect(f.log).toEqual(["prompt:active", "gate", "steer"]);
    } finally { await f.close(); }
  });
  it("receipt failure after injected is unknown, never fallback or repeat", async () => {
    const f = await fixture("injected");
    f.hooks.onConsumed = async () => { throw new Error("receipt unavailable"); };
    try {
      await expect(f.steer()).rejects.toMatchObject({ outcome: "unknown", phase: "receipt" });
      await expect(f.steer()).rejects.toMatchObject({ outcome: "unknown" });
      expect(f.log).toEqual(["prompt:active", "gate", "steer"]);
    } finally { await f.close(); }
  });
  it("records confirmed acceptance even if cancellation races the response", async () => {
    const f = await fixture("injected"), abort = new AbortController();
    f.hooks.signal = abort.signal;
    f.hooks.beforeDispatch = async () => { f.log.push("gate"); };
    f.hooks.onConsumed = async acceptance => { abort.abort(); f.log.push("receipt:" + acceptance); };
    try {
      await f.steer(); await f.steer();
      expect(f.log).toEqual(["prompt:active", "gate", "steer", "receipt:injected"]);
    } finally { await f.close(); }
  });

  it("coalesces simultaneous delivery of one steering identity", async () => {
    const f = await fixture("injected"), gate = deferred();
    f.hooks.beforeDispatch = async () => { f.log.push("gate"); await gate.promise; };
    try {
      const a = f.steer(), b = f.steer(); gate.resolve(); await Promise.all([a, b]);
      expect(f.log.filter(x => x === "steer")).toHaveLength(1);
      expect(f.log.filter(x => x === "receipt:injected")).toHaveLength(1);
    } finally { gate.resolve(); await f.close(); }
  });

  it("gate failure does not send and permits a stable-identity retry", async () => {
    const f = await fixture("injected");
    const gate = f.hooks.beforeDispatch;
    f.hooks.beforeDispatch = async () => { throw new Error("fenced"); };
    try {
      await expect(f.steer()).rejects.toThrow("fenced");
      expect(f.log).toEqual(["prompt:active"]);
      f.hooks.beforeDispatch = gate; await f.steer();
      expect(f.log.filter(x => x === "steer")).toHaveLength(1);
    } finally { await f.close(); }
  });
  it("cancel during gate prevents send and receipt", async () => {
    const f = await fixture("injected"), gate = deferred(), abort = new AbortController();
    f.hooks.signal = abort.signal;
    f.hooks.beforeDispatch = () => gate.promise;
    try {
      const pending = f.steer(); abort.abort(); gate.resolve();
      await expect(pending).rejects.toThrow();
      expect(f.log).toEqual(["prompt:active"]);
    } finally { await f.close(); }
  });
  it("cancel while fallback waits for permission prevents its gate/consumption", async () => {
    const f = await fixture("promptRequired", true), abort = new AbortController();
    f.hooks.signal = abort.signal;
    try {
      const pending = f.steer();
      await vi.waitFor(() => expect(f.log).toContain("steer"));
      abort.abort();
      await expect(pending).rejects.toThrow();
      expect(f.log).toEqual(["prompt:active", "gate", "steer"]);
    } finally { await f.close(); }
  });
  it("a prompt transport throw is unknown even without a dispatch acknowledgement", async () => {
    let sends = 0;
    const session = acpSessionFixture({ acpSessionId: "a", async *prompt() { sends++; throw new Error("socket closed"); } });
    const host = new ManagedAgentsSessionHost({ runtime: { start: async () => session }, emit: () => {} });
    await host.start({ sessionId: "s", options: { agent: { command: "test" } } });
    const hooks = { beforeDispatch: async () => {}, onConsumed: async () => {} };
    const input = { sessionId: "s", turnId: "id", text: "text" };
    await expect(host.prompt(input, hooks)).rejects.toMatchObject({ outcome: "unknown", phase: "dispatch" });
    await expect(host.prompt(input, hooks)).rejects.toMatchObject({ outcome: "unknown" });
    expect(sends).toBe(1);
    await host.dispose("s");
  });

  it("prompt receipt is awaited after actual dispatch and failure prevents replay", async () => {
    const f = await fixture("injected"), receipt = deferred();
    f.hooks.onConsumed = async () => { f.log.push("receipt:start"); await receipt.promise; throw new Error("offline"); };
    const input = { sessionId: "s", turnId: "ordinary", text: "ordinary" };
    try {
      const pending = f.host.prompt(input, f.hooks);
      const settled = pending.then(() => undefined, error => error);
      await vi.waitFor(() => expect(f.log).toContain("receipt:start"));
      expect(f.log.indexOf("prompt:ordinary")).toBeLessThan(f.log.indexOf("receipt:start"));
      receipt.resolve(); expect(await settled).toMatchObject({ outcome: "unknown", phase: "receipt" });
      await expect(f.host.prompt(input, f.hooks)).rejects.toMatchObject({ outcome: "unknown" });
      expect(f.log.filter(x => x === "prompt:ordinary")).toHaveLength(1);
    } finally { receipt.resolve(); await f.close(); }
  });
});
