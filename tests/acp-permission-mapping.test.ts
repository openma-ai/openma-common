import { AgentSideConnection, PROTOCOL_VERSION, ndJsonStream, type Agent, type SessionConfigOption } from "@agentclientprotocol/sdk";
import { afterEach, describe, expect, it } from "vitest";
import * as runtime from "../src/acp-runtime/index.js";

// These tests exercise the public helper through the real session + SDK wire.
// Literal mode values are taken from the pinned upstream sources in the contract.
const sessions: runtime.AcpSessionImpl[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map(s => s.dispose())); });
function config(values: string[], currentValue = values[0]!): Extract<SessionConfigOption, { type: "select" }> {
  return { id: "mode", name: "Mode", category: "mode", type: "select", currentValue,
    options: values.map(value => ({ value, name: value })) };
}
async function fixture(opts: {
  harness?: "claude" | "codex"; version?: string; name?: string;
  values?: string[]; configs?: SessionConfigOption[];
  respond?: (value: string) => Promise<SessionConfigOption[]>;
} = {}) {
  const codex = "harness" in opts && opts.harness === "codex";
  const values = opts.values ?? (codex ? ["read-only", "agent", "agent-full-access"] : ["default", "auto", "bypassPermissions"]);
  const calls: Array<{ configId: string; value: string | boolean }> = [];
  let legacyCalls = 0;
  const outgoing = new TransformStream<Uint8Array, Uint8Array>();
  const incoming = new TransformStream<Uint8Array, Uint8Array>();
  new AgentSideConnection((): Agent => ({
    async initialize() { return { protocolVersion: PROTOCOL_VERSION, agentInfo: {
      name: opts.name ?? `@agentclientprotocol/${codex ? "codex-acp" : "claude-agent-acp"}`,
      version: opts.version ?? (codex ? "1.8.0" : "0.75.1"),
    } }; },
    async newSession() { return { sessionId: "permission-test", configOptions: opts.configs ?? [config(values)],
      modes: { currentModeId: values[0]!, availableModes: values.map(id => ({ id, name: id })) } }; },
    async setSessionConfigOption(p) {
      calls.push({ configId: p.configId, value: p.value });
      return { configOptions: await (opts.respond?.(String(p.value)) ?? Promise.resolve([config(values, String(p.value))])) };
    },
    async setSessionMode() { legacyCalls++; return {}; },
    async authenticate() { return {}; }, async cancel() {}, async prompt() { return { stopReason: "end_turn" }; },
  }), ndJsonStream(incoming.writable, outgoing.readable));
  const session = new runtime.AcpSessionImpl({ id: "permission-test", options: { agent: { command: "fixture" } }, child: {
    stdin: outgoing.writable, stdout: incoming.readable,
    stderr: new ReadableStream({ start(c) { c.close(); } }), exited: new Promise(() => {}), async kill() {},
  } });
  sessions.push(session); await session.init();
  return { session, calls, legacyCalls: () => legacyCalls };
}
function apply(session: runtime.AcpSession, mode: "always_ask" | "auto" | "always_allow" | undefined, extra = {}) {
  // Namespace lookup yields an assertion failure (not an import error) in RED.
  expect(runtime.applyAcpPermissionMode, "public permission mapping helper").toBeTypeOf("function");
  return runtime.applyAcpPermissionMode(session, { harnessId: "claude-acp", mode, ...extra });
}

