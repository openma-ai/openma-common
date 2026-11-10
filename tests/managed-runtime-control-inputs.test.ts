import { describe, expect, it } from "vitest";
import { createManagedHarnessHttpControlChannel, type ManagedHarnessHttpControlOptions, type ManagedHarnessWireEvent } from "../src/managed-runtime/http-control.js";
import type { ManagedHarnessControlMessage } from "../src/managed-runtime/index.js";

const stamp = "2026-11-10T00:00:00.000Z";
const scope = { workspaceId: "ws", environmentId: "env", sessionId: "session", workId: "work" };
const wire = (id: string, type: string, fields: Record<string, unknown> = {}): ManagedHarnessWireEvent => ({ id, type, processed_at: stamp, ...fields });
const message = (id: string, fields = {}) => wire(id, "user.message", { content: [{ type: "text", text: id }], ...fields });
const source = (execution?: string, consumed?: string) => ({ revision: 2, index: 0, ...(execution ? { execution_id: execution } : {}), ...(consumed ? { consumed_by_execution_id: consumed } : {}), generation: 987 });
const idle = (type: string, ids?: string[]) => wire("idle-" + type, "session.status_idle", { stop_reason: { type, ...(ids ? { event_ids: ids } : {}) } });
const answer = (id: string, tool: string) => wire(id, "user.custom_tool_result", { custom_tool_use_id: tool, content: [{ type: "text", text: id }], source_position: source() });
const end = wire("end", "session.status_terminated");
function gate() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { resolve, promise }; }
async function collect(pages: ManagedHarnessWireEvent[][], extra: Partial<ManagedHarnessHttpControlOptions> = {}) {
  let page = 0;
  const channel = createManagedHarnessHttpControlChannel({ scope, harness: { id: "acp", version: "1" }, workspacePath: "/workspace", apiBaseUrl: "https://test.invalid", sessionsToken: "token", fetch: async () => Response.json({ id: "session", environment_id: "env" }), scheduler: { sleep: async () => {} }, eventReader: { async read() { return { events: pages[page++] ?? [end], cursor: String(page), hasMore: false }; } }, ...extra });
  const commands: ManagedHarnessControlMessage[] = [];
  try { for await (const c of channel.commands(new AbortController().signal)) commands.push(c); }
  finally { await channel.close(); }
  return commands;
}
const prompts = (commands: ManagedHarnessControlMessage[]) => commands.filter(c => c.type === "session.prompt");

