import { describe, it, expect } from "vitest";
import { createManagedHarnessHttpControlChannel, createManagedHarnessHttpRecoveryHistory } from "../src/managed-runtime/index.js";
import type { ManagedHarnessEventReader } from "../src/managed-runtime/index.js";
const scope = { workspaceId: "w", environmentId: "e", sessionId: "s", workId: "work" };
const json = (value: unknown) => new Response(JSON.stringify(value));
const first = { id: "input1", type: "user.message", processed_at: null, content: [{ type: "text", text: "first" }] };
const outcome = { id: "input2", type: "user.define_outcome", processed_at: null, outcome_id: "goal", description: "ship", rubric: { type: "text", text: "tests pass" }, max_iterations: 3 };
const terminal = { id: "end", type: "session.status_terminated", processed_at: "done" };
function options() { return { scope, harness: { id: "acp", version: "1" }, workspacePath: "/workspace", apiBaseUrl: "https://test", sessionsToken: "token", scheduler: { sleep: async () => {} }, fetch: async () => json({ id: "s", environment_id: "e" }) }; }

describe("stable native event reader", () => {
  it("continues from an opaque tail cursor across empty polls, independent of nullable processing time", async () => {
    const cursors: Array<string | null> = [];
    let calls = 0;
    const reader: ManagedHarnessEventReader = { async read({ cursor }) {
      cursors.push(cursor); calls++;
      if (calls === 1) return { events: [first], cursor: "rev:2:0", hasMore: false };
      if (calls === 2) return { events: [], cursor: "rev:2:0", hasMore: false };
      if (calls === 3) return { events: [outcome], cursor: "rev:3:0", hasMore: true };
      return { events: [terminal], cursor: "rev:4:0", hasMore: false };
    } };
    const consumed: string[] = [];
    const channel = createManagedHarnessHttpControlChannel({ ...options(), eventReader: reader,
      onBeforeDispatch: async ({ input }) => { consumed.push("gate:" + input.eventId); },
      onConsumed: async ({ input, acceptance }) => { consumed.push(acceptance + ":" + input.eventId); },
    });
    const commands = [];
    for await (const command of channel.commands(new AbortController().signal)) commands.push(command);
    expect(cursors).toEqual([null, "rev:2:0", "rev:2:0", "rev:3:0"]);
    expect(commands.filter(c => c.type === "session.prompt")).toMatchObject([
      { turnId: "input1", input: { eventId: "input1", event: first } },
      { turnId: "input2", input: { eventId: "input2", outcome: { id: "goal", description: "ship", rubric: { type: "text", text: "tests pass" }, maxIterations: 3 } } },
    ]);
    expect(consumed).toEqual([]);
    const command = commands.find(c => c.type === "session.prompt")!;
    await channel.beforeDispatch!(command as never, new AbortController().signal);
    expect(consumed).toEqual(["gate:input1"]);
    await channel.onConsumed!(command as never, "prompt-dispatched");
    expect(consumed).toEqual(["gate:input1", "prompt-dispatched:input1"]);
    await channel.close();
  });
  it("rejects nonadvancing nonempty native pages instead of looping/replaying", async () => {
    const channel = createManagedHarnessHttpControlChannel({ ...options(), eventReader: { read: async () => ({ events: [first], cursor: null, hasMore: true }) } });
    const collect = async () => { for await (const _ of channel.commands(new AbortController().signal)) {} };
    await expect(collect()).rejects.toThrow("advance");
    await channel.close();
  });
  it("fails closed on queued inputs without a stable reader instead of inventing a time cursor", async () => {
    const channel = createManagedHarnessHttpControlChannel({ ...options(), fetch: async url => String(url).includes("/events?") ? json({ data: [first], next_page: null }) : json({ id: "s", environment_id: "e" }) });
    const collect = async () => { for await (const _ of channel.commands(new AbortController().signal)) {} };
    await expect(collect()).rejects.toThrow("eventReader");
    await channel.close();
  });
  it("advances through 1000 polls without rescanning old pages", async () => {
    let reads = 0;
    const channel = createManagedHarnessHttpControlChannel({ ...options(), eventReader: { async read({ cursor }) {
      expect(cursor).toBe(reads === 0 ? null : String(reads));
      reads++;
      return { events: reads <= 1000 ? [{ id: "e" + reads, type: "system.message", processed_at: null, content: [{ type: "text", text: "next" }] }] : [terminal], cursor: String(reads), hasMore: reads % 3 === 0 };
    } } });
    let prompts = 0;
    for await (const command of channel.commands(new AbortController().signal)) if (command.type === "session.prompt") prompts++;
    expect(prompts).toBe(1000);
    expect(reads).toBe(1001);
    await channel.close();
  });

  it("restarts from native history and preserves unconsumed input preceding idle", async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const cursors: Array<string | null> = [];
      const channel = createManagedHarnessHttpControlChannel({ ...options(), eventReader: { async read({ cursor }) {
        cursors.push(cursor);
        return { events: [
          { ...first, id: "done", processed_at: "earlier" }, first,
          { id: "idle", type: "session.status_idle", processed_at: "later" }, terminal,
        ], cursor: "tail", hasMore: false };
      } } });
      const commands = [];
      for await (const command of channel.commands(new AbortController().signal)) commands.push(command);
      expect(commands[0]).toMatchObject({ canonicalCompletedTurnId: "done" });
      expect(commands.filter(c => c.type === "session.prompt")).toMatchObject([{ turnId: "input1" }]);
      expect(cursors).toEqual([null]);
      await channel.close();
    }
  });

  it("accepts null in recovery parsing without modifying its processing stamp", async () => {
    const history = createManagedHarnessHttpRecoveryHistory({ apiBaseUrl: "https://test", sessionsToken: "token", fetch: async () => json({ data: [first], next_page: null }) });
    await expect(history.list("s")).resolves.toEqual([first]);
  });
});
