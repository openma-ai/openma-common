import { describe, expect, it } from "vitest";

import {
  createAgentUISessionRegistry,
  type AgentUIStore,
} from "../src/agent-ui/index.js";
import { createOpenMAEvent } from "../src/session-events/openma.js";

function addPrompt(store: AgentUIStore, sessionId: string, turnId: string, text: string) {
  store.dispatch(
    createOpenMAEvent({
      event_id: `${turnId}:prompt`,
      type: "user.message",
      session_id: sessionId,
      turn_id: turnId,
      source: { kind: "user" },
      occurred_at: "2026-08-27T00:00:00.000Z",
      data: { message_id: `${turnId}:prompt`, text },
    }),
  );
}

describe("Backchat-shaped Agent UI session registry", () => {
  it("keeps one transcript store per session while the host switches sessions", () => {
    const registry = createAgentUISessionRegistry();
    const first = registry.get("session-one");
    addPrompt(first, "session-one", "turn-one", "first prompt");

    const second = registry.get("session-two");
    addPrompt(second, "session-two", "turn-two", "second prompt");

    expect(registry.get("session-one")).toBe(first);
    expect(registry.get("session-one").getState().turnOrder).toEqual([
      "turn-one",
    ]);
    expect(registry.get("session-two")).toBe(second);
    expect(registry.get("session-two").getState().turnOrder).toEqual([
      "turn-two",
    ]);
  });

  it("replacing a transport connection never replaces the session transcript", () => {
    const registry = createAgentUISessionRegistry();
    const beforeReconnect = registry.get("session-one");
    addPrompt(beforeReconnect, "session-one", "turn-one", "keep me");

    const afterReconnect = registry.get("session-one");

    expect(afterReconnect).toBe(beforeReconnect);
    expect(afterReconnect.getState().turns["turn-one"]?.items[0]).toMatchObject({
      role: "user",
      text: "keep me",
    });
  });
});
