// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import * as smd from "streaming-markdown";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentUIStreamSubscriber } from "../src/agent-ui/index.js";
import {
  AgentUIStreamingMarkdown,
  createStreamTextPacer,
} from "../src/agent-ui/react.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

/** Small seeded PRNG so a failing seed reproduces exactly. */
function random(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const pick = <T,>(items: readonly T[]): T => items[int(0, items.length - 1)]!;
  return { next, int, pick };
}

const WORDS = [
  "finalize", "the", "表格", "评测", "#1044", "max_execution_time=100", "🙂",
  "👩🏽‍💻", "x", "4", "00", "run", "状态", "a.b", "100%", "e.g.", "“引号”",
];

function markdownDocument(rng: ReturnType<typeof random>): string {
  const inline = () => {
    const parts: string[] = [];
    for (let i = rng.int(3, 12); i > 0; i--) {
      const word = rng.pick(WORDS);
      parts.push(rng.pick([
        word, word, word,
        `\`${word}\``,
        `**${word}**`,
        `*${word}*`,
        `[${word}](https://example.com/${i})`,
        `~~${word}~~`,
      ]));
    }
    return parts.join(rng.pick([" ", " ", "，", ", "]));
  };
  const blocks: string[] = [];
  for (let i = rng.int(2, 7); i > 0; i--) {
    blocks.push(rng.pick([
      () => inline(),
      () => `${"#".repeat(rng.int(1, 3))} ${inline()}`,
      () => Array.from({ length: rng.int(2, 4) }, () => `- ${inline()}`).join("\n"),
      () => Array.from({ length: rng.int(2, 4) }, (_, n) => `${n + 1}. ${inline()}`).join("\n"),
      () => `> ${inline()}`,
      () => ["| a | b | c |", "|---|---|---|",
        ...Array.from({ length: rng.int(1, 6) }, () =>
          `| ${rng.pick(WORDS)} | \`${rng.pick(WORDS)}\` | ${rng.pick(WORDS)} |`)].join("\n"),
      () => `\`\`\`ts\nconst value = ${rng.int(0, 999)};\n\`\`\``,
    ])());
  }
  return blocks.join("\n\n");
}

/** Split without breaking a code point, the way transports deliver text. */
function chunks(rng: ReturnType<typeof random>, text: string): string[] {
  const points = Array.from(text);
  const out: string[] = [];
  for (let i = 0; i < points.length;) {
    const size = rng.pick([1, 1, 2, 3, 5, 8, 20, 40]);
    out.push(points.slice(i, i + size).join(""));
    i += size;
  }
  return out;
}

function renderedText(text: string, end: boolean): string {
  const host = document.createElement("div");
  const parser = smd.parser(smd.default_renderer(host));
  smd.parser_write(parser, text);
  if (end) smd.parser_end(parser);
  return host.textContent ?? "";
}

async function mountStream() {
  vi.useFakeTimers({
    toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout", "clearTimeout"],
  });
  let listener: AgentUIStreamSubscriber | undefined;
  const source = {
    subscribeTurnStream(_turnId: string, next: AgentUIStreamSubscriber) {
      listener = next;
      return () => { listener = undefined; };
    },
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(
    <AgentUIStreamingMarkdown store={source} turnId="chaos" kind="assistant" />,
  ));
  const host = container.querySelector<HTMLElement>("[data-agent-ui-streaming-markdown]")!;
  return {
    host,
    send: (text: string) => act(() => listener?.({ kind: "assistant", text })),
    advance: (ms: number) => act(() => { vi.advanceTimersByTime(ms); }),
    unmount: () => act(() => root.unmount()),
  };
}

describe("streaming markdown held tail", () => {
  it("keeps a held character after a closed inline code span, not inside it", async () => {
    const stream = await mountStream();
    stream.send("Call `finalize` t");
    await stream.advance(500);
    expect(stream.host.querySelector("code")?.textContent).toBe("finalize");
    expect(stream.host.textContent).toBe("Call finalize t");
    stream.send("o end");
    await stream.advance(500);
    expect(stream.host.querySelector("code")?.textContent).toBe("finalize");
    expect(stream.host.textContent).toBe("Call finalize to end");
    await stream.unmount();
  });

  it("does not show a held character that may still become markup", async () => {
    const stream = await mountStream();
    stream.send("plain *");
    await stream.advance(500);
    expect(stream.host.textContent).toBe("plain ");
    stream.send("em* done");
    await stream.advance(500);
    expect(stream.host.querySelector("em")?.textContent).toBe("em");
    await stream.unmount();
  });

  it("only appends to revealed text under random chunking, pauses and frames", async () => {
    for (let seed = 1; seed <= 150; seed++) {
      const rng = random(seed);
      const doc = markdownDocument(rng);
      const stream = await mountStream();
      let previous = "";
      const observe = (step: string) => {
        const now = stream.host.textContent ?? "";
        if (!now.startsWith(previous)) {
          throw new Error(
            `seed ${seed} ${step}: revealed text changed\n`
            + `before: ${JSON.stringify(previous.slice(-40))}\n`
            + `after:  ${JSON.stringify(now.slice(-40))}`,
          );
        }
        previous = now;
      };
      for (const piece of chunks(rng, doc)) {
        stream.send(piece);
        observe("send");
        await stream.advance(rng.pick([0, 0, 4, 11, 16, 33, 120, 400]));
        observe("frame");
      }
      await stream.advance(5_000);
      observe("drain");
      const complete = renderedText(doc, true);
      expect(complete.startsWith(previous), `seed ${seed}: final text`).toBe(true);
      expect(previous.length, `seed ${seed}: lost text`)
        .toBeGreaterThanOrEqual(renderedText(doc, false).length);
      await stream.unmount();
      vi.useRealTimers();
      document.body.replaceChildren();
    }
  });
});

