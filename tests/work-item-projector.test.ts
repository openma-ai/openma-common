import { describe, expect, it } from "vitest";

import {
  createOpenMAEvent,
  createWorkItemProjector,
  reduceWorkItems,
  type OpenMAEvent,
} from "../src/session-events/openma.js";

const source = { kind: "harness" as const, harness: "claude-acp", adapter: "claude" };

function event(
  type: string,
  data: Record<string, unknown>,
  fields: { event_id: string; work_item_id?: string; seq?: number },
): OpenMAEvent {
  return createOpenMAEvent({
    event_id: fields.event_id,
    type,
    session_id: "sess-1",
    source,
    occurred_at: "2026-08-04T10:00:00.000Z",
    ...(fields.work_item_id ? { work_item_id: fields.work_item_id } : {}),
    ...(fields.seq !== undefined ? { seq: fields.seq } : {}),
    data,
  } as Parameters<typeof createOpenMAEvent>[0]) as OpenMAEvent;
}

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function randomStream(seed: number, length: number): OpenMAEvent[] {
  const random = rng(seed);
  const pick = <T>(values: readonly T[]) => values[Math.floor(random() * values.length)]!;
  const ids = ["w1", "w2", "w3", "w4"];
  const kinds = ["bash", "agent", "other"];
  const out: OpenMAEvent[] = [];
  for (let index = 0; index < length; index += 1) {
    const roll = random();
    if (roll < 0.08 && out.length > 0) {
      out.push(pick(out));
      continue;
    }
    const id = pick(ids);
    const seq = random() < 0.1 ? undefined : random() < 0.12 ? Math.max(1, index - 5) : index + 1;
    const base = { event_id: `e${index}`, work_item_id: id, ...(seq !== undefined ? { seq } : {}) };
    const type = pick([
      "work_item.started",
      "work_item.progress",
      "work_item.output",
      "work_item.completed",
      "work_item.failed",
      "work_item.reidentified",
      "work_item.classified",
      "agent.message",
    ]);
    if (type === "agent.message") {
      out.push(event(type, { text: "noise" }, { event_id: `e${index}`, ...(seq !== undefined ? { seq } : {}) }));
    } else if (type === "work_item.reidentified") {
      out.push(event(type, { previous_work_item_id: pick(ids) }, base));
    } else if (type === "work_item.started" || type === "work_item.classified") {
      out.push(event(type, { kind: pick(kinds), title: `t${index}` }, base));
    } else if (type === "work_item.progress") {
      out.push(event(type, { progress: random(), output: `p${index}` }, base));
    } else if (type === "work_item.output") {
      out.push(event(type, { output: `o${index}` }, base));
    } else {
      out.push(event(type, { result: index, error: "x", kind: pick(kinds) }, base));
    }
  }
  return out;
}

describe("WorkItem projector", () => {
  it("equals the reducer after every event across seeded streams", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const stream = randomStream(seed, 120);
      const projector = createWorkItemProjector();
      stream.forEach((entry, index) => {
        projector.apply(entry);
        expect(projector.snapshot().items).toEqual(reduceWorkItems(stream.slice(0, index + 1)).items);
      });
    }
  });

  it("keeps earlier snapshots immutable and shares untouched items", () => {
    const projector = createWorkItemProjector();
    projector.apply(event("work_item.started", { kind: "bash", title: "a" }, { event_id: "a1", work_item_id: "a", seq: 1 }));
    projector.apply(event("work_item.started", { kind: "bash", title: "b" }, { event_id: "b1", work_item_id: "b", seq: 2 }));
    const before = projector.snapshot();
    const beforeA = before.items.get("a")!;

    projector.apply(event("work_item.output", { output: "line" }, { event_id: "a2", work_item_id: "a", seq: 3 }));
    const after = projector.snapshot();

    expect(after).not.toBe(before);
    expect(beforeA.output).toEqual([]);
    expect(after.items.get("a")!.output).toEqual(["line"]);
    expect(after.items.get("b")).toBe(before.items.get("b"));
  });

  it("keeps snapshot identity for events that do not change work items", () => {
    const projector = createWorkItemProjector();
    projector.apply(event("work_item.started", { kind: "bash" }, { event_id: "a1", work_item_id: "a", seq: 1 }));
    const before = projector.snapshot();
    expect(projector.apply(event("agent.message", { text: "hi" }, { event_id: "m1", seq: 2 }))).toBe(false);
    expect(projector.apply(event("work_item.started", { kind: "bash" }, { event_id: "a1", work_item_id: "a", seq: 1 }))).toBe(false);
    expect(projector.snapshot()).toBe(before);
  });

  it("reduces long streams in linear time", () => {
    const stream: OpenMAEvent[] = [];
    for (let index = 0; index < 40_000; index += 1) {
      const id = `w${index % 50}`;
      stream.push(event(index % 7 === 0 ? "work_item.started" : "work_item.output", { kind: "bash", output: `o${index}` }, {
        event_id: `e${index}`,
        work_item_id: id,
        seq: index + 1,
      }));
    }
    const started = performance.now();
    reduceWorkItems(stream);
    const reduceMs = performance.now() - started;

    const projector = createWorkItemProjector();
    const projectStarted = performance.now();
    for (const entry of stream.slice(0, 10_000)) projector.apply(entry);
    const projectMs = performance.now() - projectStarted;

    expect(reduceMs).toBeLessThan(1_000);
    expect(projectMs).toBeLessThan(1_000);
  });
});

describe("WorkItem projector history prepend", () => {
  it("re-reduces once per snapshot when an older page arrives out of order", () => {
    const newer = Array.from({ length: 50 }, (_, index) =>
      event("work_item.output", { output: `n${index}` }, { event_id: `n${index}`, work_item_id: "w", seq: 1000 + index }));
    const older = [
      event("work_item.started", { kind: "bash", title: "old" }, { event_id: "o0", work_item_id: "w", seq: 1 }),
      ...Array.from({ length: 50 }, (_, index) =>
        event("work_item.output", { output: `o${index}` }, { event_id: `o${index + 1}`, work_item_id: "w", seq: 2 + index })),
    ];
    const projector = createWorkItemProjector();
    for (const entry of newer) projector.apply(entry);
    const beforePrepend = projector.snapshot();
    for (const entry of older) projector.apply(entry);
    const afterPrepend = projector.snapshot();

    expect(afterPrepend).not.toBe(beforePrepend);
    expect(afterPrepend.items).toEqual(reduceWorkItems([...older, ...newer]).items);
    expect(afterPrepend.items.get("w")).toMatchObject({ title: "old", status: "running" });
    expect(projector.snapshot()).toBe(afterPrepend);
  });
});
