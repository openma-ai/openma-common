// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createAgentUIStore,
  type AgentUIStreamDelta,
  type AgentUIStreamSubscriber,
} from "../src/agent-ui/index.js";
import {
  AgentUIStreamingMarkdown,
  AgentUIStreamingThoughtProjection,
  createStreamTextPacer,
} from "../src/agent-ui/react.js";

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("Agent UI React streaming elements", () => {
  it("reveals one Unicode character per scheduled tick", () => {
    const scheduled: Array<() => void> = [];
    const write = vi.fn();
    const pacer = createStreamTextPacer({
      write,
      schedule: (callback) => {
        scheduled.push(callback);
        return scheduled.length;
      },
      cancel: vi.fn(),
    });

    pacer.enqueue("你🙂好");
    expect(write).not.toHaveBeenCalled();

    scheduled.shift()?.();
    expect(write).toHaveBeenNthCalledWith(1, "你");
    scheduled.shift()?.();
    expect(write).toHaveBeenNthCalledWith(2, "🙂");
    scheduled.shift()?.();
    expect(write).toHaveBeenNthCalledWith(3, "好");
    expect(write).toHaveBeenCalledTimes(3);
  });

  it("keeps one ellipsized header row for each explicit thinking line", () => {
    const html = renderToStaticMarkup(
      <AgentUIStreamingThoughtProjection
        store={createAgentUIStore("session-thinking")}
        turnId="turn-thinking-header"
        prefixSkip={0}
        fallback={
          "A very long first line that must not wrap into the next visual row.\n"
          + "A second explicit line.\n\nA third paragraph."
        }
        mode="body"
      />,
    );

    expect(html.match(/data-thought-projection-line="true"/g)).toHaveLength(3);
    expect(html.match(/class="[^"]*truncate[^"]*"/g)).toHaveLength(3);
    expect(html).toContain("A very long first line");
    expect(html).toContain("A second explicit line.");
    expect(html).toContain("A third paragraph.");
  });

  it("exposes an inert markdown host for the direct turn stream", () => {
    const html = renderToStaticMarkup(
      <AgentUIStreamingMarkdown
        store={createAgentUIStore("session-markdown")}
        turnId="turn-markdown"
        kind="assistant"
      />,
    );

    expect(html).toContain('data-agent-ui-streaming-markdown="assistant"');
    expect(html).not.toContain("children=");
  });

  it("replays only the active segment and appends later deltas without React text state", async () => {
    vi.useFakeTimers();
    let listener: AgentUIStreamSubscriber | undefined;
    const streamSource = {
      subscribeTurnStream(
        _turnId: string,
        next: AgentUIStreamSubscriber,
      ) {
        listener = next;
        next({ kind: "assistant", text: "prior tail" });
        return () => {
          listener = undefined;
        };
      },
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AgentUIStreamingMarkdown
          store={streamSource}
          turnId="turn-segment"
          kind="assistant"
          prefixSkip={6}
        />,
      );
    });
    expect(container.textContent).toBe("tail");

    act(() => {
      listener?.({ kind: "assistant", text: " plus" } satisfies AgentUIStreamDelta);
      vi.runAllTimers();
    });
    expect(container.textContent).toBe("tail plus");

    act(() => root.unmount());
  });
});
