import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";

import {
  createTurnProjector,
} from "../../src/session-events/acp.js";
import {
  generateStressTurn,
  type CanonicalEvent,
} from "../../src/testing/stress-session.js";

describe("turn projector performance", () => {
  it("projects a 45k-event steering turn within linear-growth budgets", () => {
    const seed = JSON.parse(
      readFileSync(
        resolve(import.meta.dirname, "../fixtures/codex-sess-guardian-interleave.anon.json"),
        "utf8",
      ),
    ) as CanonicalEvent[];
    const events = generateStressTurn(seed);

    const warmup = createTurnProjector();
    for (let index = 0; index < Math.min(2_000, events.length); index += 1) {
      warmup.apply({ payload: events[index] });
      if ((index + 1) % 50 === 0) warmup.snapshot();
    }
    warmup.snapshot();

    (globalThis as typeof globalThis & { gc?: () => void }).gc?.();
    const heapBefore = process.memoryUsage().heapUsed;
    const projector = createTurnProjector();
    let finalSnapshot: unknown;
    const windows: Array<{ start: number; count: number; durationMs: number }> = [];

    for (let start = 0; start < events.length; start += 50) {
      const count = Math.min(50, events.length - start);
      const windowStart = performance.now();
      for (let offset = 0; offset < count; offset += 1) {
        projector.apply({ payload: events[start + offset] });
      }
      finalSnapshot = projector.snapshot();
      windows.push({
        start,
        count,
        durationMs: performance.now() - windowStart,
      });
    }
    (globalThis as typeof globalThis & { gc?: () => void }).gc?.();
    const heapAfter = process.memoryUsage().heapUsed;
    const heapDeltaMB = (heapAfter - heapBefore) / (1024 * 1024);

    const perEventUs = (rangeStart: number, rangeEnd: number) => {
      let durationMs = 0;
      let eventCount = 0;
      for (const window of windows) {
        const overlap = Math.max(
          0,
          Math.min(rangeEnd, window.start + window.count) -
            Math.max(rangeStart, window.start),
        );
        if (overlap === 0) continue;
        durationMs += window.durationMs * (overlap / window.count);
        eventCount += overlap;
      }
      return (durationMs / eventCount) * 1_000;
    };
    const first10Us = perEventUs(0, events.length * 0.1);
    const last10Us = perEventUs(events.length * 0.9, events.length);
    const growthRatio = last10Us / first10Us;
    const totalMs = windows.reduce((total, window) => total + window.durationMs, 0);
    const rows = [
      { metric: "events", value: `${events.length}`, budget: ">= 45,000", pass: events.length >= 45_000 },
      { metric: "perEventUs.first10", value: first10Us.toFixed(3), budget: "informational", pass: true },
      { metric: "perEventUs.last10", value: last10Us.toFixed(3), budget: "informational", pass: true },
      { metric: "growthRatio", value: growthRatio.toFixed(3), budget: "<= 3", pass: growthRatio <= 3 },
      { metric: "totalMs", value: totalMs.toFixed(3), budget: "<= 1500", pass: totalMs <= 1_500 },
      { metric: "heapDeltaMB", value: heapDeltaMB.toFixed(3), budget: "<= 256", pass: heapDeltaMB <= 256 },
    ];
    const table = [
      "| metric | value | budget | pass |",
      "| --- | ---: | ---: | :---: |",
      ...rows.map(
        ({ metric, value, budget, pass }) =>
          `| ${metric} | ${value} | ${budget} | ${pass ? "PASS" : "FAIL"} |`,
      ),
    ].join("\n");
    console.log(table);
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${table}\n`);
    }

    expect(growthRatio).toBeLessThanOrEqual(3);
    expect(totalMs).toBeLessThanOrEqual(1_500);
    expect(heapDeltaMB).toBeLessThanOrEqual(256);
    expect(events.length).toBeGreaterThanOrEqual(45_000);
    expect(finalSnapshot).toBeDefined();
  });
});