describe("opt-in verified native permission mapping", () => {
  it.each([
    ["claude", "0.75.1", "always_ask", "default"],
    ["claude", "0.75.1", "auto", "auto"],
    ["claude", "0.75.1", "always_allow", "bypassPermissions"],
    ["claude", "0.94.0", "always_ask", "default"],
    ["claude", "0.94.0", "auto", "auto"],
    ["claude", "0.94.0", "always_allow", "bypassPermissions"],
    ["codex", "1.8.0", "always_ask", "read-only"],
    ["codex", "1.8.0", "auto", "agent"],
    ["codex", "1.8.0", "always_allow", "agent-full-access"],
    ["codex", "1.10.0", "always_ask", "read-only"],
    ["codex", "1.10.0", "auto", "agent"],
    ["codex", "1.10.0", "always_allow", "agent-full-access"],
  ] as const)("%s %s %s applies and verifies %s", async (harness, version, mode, nativeModeId) => {
    const f = await fixture({ harness, version });
    const result = await apply(f.session, mode, { harnessId: `${harness}-acp` });
    expect(result).toMatchObject({ status: "applied", mode, nativeModeId, version, verification: "session/set_config_option" });
    expect(f.calls).toEqual([{ configId: "mode", value: nativeModeId }]);
    expect(f.legacyCalls()).toBe(0);
    expect(f.session.configOptions[0]?.currentValue).toBe(nativeModeId);
  });
  it("omitted configuration is a no-op even for an unknown harness", async () => {
    const f = await fixture({ name: "unknown", configs: [] });
    expect(await apply(f.session, undefined, { harnessId: "unknown" })).toEqual({ status: "not-configured" });
    expect(f.calls).toEqual([]);
    // Existing consumers still have their legacy optimistic setter; helper never uses it.
    await f.session.setMode("auto");
    expect(f.session.modes?.currentModeId).toBe("auto");
    expect(f.legacyCalls()).toBe(1);
  });
  it.each([
    [{}, { harnessId: "unknown" }],
    [{ name: "pretend-claude" }, {}],
    [{ version: "0.75.2" }, {}],
    [{ version: "0.94.1" }, {}],
    [{ version: "0.94.0-unverified" }, {}],
    [{ version: "" }, {}],
    [{ values: ["default", "acceptEdits"] }, {}],
    [{ configs: [] }, {}],
    [{ configs: [config(["default", "auto"]), config(["auto"])] }, {}],
    [{ harness: "codex", values: ["read-only", "agent", "full-access"] }, { harnessId: "codex-acp" }],
  ] as const)("rejects unproven identity/catalog before dispatch %#", async (opts, extra) => {
    const f = await fixture(opts as Parameters<typeof fixture>[0]);
    await expect(apply(f.session, "harness" in opts && opts.harness === "codex" ? "always_allow" : "auto", extra)).rejects.toMatchObject({ code: "unsupported", outcome: "not-dispatched" });
    expect(f.calls).toEqual([]);
    expect(f.legacyCalls()).toBe(0);
  });
  it("does not trust a legacy optimistic setMode assignment", async () => {
    const f = await fixture({ configs: [] });
    await f.session.setMode("auto");
    await expect(apply(f.session, "auto")).rejects.toMatchObject({ code: "unsupported" });
    expect(f.calls).toEqual([]);
  });
  it.each(["0.75.1", "0.94.0"])("rejects Claude %s auto to acceptEdits fallback", async version => {
    const f = await fixture({ version, respond: async () => [config(["auto", "acceptEdits"], "acceptEdits")] });
    await expect(apply(f.session, "auto")).rejects.toMatchObject({ code: "mode-mismatch", outcome: "unknown", effectiveModeId: "acceptEdits" });
    expect(f.calls).toHaveLength(1);
  });
  it.each(["0.75.1", "0.94.0"])("%s refuses empty readback or initial matching value", async version => {
    const f = await fixture({ version, values: ["auto"], respond: async () => [] });
    await expect(apply(f.session, "auto")).rejects.toMatchObject({ code: "unsupported", outcome: "unknown" });
    expect(f.calls).toHaveLength(1);
  });
  it.each(["0.75.1", "0.94.0"])("%s propagates native rejection without fallback", async version => {
    const f = await fixture({ version, respond: async () => { throw new Error("native permission denied"); } });
    await expect(apply(f.session, "auto")).rejects.toMatchObject({ code: "apply-failed", outcome: "unknown" });
    expect(f.calls).toHaveLength(1); expect(f.legacyCalls()).toBe(0);
  });
  it.each(["0.75.1", "0.94.0"])("%s pre-aborted mapping never dispatches", async version => {
    const f = await fixture({ version });
    await expect(apply(f.session, "auto", { abortSignal: AbortSignal.abort() })).rejects.toMatchObject({ code: "aborted", outcome: "not-dispatched" });
    expect(f.calls).toEqual([]);
  });
  it.each([["0.75.1", "abort"], ["0.75.1", "timeout"], ["0.94.0", "abort"], ["0.94.0", "timeout"]] as const)("%s %s cannot turn late ack into success; concurrent calls fail closed", async (version, kind) => {
    let release!: (value: SessionConfigOption[]) => void;
    let entered!: () => void;
    const ready = new Promise<void>(r => { entered = r; });
    const pending = new Promise<SessionConfigOption[]>(r => { release = r; });
    const f = await fixture({ version, respond: () => { entered(); return pending; } });
    const controller = new AbortController();
    const run = apply(f.session, "auto", { abortSignal: controller.signal, timeoutMs: kind === "timeout" ? 30 : 1000 });
    const assertion = expect(run).rejects.toMatchObject({ code: kind === "abort" ? "aborted" : "timeout", outcome: "unknown" });
    await ready;
    await expect(apply(f.session, "always_allow")).rejects.toMatchObject({ code: "busy", outcome: "not-dispatched" });
    if (kind === "abort") controller.abort();
    await assertion;
    await expect(apply(f.session, "always_allow")).rejects.toMatchObject({ code: "busy" });
    release([config(["auto"], "auto")]);
    expect(f.calls).toEqual([{ configId: "mode", value: "auto" }]);
  });
  it.each([
    [config(["auto"], "default")],
    [config(["auto"], "bypassPermissions")],
  ])("rejects both stricter and more permissive native substitutions %#", async option => {
    const f = await fixture({ respond: async () => [option] });
    await expect(apply(f.session, "auto")).rejects.toMatchObject({ code: "mode-mismatch", outcome: "unknown" });
  });
  it("handles grouped choices without falling back to labels", async () => {
    const grouped: SessionConfigOption = { ...config(["auto"]), type: "select",
      options: [{ group: "native", name: "Native modes", options: [{ value: "auto", name: "Not a policy identifier" }] }] };
    const f = await fixture({ configs: [grouped], respond: async () => [grouped] });
    expect(await apply(f.session, "auto")).toMatchObject({ status: "applied", nativeModeId: "auto" });
    expect(f.calls).toEqual([{ configId: "mode", value: "auto" }]);
  });
  it.each([0, -1, Infinity, NaN, 2147483648])("invalid deadline %s never dispatches", async timeoutMs => {
    const f = await fixture();
    await expect(apply(f.session, "auto", { timeoutMs })).rejects.toMatchObject({ code: "unsupported", outcome: "not-dispatched" });
    expect(f.calls).toEqual([]);
  });
  it("invalid runtime mode cannot use an object prototype key", async () => {
    const f = await fixture();
    await expect(apply(f.session, "auto", { mode: "toString" })).rejects.toMatchObject({ code: "unsupported" });
    expect(f.calls).toEqual([]);
  });
  it("aborted native rejection is observed without fallback or unhandled rejection", async () => {
    let reject!: (e: Error) => void;
    let entered!: () => void;
    const ready = new Promise<void>(r => { entered = r; });
    const response = new Promise<SessionConfigOption[]>((_, r) => { reject = r; });
    const f = await fixture({ respond: () => { entered(); return response; } });
    const controller = new AbortController();
    const result = apply(f.session, "auto", { abortSignal: controller.signal });
    const assertion = expect(result).rejects.toMatchObject({ code: "aborted", outcome: "unknown" });
    await ready; controller.abort(); await assertion;
    reject(new Error("late rejection"));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(f.calls).toHaveLength(1); expect(f.legacyCalls()).toBe(0);
  });

  it.each([{ configs: [] }, { configs: [config(["default", "acceptEdits"])] }, { configs: [config(["default", "auto"])] }])(
    "0.94.0 never substitutes for missing native bypass %#", async ({ configs }) => {
      const f = await fixture({ version: "0.94.0", configs });
      await expect(apply(f.session, "always_allow")).rejects.toMatchObject({ code: "unsupported", outcome: "not-dispatched" });
      expect(f.calls).toEqual([]);
    },
  );

  it.each([
    { ...config(["auto"]), currentValue: 42 },
    { ...config(["auto"]), options: null },
    { ...config(["auto"]), type: "boolean", currentValue: true },
    { ...config(["auto"]), category: "model" },
  ])("invalid custom session mode catalog fails before native dispatch %#", async option => {
    const f = await fixture({ version: "0.94.0" });
    // AcpSession is a public structural port. A custom implementation need not
    // pass through the SDK schema validator; the helper still fails closed.
    Object.defineProperty(f.session, "configOptions", { value: [option] });
    await expect(apply(f.session, "auto")).rejects.toMatchObject({ code: "unsupported", outcome: "not-dispatched" });
    expect(f.calls).toEqual([]);
  });
  it("normalizes a synchronous custom setter throw and releases its pending guard", async () => {
    const f = await fixture({ version: "0.94.0" });
    const original = f.session.setConfigOption.bind(f.session);
    const failure = new Error("synchronous transport setup failure");
    f.session.setConfigOption = () => { throw failure; };
    await expect(apply(f.session, "auto")).rejects.toMatchObject({ code: "apply-failed", outcome: "unknown", cause: failure });
    f.session.setConfigOption = original;
    expect(await apply(f.session, "auto")).toMatchObject({ status: "applied" });
    expect(f.calls).toEqual([{ configId: "mode", value: "auto" }]);
  });
  it("abort after response wins the race but before continuation never reports success", async () => {
    const f = await fixture({ version: "0.94.0", configs: [config(["auto"], "auto")] });
    const controller = new AbortController();
    let writes = 0;
    f.session.setConfigOption = () => {
      writes++;
      // Native Promise scheduling: settle RPC, then abort before the helper's
      // awaited race continuation; no fake signal or timers.
      queueMicrotask(() => queueMicrotask(() => controller.abort()));
      return Promise.resolve([config(["auto"], "auto")]);
    };
    await expect(apply(f.session, "auto", { abortSignal: controller.signal })).rejects.toMatchObject({ code: "aborted", outcome: "unknown" });
    expect(writes).toBe(1);
  });

});
