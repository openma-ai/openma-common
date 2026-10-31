import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  defaultQueueDockLabels,
  QueueDock,
  type QueueDockLabels,
} from "../src/chat-ui/queue-dock.js";

const prompts = [
  { id: "queued-1", text: "Summarize the failing test" },
  { id: "queued-2", text: "Then patch the regression" },
];

describe("QueueDock", () => {
  it("renders the queue rows without inventing controls when callbacks are absent", () => {
    const html = renderToStaticMarkup(<QueueDock prompts={prompts} />);

    expect(html).toContain('data-composer-queue="true"');
    expect(html).toContain('data-queued-prompt-id="queued-1"');
    expect(html).toContain('data-queued-turn-id="queued-1"');
    expect(html).toContain("Summarize the failing test");
    expect(html).toContain("Then patch the regression");
    expect(html).toContain('aria-label="2 queued"');

    expect(html).not.toContain("data-queue-leading-icon");
    expect(html).not.toContain("data-queue-steer");
    expect(html).not.toContain("data-queue-move");
    expect(html).not.toContain("lucide-pencil");
    expect(html).not.toContain("lucide-trash-2");
    expect(html).not.toContain("<button");
  });

  it("renders only the controls whose callbacks exist", () => {
    const html = renderToStaticMarkup(
      <QueueDock
        prompts={prompts}
        callbacks={{
          update: vi.fn(),
          remove: vi.fn(),
          reorder: vi.fn(),
          steer: vi.fn(),
        }}
      />,
    );

    expect(html).toContain('data-queue-leading-icon="drag"');
    expect(html).toContain("lucide-grip-vertical");
    expect(html).toContain('data-queue-move="up"');
    expect(html).toContain('data-queue-move="down"');
    expect(html).toContain("lucide-arrow-up");
    expect(html).toContain("lucide-arrow-down");
    expect(html).toContain('data-queue-steer="true"');
    expect(html).toContain("lucide-send-horizontal");
    expect(html).toContain("lucide-pencil");
    expect(html).toContain("lucide-trash-2");
    expect(html).toContain('aria-label="Edit queued message 1"');
    expect(html).toContain('aria-label="Remove queued message 2"');
    expect(html).toContain('aria-label="Move queued message 2 up"');
    expect(html).toContain('aria-label="Steer queued message 1"');
    expect(html).toContain(">Send now</span>");

    // The arrow at an end exists but cannot move past it.
    expect(html).toMatch(/data-queue-move="up"[^>]*disabled/);
  });

  it("renders a blocked header and interrupt action only when offered", () => {
    const withInterrupt = renderToStaticMarkup(
      <QueueDock
        prompts={[prompts[0]!]}
        blocked={{
          reason: "requires_action",
          toolNames: ["Bash", "Read"],
          toolCallIds: ["call-1", "call-2"],
          onInterrupt: vi.fn(),
        }}
      />,
    );

    expect(withInterrupt).toContain('data-queue-blocked="requires_action"');
    expect(withInterrupt).toContain(
      "1 queued · waiting on tool Bash, Read",
    );
    expect(withInterrupt).toContain('data-queue-interrupt="true"');
    expect(withInterrupt).toContain("Interrupt");
    expect(withInterrupt).toContain("lucide-circle-pause");
    expect(withInterrupt).toContain("lucide-clock");

    const withoutInterrupt = renderToStaticMarkup(
      <QueueDock
        prompts={[]}
        blocked={{ reason: "requires_action", toolNames: ["Bash"] }}
      />,
    );

    expect(withoutInterrupt).toContain('data-queue-blocked="requires_action"');
    expect(withoutInterrupt).toContain("0 queued · waiting on tool Bash");
    expect(withoutInterrupt).not.toContain("data-queue-interrupt");
    expect(withoutInterrupt).not.toContain("<button");
  });

  it("returns null for an empty queue with no blocked state", () => {
    expect(renderToStaticMarkup(<QueueDock prompts={[]} />)).toBe("");
  });

  it("accepts host label overrides and count/index interpolation", () => {
    const labels: Partial<QueueDockLabels> = {
      title: (count) => `${count} messages waiting`,
      edit: (index) => `Change message ${index + 1}`,
      steer: "Send it",
      blocked: (count, names) =>
        `${count} pending while ${names.join(" + ")} runs`,
    };

    const html = renderToStaticMarkup(
      <QueueDock
        prompts={[prompts[0]!]}
        labels={labels}
        callbacks={{ update: vi.fn(), steer: vi.fn() }}
        blocked={{
          reason: "requires_action",
          toolNames: ["Bash"],
        }}
      />,
    );

    expect(html).toContain('aria-label="1 messages waiting"');
    expect(html).toContain('aria-label="Change message 1"');
    expect(html).toContain("Send it");
    expect(html).toContain("1 pending while Bash runs");
    expect(defaultQueueDockLabels.title(3)).toBe("3 queued");
  });
});
