import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  generateStressTurn,
  type CanonicalEvent,
} from "../src/testing/stress-session.js";

describe("stress session generator", () => {
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