/** Discrete-event model of one renderer main thread: rAF at 60 Hz, a write
 *  blocks the thread for `cost(rendered)` ms and delays timers and input. */
function simulatePacer({
  rng,
  seconds,
  charsPerMs,
  cost,
}: {
  rng?: ReturnType<typeof random>;
  seconds: number;
  charsPerMs: number;
  cost: (rendered: number) => number;
}) {
  let t = 0;
  let busyUntil = 0;
  let rendered = 0;
  let maxLag = 0;
  const writes: string[] = [];
  const timers: Array<{ due: number; callback: () => void; id: number }> = [];
  let nextId = 1;
  const frame = (at: number) => Math.ceil(at / (1000 / 60)) * (1000 / 60);
  const pacer = createStreamTextPacer({
    now: () => t,
    write: (text) => {
      writes.push(text);
      rendered += text.length;
      t += cost(rendered);
      busyUntil = t;
    },
    schedule: (callback, delay) => {
      const id = nextId++;
      timers.push({ due: frame(Math.max(t + delay, busyUntil)), callback, id });
      return id;
    },
    cancel: (id) => {
      const index = timers.findIndex((timer) => timer.id === id);
      if (index >= 0) timers.splice(index, 1);
    },
  });
  const end = seconds * 1000;
  let sent = "";
  let nextArrival = 0;
  for (;;) {
    timers.sort((a, b) => a.due - b.due);
    const timer = timers[0];
    const arrival = nextArrival <= end ? Math.max(nextArrival, busyUntil) : Infinity;
    const at = Math.min(timer?.due ?? Infinity, arrival);
    if (at === Infinity) break;
    t = Math.max(t, at);
    if (at === arrival) {
      const piece = rng ? rng.pick(["ab", "表格", "🙂", "x", "max_execution_time=100 "]) : "ab";
      pacer.enqueue(piece);
      sent += piece;
      nextArrival += piece.length / charsPerMs * (rng ? rng.pick([0.2, 1, 1, 3]) : 1);
    } else {
      timers.splice(0, 1);
      timer!.callback();
    }
    maxLag = Math.max(maxLag, sent.length - rendered);
  }
  pacer.dispose();
  return { drainMs: t - end, maxLag, sent, written: writes.join(""), writes };
}

describe("stream pacer under slow frames", () => {
  it("keeps the reveal rate when every frame is slower than its budget", () => {
    const fast = simulatePacer({ seconds: 10, charsPerMs: 0.18, cost: () => 1 });
    const slow = simulatePacer({ seconds: 10, charsPerMs: 0.18, cost: () => 60 });
    expect(fast.written).toBe(fast.sent);
    expect(slow.written).toBe(slow.sent);
    // Time spent in slow frames still counts toward the reveal.
    expect(slow.drainMs).toBeLessThan(150);
    expect(slow.maxLag).toBeLessThan(35);
  });

  it("keeps up while a growing table makes each write more expensive", () => {
    const table = simulatePacer({
      seconds: 20,
      charsPerMs: 0.18,
      cost: (rendered) => 2 + rendered * 0.03,
    });
    expect(table.written).toBe(table.sent);
    // ~0.25 s of text at this rate; discarding slow-frame time let it reach 68.
    expect(table.maxLag).toBeLessThan(50);
  });

  it("delivers every chunk intact under random arrival and frame costs", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rng = random(seed);
      const base = rng.pick([1, 8, 30, 60, 120]);
      const growth = rng.pick([0, 0.005, 0.02, 0.06]);
      const run = simulatePacer({
        rng,
        seconds: rng.int(1, 8),
        charsPerMs: rng.pick([0.05, 0.18, 0.6]),
        cost: (rendered) => base + rendered * growth,
      });
      expect(run.written, `seed ${seed}`).toBe(run.sent);
      expect(run.writes.some((text) => /[\uD800-\uDBFF]$/.test(text)), `seed ${seed}: split pair`).toBe(false);
      expect(run.drainMs, `seed ${seed}: drain`).toBeLessThan(2_000);
    }
  });
});
