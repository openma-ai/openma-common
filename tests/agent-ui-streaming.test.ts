import { describe, expect, it } from "vitest";

import { createAgentUIStore } from "../src/agent-ui/index.js";
import {
  createOpenMAEvent,
  type OpenMAEvent,
} from "../src/session-events/openma.js";

const source = { kind: "harness" as const, harness: "acp" };

function event(
  eventId: string,
  type: string,
  seq: number,
  data: unknown,
  turnId = "turn-stream",
): OpenMAEvent {
  return createOpenMAEvent({
    event_id: eventId,
    type,
    session_id: "session-stream",
    turn_id: turnId,
    source,
    occurred_at: `2026-08-27T00:00:${String(seq).padStart(2, "0")}.000Z`,
    seq,
    data,
  }) as OpenMAEvent;
}

describe("AgentUIStore dual-track streaming", () => {
  it("publishes one structural snapshot while forwarding every assistant delta", () => {
    const store = createAgentUIStore("session-stream");
    let structuralPublishes = 0;
    store.subscribe(() => {
      structuralPublishes += 1;
    });
    const deltas: Array<{ kind: "assistant" | "thought"; text: string }> = [];
    store.subscribeTurnStream("turn-stream", (delta) => deltas.push(delta));

    store.dispatch(event("chunk-1", "agent.message_chunk", 1, {
      message_id: "answer-1",
      text: "你🙂",
    }));
    store.dispatch(event("chunk-2", "agent.message_chunk", 2, {
      message_id: "answer-1",
      text: "好",
    }));

    expect(deltas).toEqual([
      { kind: "assistant", text: "你🙂" },
      { kind: "assistant", text: "好" },
    ]);
    expect(structuralPublishes).toBe(1);
    expect(store.getState().turns["turn-stream"]?.items).toMatchObject([
      { id: "answer-1", kind: "message", text: "你🙂好", status: "streaming" },
    ]);

    const replay: typeof deltas = [];
    store.subscribeTurnStream("turn-stream", (delta) => replay.push(delta));
    expect(replay).toEqual([{ kind: "assistant", text: "你🙂好" }]);
  });

  it("opens a new assistant segment after a tool even when messageId is unchanged", () => {
    const store = createAgentUIStore("session-stream");
    let structuralPublishes = 0;
    store.subscribe(() => {
      structuralPublishes += 1;
    });

    store.dispatch(event("before-tool", "agent.message_chunk", 1, {
      message_id: "answer-shared",
      text: "先检查。",
    }));
    store.dispatch(event("tool", "tool.started", 2, {
      tool_call_id: "tool-1",
      title: "Inspect",
    }));
    store.dispatch(event("after-tool", "agent.message_chunk", 3, {
      message_id: "answer-shared",
      text: "检查完成。",
    }));

    expect(structuralPublishes).toBe(3);
    expect(store.getState().turns["turn-stream"]?.items.map((item) => item.kind))
      .toEqual(["message", "tool", "message"]);
    expect(store.getState().turns["turn-stream"]?.items[2]).toMatchObject({
      kind: "message",
      text: "检查完成。",
    });
  });

  it("keeps anonymous consecutive thought chunks in one live segment", () => {
    const store = createAgentUIStore("session-stream");
    let structuralPublishes = 0;
    store.subscribe(() => {
      structuralPublishes += 1;
    });
    const deltas: Array<{ kind: "assistant" | "thought"; text: string }> = [];
    store.subscribeTurnStream("turn-stream", (delta) => deltas.push(delta));

    store.dispatch(event("thought-1", "agent.thinking", 1, { text: "Planning " }));
    store.dispatch(event("thought-2", "agent.thinking", 2, { text: "the fix" }));

    expect(structuralPublishes).toBe(1);
    expect(deltas).toEqual([
      { kind: "thought", text: "Planning " },
      { kind: "thought", text: "the fix" },
    ]);
    expect(store.getState().turns["turn-stream"]?.items).toMatchObject([
      { kind: "thinking", text: "Planning the fix", status: "streaming" },
    ]);
  });

  it("replays accumulated thought before accumulated assistant text", () => {
    const store = createAgentUIStore("session-stream");
    store.dispatch(event("thought", "agent.thinking", 1, {
      message_id: "thought-1",
      text: "Reasoning",
    }));
    store.dispatch(event("answer", "agent.message_chunk", 2, {
      message_id: "answer-1",
      text: "Done",
    }));

    const replay: Array<{ kind: "assistant" | "thought"; text: string }> = [];
    store.subscribeTurnStream("turn-stream", (delta) => replay.push(delta));

    expect(replay).toEqual([
      { kind: "thought", text: "Reasoning" },
      { kind: "assistant", text: "Done" },
    ]);
  });

  it("replays Backchat's repeated numeric thought chunks without dropping the equation", () => {
    const store = createAgentUIStore("session-stream");
    const chunks = [
      "The", " user", " is", " asking", " me", " to", " calculate", " ",
      "37", " +", " ", "58", " and", " output", " only", " \"", "CL",
      "AU", "DE", "_C", "U", "_OK", ":", " ", "95", "\".\n\n",
      "37", " +", " ", "58", " =", " ", "95", ".",
    ];

    chunks.forEach((text, index) => {
      store.dispatch(event(`numeric-thought-${index}`, "agent.thinking", index + 1, {
        message_id: "60d8e901-4ea5-41a1-a810-d798e7715e83",
        text,
      }));
    });

    expect(store.getState().turns["turn-stream"]?.items).toMatchObject([{
      kind: "thinking",
      text: 'The user is asking me to calculate 37 + 58 and output only "CLAUDE_CU_OK: 95".\n\n37 + 58 = 95.',
    }]);
  });
});
