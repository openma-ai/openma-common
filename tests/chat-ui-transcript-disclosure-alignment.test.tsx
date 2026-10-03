// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import {
  ChatCollapsibleEventSequence,
  ChatReasoning,
  ChatReasoningContent,
  ChatReasoningTrigger,
} from "../src/chat-ui/components.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function loadChatStyles(): string {
  return readFileSync(
    resolve(import.meta.dirname, "../src/chat-ui/styles.css"),
    "utf8",
  );
}

function mountTurnFixture(renderTree: () => ReactNode) {
  const style = document.createElement("style");
  style.dataset.testStyles = "true";
  style.textContent = `
    :root {
      --fg: rgb(36, 36, 36);
      --fg-muted: rgb(137, 136, 133);
      --chat-fg: var(--fg);
      --chat-fg-muted: var(--fg-muted);
    }
    .text-fg-muted { color: var(--fg-muted); }
    .assistant-body { font-size: 14px; line-height: 1.6; margin-top: 12px; }
    ${loadChatStyles()}
  `;
  document.head.append(style);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(renderTree());
  });
  return { container, root, style };
}

describe("transcript disclosure row alignment and hover contract", () => {
  afterEach(() => {
    document.body.replaceChildren();
    document.head.querySelectorAll("style[data-test-styles]").forEach((el) => {
      el.remove();
    });
  });

  it("aligns process and tool summary padding with assistant body (0px leading inset)", () => {
    const { container, root, style } = mountTurnFixture(() => (
      <div data-session-turn-response="true">
        <ChatReasoning defaultOpen={false}>
          <ChatReasoningTrigger aria-label="Worked" showIcon={false} />
          <ChatReasoningContent>Body</ChatReasoningContent>
        </ChatReasoning>
        <ChatCollapsibleEventSequence
          active={false}
          completedProjection={{ summary: "Ran 1 action" }}
          nodes={[
            {
              key: "only",
              projection: { summary: "Tool" },
              content: <p>Tool body</p>,
            },
            {
              key: "second",
              projection: { summary: "Tool 2" },
              content: <p>Tool body 2</p>,
            },
          ]}
          forceGroup
        />
        <p className="assistant-body" data-assistant-body="true">
          Assistant reply for alignment reference.
        </p>
      </div>
    ));

    const processTrigger = container.querySelector<HTMLButtonElement>(
      '[data-chat-reasoning-trigger="true"]',
    );
    const activityTrigger = container.querySelector<HTMLButtonElement>(
      '[data-chat-activity-disclosure-trigger="true"]',
    );

    expect(processTrigger).not.toBeNull();
    expect(activityTrigger).not.toBeNull();

    const processPadding = getComputedStyle(processTrigger!);
    const activityPadding = getComputedStyle(activityTrigger!);
    expect(processPadding.paddingLeft).toBe("0px");
    expect(activityPadding.paddingLeft).toBe("0px");
    expect(
      processPadding.paddingInlineStart ||
        processPadding.getPropertyValue("padding-inline-start"),
    ).toBe("0px");
    expect(
      activityPadding.paddingInlineStart ||
        activityPadding.getPropertyValue("padding-inline-start"),
    ).toBe("0px");

    act(() => root.unmount());
    style.remove();
  });

  it("keeps transcript disclosure rows transparent at rest with zero leading padding", () => {
    const { container, root, style } = mountTurnFixture(() => (
      <ChatCollapsibleEventSequence
        active={false}
        completedProjection={{ summary: "Ran 1 action" }}
        nodes={[
          {
            key: "only",
            projection: { summary: "Tool" },
            content: <p>Body</p>,
          },
          {
            key: "second",
            projection: { summary: "Tool 2" },
            content: <p>Body 2</p>,
          },
        ]}
        forceGroup
      />
    ));

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-chat-activity-disclosure-trigger="true"]',
    );
    expect(trigger).not.toBeNull();
    if (!trigger) return;

    const idle = getComputedStyle(trigger);
    expect(idle.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(idle.paddingLeft).toBe("0px");

    act(() => root.unmount());
    style.remove();
  });

  it("shows focus-visible outline on activity disclosure triggers", () => {
    const { container, root, style } = mountTurnFixture(() => (
      <ChatCollapsibleEventSequence
        active={false}
        completedProjection={{ summary: "Ran 1 action" }}
        nodes={[
          { key: "a", projection: { summary: "A" }, content: <p>A</p> },
          { key: "b", projection: { summary: "B" }, content: <p>B</p> },
        ]}
        forceGroup
      />
    ));

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-chat-activity-disclosure-trigger="true"]',
    );
    expect(trigger).not.toBeNull();
    if (!trigger) return;

    trigger.focus();
    const focused = getComputedStyle(trigger);
    expect(
      focused.outlineWidth !== "0px" || focused.outlineStyle === "solid",
    ).toBe(true);

    act(() => root.unmount());
    style.remove();
  });

  it("keeps activity disclosure triggers as tab-focusable buttons with keyboard toggle", () => {
    const { container, root, style } = mountTurnFixture(() => (
      <ChatCollapsibleEventSequence
        active={false}
        completedProjection={{ summary: "Ran commands" }}
        nodes={[
          { key: "a", projection: { summary: "A" }, content: <p>A</p> },
          { key: "b", projection: { summary: "B" }, content: <p>B</p> },
        ]}
        forceGroup
      />
    ));

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-chat-activity-disclosure-trigger="true"]',
    );
    expect(trigger).not.toBeNull();
    if (!trigger) return;

    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger.getAttribute("type")).toBe("button");
    expect(trigger.tabIndex).toBe(0);
    expect(trigger.getAttribute("data-chat-turn-disclosure-trigger")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBeTruthy();

    act(() => {
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", { key: " ", bubbles: true }),
      );
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    act(() => root.unmount());
    style.remove();
  });
});
