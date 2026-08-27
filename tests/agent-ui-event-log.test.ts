import { describe, expect, it } from "vitest";

import {
  createAgentUIStore,
  replayAgentUIEventLog,
  type PersistedAgentUIEvent,
} from "../src/agent-ui/index.js";
import { createOpenMAEvent } from "../src/session-events/openma.js";

const sessionId = "session-history";

function decode(row: PersistedAgentUIEvent) {
  const data = row.data as {
    turn_id: string;
    text?: string;
    event?: unknown;
  };
  const type = row.type === "user_prompt"
    ? "user.message"
    : row.type === "turn_completed"
      ? "turn.completed"
      : "agent.message_chunk";
  const eventData = row.type === "user_prompt"
    ? { message_id: `${data.turn_id}:user`, text: data.text ?? "" }
    : row.type === "session.event"
      ? { message_id: `${data.turn_id}:assistant`, text: "restored answer" }
      : {};
  return createOpenMAEvent({
    event_id: `history:${row.seq}`,
    type,
    session_id: sessionId,
    turn_id: data.turn_id,
    source: { kind: "harness", harness: "codex-acp" },
    occurred_at: new Date(row.ts).toISOString(),
    seq: row.seq,
    data: eventData,
  });
}

describe("Agent UI event-log replay", () => {
  it("rebuilds one session store in persisted seq order and stays idempotent", () => {
    const rows: PersistedAgentUIEvent[] = [
      {
        seq: 3,
        type: "turn_completed",
        data: { turn_id: "turn-history" },
        ts: 3_000,
      },
      {
        seq: 1,
        type: "user_prompt",
        data: { turn_id: "turn-history", text: "restore me" },
        ts: 1_000,
      },
      {
        seq: 2,
        type: "session.event",
        data: {
          turn_id: "turn-history",
          event: { sessionUpdate: "agent_message_chunk" },
        },
        ts: 2_000,
      },
    ];
    const store = createAgentUIStore(sessionId);

    replayAgentUIEventLog(store, rows, decode);
    replayAgentUIEventLog(store, rows, decode);

    expect(store.getState().turnOrder).toEqual(["turn-history"]);
    expect(store.getState().turns["turn-history"]).toEqual({
      id: "turn-history",
      status: "completed",
      endedAt: "1970-01-01T00:00:03.000Z",
      items: [
        {
          id: "turn-history:user",
          kind: "message",
          role: "user",
          text: "restore me",
          status: "complete",
        },
        {
          id: "turn-history:assistant",
          kind: "message",
          role: "assistant",
          text: "restored answer",
          status: "streaming",
        },
      ],
    });
  });
});
