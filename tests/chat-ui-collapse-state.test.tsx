// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

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

  it("keeps the process trigger visually owned when a host styles native buttons", async () => {
    const style = document.createElement("style");
    style.textContent = `
      button:not(.clickable-icon) {
        background: white;
        border: 2px solid red;
        box-shadow: 0 0 0 4px blue;
        padding: 10px 12px;
        font-size: 18px;
      }
      ${readFileSync(resolve(import.meta.dirname, "../src/chat-ui/styles.css"), "utf8")}
    `;
    document.head.append(style);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <div data-session-turn-response="true">
          <ChatReasoning isStreaming data-session-process-state="running">
            <ChatReasoningTrigger aria-label="Working" showIcon={false} />
            <ChatReasoningContent>Thinking</ChatReasoningContent>
          </ChatReasoning>
        </div>,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-chat-reasoning-trigger="true"]',
    );
    expect(trigger).not.toBeNull();
    if (trigger) {
      const computed = getComputedStyle(trigger);
      expect(computed.backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(computed.borderTopWidth).toBe("0px");
      expect(computed.boxShadow).toBe("none");
      expect(computed.paddingTop).toBe("0px");
      expect(computed.paddingRight).toBe("0px");
      expect(computed.paddingLeft).toBe("0px");
      expect(
        computed.paddingInlineStart || computed.getPropertyValue("padding-inline-start"),
      ).toBe("0px");
      expect(computed.fontSize).toBe("13px");
      expect(computed.width).not.toBe("fit-content");
    }

    act(() => root.unmount());
    style.remove();
  });

  it("paints the thought chip with the bubble surface when showIcon is enabled", async () => {
    const style = document.createElement("style");
    style.textContent = `
      :root {
        --bg-bubble: rgb(233, 233, 233);
        --chat-bg-bubble: rgb(233, 233, 233);
      }
      ${readFileSync(resolve(import.meta.dirname, "../src/chat-ui/styles.css"), "utf8")}
    `;
    document.head.append(style);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ChatReasoning>
          <ChatReasoningTrigger aria-label="Thought" />
          <ChatReasoningContent>Body</ChatReasoningContent>
        </ChatReasoning>,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-chat-reasoning-trigger="true"]',
    );
    expect(trigger?.classList.contains("chat-reasoning-trigger--chip")).toBe(true);
    if (trigger) {
      const chipComputed = getComputedStyle(trigger);
      expect(chipComputed.width).toBe("fit-content");
      expect(chipComputed.backgroundColor).not.toBe("rgb(255, 255, 255)");
      expect(
        chipComputed.backgroundColor.includes("233") ||
          chipComputed.backgroundColor.includes("--chat-bg-bubble"),
      ).toBe(true);
    }

    act(() => root.unmount());
    style.remove();
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