describe("canonical control inputs (main d45d7dc1 F3/F4)", () => {
  it("continues a stamped but unconsumed resume with no invented user event", async () => {
    const resume = wire("resume", "session.updated", { resume: true, source_position: source("stable-execution") });
    const commands = await collect([[message("old", { source_position: source("old-turn", "old-turn") }), idle("budget_reached")], [resume]]);
    expect(commands[0]).not.toHaveProperty("canonicalCompletedTurnId");
    expect(prompts(commands)).toEqual([{ type: "session.prompt", sessionId: "session", turnId: "stable-execution", text: "", input: { eventId: "resume", event: resume } }]);
  });
  it("does not continue non-boolean resume or an already consumed continuation", async () => {
    expect(prompts(await collect([[idle("budget_reached")], [wire("no", "session.updated", { resume: "true" }), wire("done", "session.updated", { resume: true, source_position: source("stable", "stable") })]]))).toEqual([]);
  });
  it.each(["user.define_outcome", "user.tool_result", "session.updated"])("preserves acceptance-stamped unconsumed %s before an idle", async type => {
    const event = wire("pending", type, { source_position: source("execution"), resume: true, description: "ship", rubric: { type: "text", content: "pass" }, tool_use_id: "call", content: [{ type: "text", text: "result" }] });
    const commands = await collect([[message("old", { source_position: source("old-turn", "old-turn") }), event, idle("end_turn")]]);
    expect(commands[0]).toMatchObject({ canonicalCompletedTurnId: "old-turn" });
    expect(prompts(commands)).toMatchObject([{ turnId: "execution", input: { eventId: "pending", event } }]);
  });
  it("normalizes bootstrap outcome defaults without altering its canonical input", async () => {
    const event = wire("bootstrap_session:0", "user.define_outcome", { description: "ship", rubric: { type: "text", content: "pass" }, source_position: source() });
    const commands = await collect([[event]]);
    expect(prompts(commands)[0]).toMatchObject({ input: { event, outcome: { id: "outcome_bootstrap_session:0", maxIterations: null } } });
    expect(event).not.toHaveProperty("outcome_id");
  });
  it("parks a partial answer, then releases all answer context once and ignores a closed late answer", async () => {
    let page = 0;
    const pages = [[message("original", { source_position: source("original-turn", "original-turn") }), idle("requires_action", ["a", "b"])], [answer("answer-a", "a")], [answer("answer-b", "b")], [answer("late-a", "a")], [end]];
    const settled: string[] = [];
    const commands = await collect(pages, {
      // The transport pump must settle answers independently of prompt completion.
      onInputSettled: async ({ input }) => { settled.push(input.eventId); },
      eventReader: { async read() { return { events: pages[page++]!, cursor: String(page), hasMore: false }; } },
    });
    expect(prompts(commands)).toHaveLength(1);
    expect(prompts(commands)[0]).toMatchObject({ turnId: "answer-b", text: "Custom tool result for a:\nanswer-a\n\nCustom tool result for b:\nanswer-b" });
    expect(commands[0]).not.toHaveProperty("canonicalCompletedTurnId");
    expect(settled).toContain("answer-a");
  });
  it("never sends a partial answer to the model", async () => {
    expect(prompts(await collect([[message("original"), idle("requires_action", ["a", "b"])], [answer("answer-a", "a")]]))).toEqual([]);
  });
  it.each(["answered", "rejected"] as const)("intercepts confirmation (%s) verbatim and retains the parked original turn", async result => {
    const confirmation = wire("confirm", "user.tool_confirmation", { tool_use_id: "a", result: "deny", source_position: source() });
    const received: unknown[] = [];
    const commands = await collect([[message("original", { source_position: source("original-turn", "original-turn") }), idle("requires_action", ["a"])], [confirmation], [message("steer", { source_position: source() })]], {
      onToolConfirmation: async input => { received.push(input); return result; },
    });
    expect(prompts(commands)).toEqual([]);
    expect(received).toMatchObject([{ event: confirmation, activeTurnId: "original-turn" }]);
    expect((received[0] as { event: unknown }).event).toBe(confirmation);
    expect(commands).toContainEqual(expect.objectContaining({ type: "session.steer", eventId: "steer" }));
  });
  it("fails closed rather than prompting a confirmation without a hook", async () => {
    expect(prompts(await collect([[], [wire("confirm", "user.tool_confirmation", { tool_use_id: "a", result: "allow" })]]))).toEqual([]);
  });
  it("consumes a steer under its stable execution identity, not its event id", async () => {
    const commands = await collect([[message("first", { source_position: source("first-turn") })], [message("steer", { source_position: source("steer-execution") })]]);
    expect(commands.find(c => c.type === "session.steer")).toMatchObject({ eventId: "steer-execution", input: { eventId: "steer" } });
  });
  it("does not let completed historical input turn an unconsumed pending message into steer", async () => {
    const commands = await collect([[message("done", { source_position: source("done-turn", "done-turn") }), message("pending", { source_position: source() }), idle("end_turn")]]);
    expect(prompts(commands)).toMatchObject([{ turnId: "pending" }]);
  });
  it("keeps canonical system context with its actionable owner instead of starting its own turn", async () => {
    const commands = await collect([[wire("sys", "system.message", { source_position: source(), content: [{ type: "text", text: "context" }] }), message("owner", { source_position: source("owner-turn") })]]);
    expect(prompts(commands)).toMatchObject([{ turnId: "owner-turn", text: "context\n\nowner" }]);
    expect(commands.some(c => c.type === "session.steer")).toBe(false);
  });
  it("keeps the input reader live while the original prompt waits for permission", async () => {
    const ready = gate(), answered = gate(); let page = 0; let activePrompt = false;
    const confirm = wire("confirm", "user.tool_confirmation", { tool_use_id: "a", result: "allow", source_position: source() });
    const received: unknown[] = [];
    const channel = createManagedHarnessHttpControlChannel({ scope, harness: { id: "acp", version: "1" }, workspacePath: "/workspace", apiBaseUrl: "https://test.invalid", sessionsToken: "token", fetch: async () => Response.json({ id: "session", environment_id: "env" }), scheduler: { sleep: async () => {} },
      eventReader: { async read() { page++; if (page === 1) return { events: [message("original", { source_position: source("original-turn") })], cursor: "1", hasMore: false }; await ready.promise; return { events: page === 2 ? [idle("requires_action", ["a"]), confirm] : [end], cursor: String(page), hasMore: false }; } },
      onToolConfirmation: async input => { received.push({ ...input, activePrompt }); answered.resolve(); return "rejected"; },
    });
    try {
      for await (const command of channel.commands(new AbortController().signal)) {
        if (command.type === "session.prompt") { activePrompt = true; ready.resolve(); await answered.promise; activePrompt = false; }
      }
    } finally { await channel.close(); }
    expect(received).toMatchObject([{ event: confirm, activeTurnId: "original-turn", activePrompt: true }]);
  });
  it("does not let a rejected confirmation close a pending tool for later custom answers", async () => {
    const commands = await collect([[message("original"), idle("requires_action", ["a", "b"])], [wire("reject", "user.tool_confirmation", { tool_use_id: "a", result: "allow" })], [answer("answer-b", "b")]], { onToolConfirmation: async () => "rejected" });
    expect(prompts(commands)).toEqual([]);
  });
  it("fails without a model effect when confirmation interception rejects its IO", async () => {
    await expect(collect([[], [wire("confirm", "user.tool_confirmation", { tool_use_id: "a", result: "deny" })]], { onToolConfirmation: async () => { throw new Error("lost receipt"); } })).rejects.toThrow("lost receipt");
  });
  it("never marks a consumed parked answer as a completed recovery boundary", async () => {
    const commands = await collect([[message("original", { source_position: source("original-turn", "original-turn") }), idle("requires_action", ["a", "b"]), { ...answer("answer-a", "a"), source_position: source("answer-turn", "answer-turn") }, idle("requires_action", ["b"])] , [answer("answer-b", "b")]]);
    expect(commands[0]).not.toHaveProperty("canonicalCompletedTurnId");
    expect(prompts(commands)).toMatchObject([{ text: "Custom tool result for a:\nanswer-a\n\nCustom tool result for b:\nanswer-b" }]);
  });
  it("does not leak a consumed partial answer from a completed turn into a later continuation", async () => {
    const commands = await collect([[message("old"), idle("requires_action", ["a", "b"]), { ...answer("old-answer", "a"), source_position: source("answer-turn", "answer-turn") }, idle("end_turn"), message("new"), idle("requires_action", ["c"])] , [answer("new-answer", "c")]]);
    expect(prompts(commands)).toMatchObject([{ text: "Custom tool result for c:\nnew-answer" }]);
  });
  it("does not let consumed bootstrap system context own a completed turn", async () => {
    const commands = await collect([[message("old", { source_position: source("original-execution", "original-execution") }), wire("context", "system.message", { source_position: source("system-execution", "system-execution"), content: [] }), idle("end_turn")]]);
    expect(commands[0]).toMatchObject({ canonicalCompletedTurnId: "original-execution" });
  });
  it("restores the consumed active turn when a parked idle arrives on the next page", async () => {
    const received: Array<string | null> = [];
    await collect([[message("original", { source_position: source("execution", "execution") })], [idle("requires_action", ["a"]), wire("confirm", "user.tool_confirmation", { tool_use_id: "a", result: "deny" })]], { onToolConfirmation: async ({ activeTurnId }) => { received.push(activeTurnId); return "answered"; } });
    expect(received).toEqual(["execution"]);
  });
  it("keeps live steer and interrupt identity stable rather than using claim generation", async () => {
    const commands = await collect([[message("first", { source_position: source("execution") })], [message("steer", { source_position: source() }), wire("interrupt", "user.interrupt"), message("next", { source_position: source() })]]);
    expect(commands.filter(c => c.type !== "session.start" && c.type !== "session.dispose" && c.type !== "control.complete")).toMatchObject([
      { type: "session.prompt", turnId: "execution" }, { type: "session.steer", eventId: "steer" }, { type: "session.cancel", turnId: "execution" }, { type: "session.prompt", turnId: "next" },
    ]);
  });
});

it("preserves actual dispatch kind at the host consume gate for steer and confirmed prompt fallback",async()=>{
 const kinds:unknown[]=[];
 const channel=createManagedHarnessHttpControlChannel({scope,harness:{id:"acp",version:"1"},workspacePath:"/workspace",apiBaseUrl:"https://test.invalid",sessionsToken:"token",onBeforeDispatch:async input=>{kinds.push(input.kind);}});
 const command={type:"session.prompt" as const,sessionId:scope.sessionId,turnId:"second",text:"correct",input:{eventId:"second",event:message("second")}};
 await channel.beforeDispatch!(command,new AbortController().signal,"steer");
 await channel.beforeDispatch!(command,new AbortController().signal,"prompt");
 expect(kinds).toEqual(["steer","prompt"]);
 await channel.close();
});
