// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { AgentUITurnView } from "../src/chat-ui/components.js";
import type {
  AgentUIMessageItem,
  AgentUIToolItem,
  AgentUITurnState,
} from "../src/agent-ui/index.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const tool: AgentUIToolItem = {
  id: "tool-1",
  kind: "tool",
  toolKind: "execute",
  title: "Command one",
  status: "completed",
  outputs: [],
};
const commentary: AgentUIMessageItem = {
  id: "note",
  kind: "message",
  role: "assistant",
  text: "Process note",
  phase: "commentary",
  status: "complete",
};
const answer: AgentUIMessageItem = {
  id: "answer",
  kind: "message",
  role: "assistant",
  text: "Final answer",
  phase: "final_answer",
  status: "complete",
};

function view(status: AgentUITurnState["status"]) {
  return (
    <AgentUITurnView
      sessionId="session-settle"
      turn={{ id: "turn-settle", status, items: [commentary, tool, answer] }}
      thoughts="history"
      labels={{
        workingFor: () => "Working",
        workedFor: () => "Worked",
        thinking: "Thinking",
        toolRunSummary: () => "Ran commands",
        toolActivity: (item) => item.title ?? "Tool",
      }}
      slots={{
        renderAssistant: ({ item, prefixSkip }) => (
          <p data-assistant-item={item.id} data-prefix-skip={prefixSkip}>{item.text}</p>
        ),
        renderTool: ({ tool: item }) => <p data-tool-item={item.id}>{item.title}</p>,
        renderFooter: () => <span data-footer="true">footer</span>,
      }}
    />
  );
}

describe("AgentUITurnView settle lifecycle", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("keeps the process as the reader saw it and fills the reserved footer slot on settle", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const slot = () => container.querySelector<HTMLElement>(".chat-turn-footer-slot");
    const processBody = () =>
      container.querySelector<HTMLElement>('[data-session-process-activity="true"]');

    await act(async () => root.render(view("running")));
    expect(slot()?.dataset.sessionTurnFooterSlot).toBe("reserved");
    expect(slot()?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector("[data-footer]")).toBeNull();
    expect(processBody()?.hidden).toBe(false);
    // The process note starts at 0; the answer skips the note's text.
    expect(container.querySelector('[data-assistant-item="note"]')?.getAttribute("data-prefix-skip")).toBe("0");
    expect(container.querySelector('[data-assistant-item="answer"]')?.getAttribute("data-prefix-skip"))
      .toBe(String(commentary.text.length));

    await act(async () => root.render(view("completed")));
    expect(slot()?.dataset.sessionTurnFooterSlot).toBe("entering");
    expect(slot()?.hasAttribute("aria-hidden")).toBe(false);
    expect(container.querySelector("[data-footer]")).not.toBeNull();
    // Settling does not collapse what the reader was looking at.
    expect(processBody()?.hidden).toBe(false);

    // Closing keeps the body mounted but inert, so nested state survives.
    const trigger = container.querySelector<HTMLButtonElement>('[data-slot="collapsible-trigger"], button[aria-expanded]')!;
    await act(async () => trigger.click());
    expect(processBody()?.hidden).toBe(true);
    expect(processBody()?.hasAttribute("inert")).toBe(true);

    // A follow-up run on the same turn reopens the process.
    await act(async () => root.render(view("running")));
    expect(processBody()?.hidden).toBe(false);

    act(() => root.unmount());
  });

  it("renders a history turn's footer at rest and mounts its process on first open", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => root.render(view("completed")));
    const slot = container.querySelector<HTMLElement>(".chat-turn-footer-slot");
    expect(slot?.dataset.sessionTurnFooterSlot).toBe("settled");
    expect(container.querySelector('[data-session-process-activity="true"]')).toBeNull();

    const trigger = container.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
    await act(async () => trigger.click());
    expect(container.querySelector('[data-session-process-activity="true"]')).not.toBeNull();

    act(() => root.unmount());
  });
});
