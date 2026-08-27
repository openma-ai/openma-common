// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import {
  ChatCollapsibleEventSequence,
  ChatReasoning,
  ChatReasoningContent,
  ChatReasoningTrigger,
  ChatThoughtEventRow,
} from "../src/chat-ui/components.js";

describe("nested chat disclosure state", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("preserves an expanded event group when its parent is closed and reopened", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ChatReasoning defaultOpen>
          <ChatReasoningTrigger aria-label="Process" />
          <ChatReasoningContent>
            <ChatCollapsibleEventSequence
              active={false}
              completedProjection={{ summary: "Ran 2 actions" }}
              nodes={[
                {
                  key: "read",
                  projection: { summary: "Read" },
                  content: <p>Read body</p>,
                },
                {
                  key: "run",
                  projection: { summary: "Run" },
                  content: <p>Run body</p>,
                },
              ]}
            />
          </ChatReasoningContent>
        </ChatReasoning>,
      );
    });

    const process = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Process"]',
    )!;
    const eventGroup = () =>
      container.querySelector<HTMLButtonElement>(
        '[data-collapsible-event-count="2"] > button',
      );

    act(() => eventGroup()!.click());
    expect(eventGroup()?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("Read body");

    act(() => process.click());
    await act(async () => {});
    act(() => process.click());

    expect(eventGroup()?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("Read body");

    act(() => root.unmount());
  });

  it("preserves an expanded thought when its event group is closed and reopened", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ChatCollapsibleEventSequence
          active={false}
          completedProjection={{ summary: "Ran 2 actions" }}
          nodes={[
            {
              key: "thought",
              projection: { summary: "Thought" },
              content: (
                <ChatThoughtEventRow
                  live={false}
                  text="Inspecting"
                  liveFallback="Thinking"
                  completedLabel="Thought for 1s"
                  renderBody={() => <p>Thought body</p>}
                />
              ),
            },
            {
              key: "run",
              projection: { summary: "Run" },
              content: <p>Run body</p>,
            },
          ]}
        />,
      );
    });

    const eventGroup = container.querySelector<HTMLButtonElement>(
      '[data-collapsible-event-count="2"] > button',
    )!;
    const thought = () =>
      container.querySelector<HTMLButtonElement>(
        '[data-thought-block="true"] > button',
      );

    act(() => eventGroup.click());
    act(() => thought()!.click());
    expect(thought()?.getAttribute("aria-expanded")).toBe("true");

    act(() => eventGroup.click());
    act(() => eventGroup.click());

    expect(thought()?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("Thought body");

    act(() => root.unmount());
  });
});
