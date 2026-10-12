import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  generateStressTurn,
  type CanonicalEvent,
} from "../src/testing/stress-session.js";

describe("stress session generator", () => {
  it("validates options and preserves chunk newline suffixes without a terminal seed event", () => {
    const turnId = "turn-stress";
    const event = (
      eventId: string,
      type: string,
      id: string,
      seq: number,
      data: Record<string, unknown>,
    ): CanonicalEvent => ({
      schema: "oma.event.v1",
      event_id: eventId,
      type,
      session_id: "session-stress",
      turn_id: id,
      occurred_at: "2026-10-01T00:00:00.000Z",
      seq,
      data,
    });
    const seed = [
      event("steer", "user.message", "client-1", 1, {
        input_kind: "steering",
        outcome: "injected",
        active_turn_id: turnId,
      }),
      event("chunk-with-content", "agent.message_chunk", turnId, 2, {
        text: "Part\n\n",
        content: { type: "text" },
      }),
      event("chunk-without-content", "agent.message_chunk", turnId, 3, {
        content: [],
      }),
    ];

    expect(() => generateStressTurn(seed, { targetEvents: -1 })).toThrow(RangeError);
    expect(() => generateStressTurn(seed, { targetEvents: 1.5 })).toThrow(RangeError);
    expect(() => generateStressTurn([], { targetEvents: 1 })).toThrow(TypeError);

    const generated = generateStressTurn(seed, { targetEvents: 1 });
    expect(generated).toHaveLength(4);
    expect(generated[1]?.data.text).toMatch(/\n\n$/);
    expect(generated[1]?.data.content).toMatchObject({
      type: "text",
      text: expect.stringContaining("Here is **bold** text"),
    });
    expect(generated[2]?.data.text).toContain("Here is **bold** text");
    expect(generated[2]?.data.content).toEqual([]);
    expect(generated.at(-1)).toMatchObject({
      type: "turn.completed",
      event_id: "steer-stress-final",
      data: { stop_reason: "end_turn" },
    });
  });

  it("repeats the steering turn deterministically with unique ids and canonical boundaries", () => {
    const seed = JSON.parse(
      readFileSync(
        resolve(import.meta.dirname, "./fixtures/codex-sess-guardian-interleave.anon.json"),
        "utf8",
      ),
    ) as CanonicalEvent[];
    const steering = seed.find(
      (event) =>
        event.type === "user.message" && event.data.input_kind === "steering",
    );
    const turnId = steering?.data.active_turn_id as string;
    const generated = generateStressTurn(seed, { targetEvents: 1_900 });

    expect(generated).toEqual(generateStressTurn(seed, { targetEvents: 1_900 }));
    expect(generated.every((event) => event.turn_id === turnId)).toBe(true);
    expect(generated.map((event) => event.seq)).toEqual(
      Array.from({ length: generated.length }, (_, index) => index + 1),
    );
    expect(generated.some((event) => event.type === "session.running")).toBe(false);
    expect(generated.some((event) => event.type === "session.idle")).toBe(false);
    const terminals = generated.filter((event) => event.type === "turn.completed");
    expect(terminals).toHaveLength(1);
    expect(terminals[0]?.data.stop_reason).toBe("end_turn");
    expect(
      generated
        .filter(
          (event) =>
            event.type === "user.message" && event.data.input_kind === "steering",
        )
        .every((event) => event.data.active_turn_id === turnId),
    ).toBe(true);

    const firstThought = seed.find(
      (event) => event.type === "agent.thinking" && event.turn_id === turnId,
    )!;
    const firstRepeat = generated.find(
      (event) => event.event_id === `${firstThought.event_id}-r0`,
    )!;
    const secondRepeat = generated.find(
      (event) => event.event_id === `${firstThought.event_id}-r1`,
    )!;
    expect(firstRepeat.data.message_id).toMatch(/-r0$/);
    expect(secondRepeat.data).not.toHaveProperty("message_id");

    const seedChunk = seed.find(
      (event) => event.type === "agent.message_chunk" && event.turn_id === turnId,
    )!;
    const stressChunk = generated.find(
      (event) => event.event_id === `${seedChunk.event_id}-r0`,
    )!;
    expect(stressChunk.data.text).toContain("Here is **bold** text");
    expect(stressChunk.data.content).toMatchObject({
      text: expect.stringContaining("Here is **bold** text"),
    });
  });
});
