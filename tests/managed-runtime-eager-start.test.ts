import { expect, it, describe, vi } from "vitest";
import { createManagedHarnessHttpControlChannel, createManagedAcpSupervisorHarness } from "../src/managed-runtime/index.js";
import { acpSessionFixture } from "./acp-fixtures.js";
const scope = { workspaceId: "w", environmentId: "e", sessionId: "s", workId: "work" };
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
const message = (id: string) => ({ id, type: "user.message", processed_at: null, content: [{ type: "text", text: id }] });

async function setup(hooks: boolean, outcome: "injected" | "startedNewTurn" | "promptRequired" | "failed" | "throw" = "injected", receiptFails = false, permission = false, interrupt = false, eager = true) {
  const first = deferred(), accepted = deferred(), permissionGate = deferred(), finishFeed = deferred();
  const log: string[] = []; const outputs: Record<string, unknown>[] = [];
  let page = 0;
  const channel = createManagedHarnessHttpControlChannel({
    scope, harness: { id: "acp", version: "1" }, workspacePath: "/workspace", apiBaseUrl: "https://test", sessionsToken: "token",
    scheduler: { sleep: async () => {} }, publishTurnStartBeforeDispatch: eager,
    fetch: async (_url, init) => { if(init?.method === "POST") outputs.push(...JSON.parse(String(init.body)).events); return new Response(JSON.stringify(init?.method === "POST" ? {} : { id: "s", environment_id: "e" })); },
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
  return { outputs, log, first, accepted, permissionGate, finishFeed, run, settled, close };
}


it.each([false,true])("eager=%s must not open a phantom running/span for injected steer", async eager => {
 const f = await setup(true, "injected", false, false, false, eager);
 try {
  await vi.waitFor(()=>expect(f.log).toContain("steer:sent"));
  f.accepted.resolve(); await vi.waitFor(()=>expect(f.log).toContain("receipt:steer:injected"));
  f.first.resolve(); f.finishFeed.resolve(); expect(await f.settled).toEqual({value:{exitCode:0}});
  console.log("STEER_EVIDENCE",JSON.stringify({eager,log:f.log,types:f.outputs.map(x=>x.type)}));
  expect(f.log.filter(x=>x.startsWith("prompt:"))).toEqual(["prompt:first"]);
  expect(f.outputs.filter(x=>x.type==="session.status_running")).toHaveLength(1);
  expect(f.outputs.filter(x=>x.type==="span.model_request_start")).toHaveLength(1);
  expect(f.outputs.filter(x=>x.type==="span.model_request_end")).toHaveLength(1);
 } finally {await f.close();}
});

it.each(["gate-reject","abort-gate","output-reject","output-response-lost"])("early start %s never dispatches native prompt", async mode => {
 const outputs: unknown[]=[]; let prompts=0, posts=0;
 const outer=new AbortController();
 const channel=createManagedHarnessHttpControlChannel({scope,harness:{id:"acp",version:"1"},workspacePath:"/workspace",apiBaseUrl:"https://test",sessionsToken:"token",publishTurnStartBeforeDispatch:true,retry:{maxAttempts:1},
  fetch:async (_url,init)=>{ if(init?.method==="POST"){posts++; if(mode==="output-reject") return new Response("reject",{status:409});outputs.push(...JSON.parse(String(init.body)).events);if(mode==="output-response-lost")throw new Error("lost response");} return Response.json({id:"s",environment_id:"e"}); },
  onBeforeDispatch:async()=>{if(mode==="gate-reject")throw new Error("lost fence");if(mode==="abort-gate")outer.abort(new Error("cancelled"));},
 });
 const command={type:"session.prompt" as const,sessionId:"s",turnId:"first",text:"first",input:{eventId:"first",event:message("first")}};
 const harness=createManagedAcpSupervisorHarness({connect:async()=>({...channel,async *commands(signal:AbortSignal){yield {type:"session.start" as const,sessionId:"s",agentId:"acp",runtime:"cloud" as const};yield command;await new Promise<void>(r=>{if(signal.aborted)r();else signal.addEventListener("abort",()=>r(),{once:true});});}}),
 acpRuntime:{start:async()=>acpSessionFixture({acpSessionId:"native",async *prompt(){prompts++;yield {type:"promptComplete",response:{}};}})},sessionPreparation:{prepare:async()=>({agent:{command:"acp"}})},sessionState:{beforeStart:async command=>({command}),onReady:async()=>{},checkpoint:async()=>{},release:async()=>{}},drainDeadlineMs:0,abortGraceMs:0});
 const run=await harness.start({scope,harness:{id:"acp",version:"1"},workspacePath:"/workspace",outputPath:null,checkpoint:async()=>{},signal:outer.signal});
 try {await run.completed.catch(()=>{}); expect(prompts).toBe(0);if(mode==="gate-reject"||mode==="abort-gate"){expect(outputs).toEqual([]);expect(posts).toBe(0);} else expect(posts).toBe(1);}
 finally{await run.stop("aborted");}
});


it("opens the second span only when steering requires a real prompt fallback", async () => {
  const f = await setup(true, "promptRequired");
  try {
    await vi.waitFor(() => expect(f.log).toContain("steer:sent"));
    expect(f.outputs.filter(event => event.type === "span.model_request_start")).toHaveLength(1);
    f.first.resolve();
    f.accepted.resolve();
    await vi.waitFor(() => expect(f.log).toContain("end:steer"));
    f.finishFeed.resolve();
    expect(await f.settled).toEqual({ value: { exitCode: 0 } });
    expect(f.log.filter(entry => entry.startsWith("prompt:"))).toEqual(["prompt:first", "prompt:steer"]);
    expect(f.outputs.filter(event => event.type === "span.model_request_start")).toHaveLength(2);
    expect(f.outputs.filter(event => event.type === "span.model_request_end")).toHaveLength(2);
  } finally { await f.close(); }
});
