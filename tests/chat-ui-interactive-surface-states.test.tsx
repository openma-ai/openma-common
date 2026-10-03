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

function hostButtonReset(): string {
  return `
    button:not(.clickable-icon) {
      background: white;
      border: 2px solid red;
      box-shadow: 0 0 0 4px blue;
      outline: 3px solid orange;
      padding: 10px 12px;
    }
    button:focus {
      outline: 3px solid orange;
      background: #ffffcc;
    }
  `;
}

function loadChatStyles(): string {
  return readFileSync(
    resolve(import.meta.dirname, "../src/chat-ui/styles.css"),
    "utf8",
  );
}

function assertPlainInteractiveSurface(button: HTMLButtonElement) {
  const computed = getComputedStyle(button);
  expect(computed.backgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(computed.borderTopWidth).toBe("0px");
  expect(computed.boxShadow).toBe("none");
  expect(computed.outlineStyle).not.toBe("solid");
  if (computed.outlineWidth !== "medium") {
    expect(computed.outlineWidth).toBe("0px");
  }
}

describe("chat interactive surface focus and open states", () => {
  afterEach(() => {
    document.body.replaceChildren();
    document.head.querySelectorAll("style[data-test-styles]").forEach((el) => {
      el.remove();
    });
  });

  function mountWithStyles(renderTree: () => ReactNode) {
    const style = document.createElement("style");
    style.dataset.testStyles = "true";
    style.textContent = `${hostButtonReset()}\n${loadChatStyles()}`;
    document.head.append(style);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    act(() => {
      root.render(renderTree());
    });
    return { container, root, style };
  }

  it("keeps activity group rows plain after mouse click when the pointer leaves", async () => {
    const { container, root, style } = mountWithStyles(() => (
      <ChatCollapsibleEventSequence
        active={false}
        completedProjection={{ summary: "Ran 2 actions" }}
        nodes={[
          {
            key: "a",
            projection: { summary: "Read" },
            content: <p>Read body</p>,
          },
          {
            key: "b",
            projection: { summary: "Run" },
            content: <p>Run body</p>,
          },
        ]}
      />
    ));

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-chat-activity-disclosure-trigger="true"]',
    );
    expect(trigger).not.toBeNull();
    if (!trigger) return;

    assertPlainInteractiveSurface(trigger);
    act(() => {
      trigger.click();
    });
    trigger.blur();
    assertPlainInteractiveSurface(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    act(() => root.unmount());
    style.remove();
  });

  it("keeps process reasoning rows plain after mouse click when the pointer leaves", async () => {
    const { container, root, style } = mountWithStyles(() => (
      <ChatReasoning defaultOpen={false}>
        <ChatReasoningTrigger aria-label="Worked" showIcon={false} />
        <ChatReasoningContent>Body</ChatReasoningContent>
      </ChatReasoning>
    ));

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-chat-reasoning-trigger="true"]',
    );
    expect(trigger).not.toBeNull();
    if (!trigger) return;

    act(() => {
      trigger.click();
    });
    trigger.blur();
    assertPlainInteractiveSurface(trigger);

    act(() => root.unmount());
    style.remove();
  });

  it("shows a focus ring for keyboard focus-visible on transcript rows", async () => {
    const { container, root, style } = mountWithStyles(() => (
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

    trigger.focus();
    const focused = getComputedStyle(trigger);
    expect(
      focused.outlineWidth !== "0px" || focused.outlineStyle === "solid",
    ).toBe(true);

    act(() => root.unmount());
    style.remove();
  });
});
