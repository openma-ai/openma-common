import { describe, expect, it } from "vitest";

import { createAgentChatController } from "../src/chat-ui/controller.js";
import { createOpenMAEvent } from "../src/session-events/openma.js";

describe("AgentChatController", () => {
  it("follows the AI SDK shape: optimistic typed parts plus a transport stream", async () => {
    const sent: unknown[] = [];
    const controller = createAgentChatController({
      id: "session-1",
      setup: { cwd: "/tmp/project" },
      createTurnId: () => "turn-1",
      now: () => new Date("2026-08-26T10:00:00.000Z"),
      transport: {
        async sendMessages(input) {
          sent.push(input);
          return new ReadableStream({
            start(stream) {
              stream.enqueue(
                createOpenMAEvent({
                  event_id: "assistant-1",
                  type: "agent.message",
                  session_id: "session-1",
                  turn_id: "turn-1",
                  source: { kind: "harness" },
                  occurred_at: "2026-08-26T10:00:01.000Z",
                  data: { text: "Done." },
                }),
              );
              stream.enqueue(
                createOpenMAEvent({
                  event_id: "turn-complete",
                  type: "turn.completed",
                  session_id: "session-1",
                  turn_id: "turn-1",
                  source: { kind: "harness" },
                  occurred_at: "2026-08-26T10:00:02.000Z",
                  data: {},
                }),
              );
              stream.close();
            },
          });
        },
        async reconnectToStream() {
          return null;
        },
      },
    });

    const pending = controller.sendMessage({ text: "Inspect it" });
    expect(controller.status).toBe("submitted");
    expect(controller.store.getState().turns["turn-1"]?.items[0]).toMatchObject({
      kind: "message",
      role: "user",
      text: "Inspect it",
    });

    await pending;

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      trigger: "submit-message",
      chatId: "session-1",
      turnId: "turn-1",
      setup: { cwd: "/tmp/project" },
      prompt: { text: "Inspect it" },
    });
    expect(controller.status).toBe("ready");
    expect(controller.store.getState().turns["turn-1"]?.items.at(-1)).toMatchObject({
      kind: "message",
      role: "assistant",
      text: "Done.",
    });
  });

  it("keeps transcript state memory-only and exposes no history API", () => {
    const controller = createAgentChatController({
      id: "session-1",
      transport: {
        async sendMessages() {
          return new ReadableStream({ start: (stream) => stream.close() });
        },
        async reconnectToStream() {
          return null;
        },
      },
    });

    expect("loadHistory" in controller).toBe(false);
    expect("persist" in controller).toBe(false);
    expect(controller.store.getState().turnOrder).toEqual([]);
  });
});
