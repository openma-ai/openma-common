// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentChatView } from "../src/chat-ui/components.js";
import type { AgentUITurnState } from "../src/agent-ui/index.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const originalScrollTo = HTMLElement.prototype.scrollTo;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-index") ? 240 : 600;
  });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
    const list = this.querySelector<HTMLElement>("[data-virtual-transcript]");
    return list ? Number.parseFloat(list.style.height) : 600;
  });
  HTMLElement.prototype.scrollTo = function (options) {
    const top = typeof options === "object" ? options.top ?? 0 : options ?? 0;
    if (this.scrollTop === top) return;
    this.scrollTop = top;
    this.dispatchEvent(new Event("scroll"));
  };
});
afterEach(() => {
  HTMLElement.prototype.scrollTo = originalScrollTo;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it("mounts the tail window, virtualizes older turns, and preserves reading position during a turn and follows a new turn", async () => {
  const turns: AgentUITurnState[] = Array.from({ length: 200 }, (_, index) => ({
    id: `turn-${index}`, status: "completed", items: [],
  }));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const view = () => <AgentChatView sessionId="history" turns={turns} slots={{ composer: <input aria-label="Composer" /> }} renderTurn={({ turn }) => <div data-turn={turn.id}>{turn.id}</div>} />;
  await act(async () => { root.render(view()); });
  expect(host.querySelector('[data-turn="turn-199"]')).not.toBeNull();
  expect(host.querySelector('[data-turn="turn-0"]')).toBeNull();
  expect(host.querySelectorAll("[data-turn]").length).toBeLessThan(turns.length);
  const scroll = host.querySelector<HTMLElement>(".chat-scrollbar")!;
  await act(async () => { scroll.scrollTo({ top: 0 }); });
  expect(host.querySelector('[data-turn="turn-0"]')).not.toBeNull();
  expect(host.querySelector('[data-turn="turn-199"]')).toBeNull();
  turns[turns.length - 1] = { ...turns[turns.length - 1]!, status: "running" };
  await act(async () => { root.render(view()); });
  expect(scroll.scrollTop).toBe(0);
  expect(host.querySelector('[data-turn="turn-199"]')).toBeNull();
  turns.push({ id: "new-output", status: "running", items: [] });
  await act(async () => { root.render(view()); });
  expect(host.querySelector('[data-turn="new-output"]')).not.toBeNull();
  await act(async () => { root.unmount(); });
});

it("shows only the scrolling transcript's scrollbar and hides it when idle", async () => {
  const turns: AgentUITurnState[] = Array.from({ length: 80 }, (_, index) => ({ id: `t-${index}`, status: "completed", items: [] }));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(<AgentChatView sessionId="scrollbars" turns={turns} slots={{ composer: null }} renderTurn={({ turn }) => <div>{turn.id}</div>} />); });
  const scroll = host.querySelector<HTMLElement>(".chat-scrollbar")!;
  await act(async () => { scroll.scrollTo({ top: 0 }); });
  expect(scroll.dataset.chatScrolling).toBe("true");
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 500)); });
  expect(scroll.dataset.chatScrolling).toBeUndefined();
  await act(async () => { root.unmount(); });
});
