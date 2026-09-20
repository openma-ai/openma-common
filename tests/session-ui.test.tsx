// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as sessionUI from "../src/session-ui/index.js";
import {
  HarnessIcon,
  OpenMAMark,
  SessionRunControls,
  SessionTurnFrame,
} from "../src/session-ui/index.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.useRealTimers();
  document.head.replaceChildren();
  document.body.replaceChildren();
});

describe("SessionTurnFrame", () => {
  it("renders the shared prompt and response shell", () => {
    const html = renderToStaticMarkup(
      <SessionTurnFrame
        turnId="turn-1"
        sessionId="session-1"
        promptText="Inspect this repository"
        status="running"
      >
        <p>Working</p>
      </SessionTurnFrame>,
    );

    expect(html).toContain('data-turn-id="turn-1"');
    expect(html).toContain('data-source-session-id="session-1"');
    expect(html).toContain('data-annotation-ready="false"');
    expect(html).toContain('data-session-turn-prompt="true"');
    expect(html).toContain("Inspect this repository");
    expect(html).toContain("Working");
  });

  it("owns the canonical error and cancellation status treatment", () => {
    const error = renderToStaticMarkup(
      <SessionTurnFrame
        turnId="turn-error"
        status="error"
        errorMessage="Permission denied"
      />,
    );
    const cancelled = renderToStaticMarkup(
      <SessionTurnFrame turnId="turn-cancelled" status="cancelled" />,
    );

    expect(error).toContain('role="alert"');
    expect(error).toContain("Permission denied");
    expect(error).toContain('data-annotation-ready="true"');
    expect(cancelled).toContain("cancelled");
  });

  it("shows an explicit non-streaming state when terminal evidence is missing", () => {
    const unknown = renderToStaticMarkup(
      <SessionTurnFrame turnId="turn-unknown" status="unknown" />,
    );

    expect(unknown).toContain('data-session-turn-status="unknown"');
    expect(unknown).toContain('data-annotation-ready="true"');
    expect(unknown).toContain("terminal status unavailable");
  });
});

describe("shared Backchat run configuration", () => {
  it("ships the shared run-control styling with the shared markup", () => {
    const css = readFileSync(
      resolve(import.meta.dirname, "../src/chat-ui/styles.css"),
      "utf8",
    );

    expect(css).toContain(".openma-session-run-controls");
    expect(css).toContain(".openma-session-toolbar-chip");
    expect(css).toContain(".openma-session-menu-item");
  });

  it("renders the canonical OpenMA and harness icons", () => {
    const html = renderToStaticMarkup(
      <>
        <OpenMAMark />
        <HarnessIcon harnessId="codex-acp" label="Codex" />
        <HarnessIcon harnessId="claude-acp" label="Claude" />
      </>,
    );

    expect(html).toContain('data-openma-mark="true"');
    expect(html).toContain('data-harness-icon="codex-acp"');
    expect(html).toContain('data-harness-icon="claude-acp"');
    expect(html).not.toContain("lucide-bot");
  });

  it("renders harness and grouped live ACP session config options", () => {
    const html = renderToStaticMarkup(
      <SessionRunControls
        activeHarnessId="codex-acp"
        harnesses={[
          { id: "codex-acp", label: "Codex" },
          { id: "gemini", label: "Gemini CLI" },
        ]}
        configOptions={[
          {
            id: "mode",
            name: "Mode",
            category: "mode",
            type: "select",
            currentValue: "agent",
            options: [
              { value: "read-only", name: "Ask for approval" },
              { value: "agent", name: "Agent" },
              { value: "agent-full-access", name: "Full access" },
            ],
          },
          {
            id: "model",
            name: "Model",
            category: "model",
            type: "select",
            currentValue: "gpt-5.6-sol",
            options: [
              { value: "gpt-5.6-sol", name: "GPT-5.6-Sol" },
              { value: "gpt-5.6-terra", name: "GPT-5.6-Terra" },
            ],
          },
          {
            id: "reasoning_effort",
            name: "Reasoning effort",
            category: "thought_level",
            type: "select",
            currentValue: "xhigh",
            options: [{ value: "xhigh", name: "Xhigh" }],
          },
          {
            id: "fast-mode",
            name: "Fast mode",
            category: "model_config",
            type: "boolean",
            currentValue: false,
          },
        ]}
        onSelectHarness={() => undefined}
        onSetConfigOption={() => undefined}
      />,
    );

    expect(html).toContain('aria-label="Harness"');
    expect(html).toContain('data-session-mode-trigger="true"');
    expect(html).toContain('data-session-run-trigger="true"');
    expect(html).toContain("Approve for me");
    expect(html).toContain('aria-label="Fast mode"');
    expect(html).toContain("GPT-5.6-Sol");
    expect(html).toContain("Reasoning effort");
    expect(html).toContain('data-harness-icon="codex-acp"');
    expect(html).toContain('data-session-submenu-trigger="harness"');
    expect(html).toContain('data-session-submenu-trigger="model"');
    expect(html).not.toContain("Gemini CLI");
    expect(html).not.toContain("GPT-5.6-Terra");
    expect(html).not.toContain("<select");
  });

  it("applies menu choices and closes the owning Backchat-style menu", async () => {
    const selectHarness = vi.fn();
    const setConfigOption = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SessionRunControls
          activeHarnessId="codex-acp"
          harnesses={[
            { id: "codex-acp", label: "Codex" },
            { id: "gemini", label: "Gemini CLI" },
          ]}
          configOptions={[{
            id: "mode",
            name: "Mode",
            category: "mode",
            type: "select",
            currentValue: "agent",
            options: [
              { value: "agent", name: "Agent" },
              { value: "agent-full-access", name: "Full access" },
            ],
          }]}
          onSelectHarness={selectHarness}
          onSetConfigOption={setConfigOption}
        />,
      );
    });

    const menus = [...container.querySelectorAll("details")];
    const runTrigger = container.querySelector<HTMLElement>('[data-session-run-trigger="true"]');
    await act(async () => runTrigger?.click());
    const harnessTrigger = container.querySelector<HTMLButtonElement>(
      '[data-session-submenu-trigger="harness"]',
    );
    await act(async () => harnessTrigger?.click());
    const harnessChoice = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Gemini CLI"));
    await act(async () => harnessChoice?.click());
    expect(selectHarness).toHaveBeenCalledWith("gemini");
    expect(menus[1]?.hasAttribute("open")).toBe(false);

    await act(async () => runTrigger?.click());
    const modeTrigger = container.querySelector<HTMLButtonElement>(
      '[data-session-submenu-trigger="mode"]',
    );
    await act(async () => modeTrigger?.click());
    const fullAccessChoice = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Full access"));
    await act(async () => fullAccessChoice?.click());
    expect(setConfigOption).toHaveBeenCalledWith("mode", "agent-full-access");
    expect(menus[0]?.hasAttribute("open")).toBe(false);

    act(() => root.unmount());
  });

  it("contains menu copy and rejects Obsidian's native button skin", () => {
    const host = document.createElement("style");
    host.textContent = `
      button:not(.clickable-icon) {
        background-color: rgb(230, 230, 230);
        border: 2px solid red;
        box-shadow: 0 0 0 4px blue;
        padding: 12px;
        height: 32px;
        font-size: 16px;
        text-align: center;
      }
    `;
    const shared = document.createElement("style");
    shared.textContent = readFileSync(
      resolve(import.meta.dirname, "../src/chat-ui/styles.css"),
      "utf8",
    );
    document.head.append(host, shared);

    const menu = document.createElement("div");
    menu.className = "openma-session-menu";
    const item = document.createElement("button");
    item.className = "openma-session-menu-item";
    const copy = document.createElement("span");
    copy.className = "openma-session-menu-item-copy";
    const description = document.createElement("small");
    description.textContent = "Allow unrestricted internet and filesystem access";
    copy.append(description);
    item.append(copy);
    menu.append(item);
    document.body.append(menu);

    const itemStyle = getComputedStyle(item);
    const menuStyle = getComputedStyle(menu);
    const descriptionStyle = getComputedStyle(description);
    expect(itemStyle.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(itemStyle.borderTopWidth).toBe("0px");
    expect(itemStyle.boxShadow).toBe("none");
    expect(itemStyle.paddingTop).toBe("6px");
    expect(itemStyle.paddingRight).toBe("8px");
    expect(itemStyle.height).toBe("auto");
    expect(itemStyle.fontSize).toBe("12px");
    expect(itemStyle.textAlign).toBe("left");
    expect(menuStyle.overflowX).toBe("hidden");
    expect(descriptionStyle.overflowWrap).toBe("anywhere");
  });

  it("keeps shared control and menu icons at their intended sizes", () => {
    const shared = document.createElement("style");
    shared.textContent = readFileSync(
      resolve(import.meta.dirname, "../src/chat-ui/styles.css"),
      "utf8",
    );
    const host = document.createElement("style");
    host.textContent = "svg { width: 24px; height: 24px; }";
    document.head.append(shared, host);

    const chip = document.createElement("summary");
    chip.className = "openma-session-toolbar-chip";
    const chipIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    chip.append(chipIcon);
    const item = document.createElement("button");
    item.className = "openma-session-menu-item";
    const itemIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    item.append(itemIcon);
    document.body.append(chip, item);

    expect(getComputedStyle(chipIcon).width).toBe("14px");
    expect(getComputedStyle(chipIcon).height).toBe("14px");
    expect(getComputedStyle(itemIcon).width).toBe("14px");
    expect(getComputedStyle(itemIcon).height).toBe("14px");
  });

  it("keeps the right run selector aligned to the compact control baseline", () => {
    const shared = document.createElement("style");
    shared.textContent = readFileSync(
      resolve(import.meta.dirname, "../src/chat-ui/styles.css"),
      "utf8",
    );
    const host = document.createElement("style");
    host.textContent = "summary { height: 32px; padding: 12px; line-height: 2; }";
    document.head.append(shared, host);

    const runSelector = document.createElement("summary");
    runSelector.className = "openma-session-toolbar-chip openma-session-run-trigger";
    runSelector.style.setProperty("--chat-control-height-compact", "28px");
    document.body.append(runSelector);

    const computed = getComputedStyle(runSelector);
    expect(computed.height).toBe("28px");
    expect(computed.paddingTop).toBe("0px");
    expect(computed.paddingRight).toBe("6px");
    expect(computed.lineHeight).toBe("14px");
  });
});

describe("shared Backchat session history", () => {
  function sessionHistoryMenu() {
    return (
      sessionUI as typeof sessionUI & {
        SessionHistoryMenu?: React.ComponentType<{
          activeSessionId: string;
          sessions: ReadonlyArray<{ id: string; title: string }>;
          onSelectSession: (sessionId: string) => void;
        }>;
      }
    ).SessionHistoryMenu;
  }

  it("renders an application-owned session menu instead of a native select", () => {
    const HistoryMenu = sessionHistoryMenu();
    expect(HistoryMenu).toBeTypeOf("function");
    if (!HistoryMenu) return;

    const html = renderToStaticMarkup(
      <HistoryMenu
        activeSessionId="session-1"
        sessions={[
          { id: "session-1", title: "Current chat" },
          { id: "session-2", title: "Second chat" },
        ]}
        onSelectSession={() => undefined}
      />,
    );

    expect(html).toContain('data-session-history-trigger="true"');
    expect(html).toContain('aria-label="Chat history"');
    expect(html).toContain('role="menu"');
    expect(html).toContain('role="menuitemradio"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("Current chat");
    expect(html).toContain("Second chat");
    expect(html).not.toContain("<select");
  });

  it("selects a session and closes its menu", async () => {
    const HistoryMenu = sessionHistoryMenu();
    expect(HistoryMenu).toBeTypeOf("function");
    if (!HistoryMenu) return;
    const selectSession = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <HistoryMenu
          activeSessionId="session-1"
          sessions={[
            { id: "session-1", title: "Current chat" },
            { id: "session-2", title: "Second chat" },
          ]}
          onSelectSession={selectSession}
        />,
      );
    });

    const menu = container.querySelector("details");
    menu?.setAttribute("open", "");
    const second = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Second chat"));
    await act(async () => second?.click());

    expect(selectSession).toHaveBeenCalledWith("session-2");
    expect(menu?.hasAttribute("open")).toBe(false);
    act(() => root.unmount());
  });

  it("dismisses the multilevel run menu on Escape and outside pointer input", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <SessionRunControls
          activeHarnessId="codex-acp"
          harnesses={[{ id: "codex-acp", label: "Codex" }]}
          configOptions={[{
            id: "model",
            name: "Model",
            category: "model",
            type: "select",
            currentValue: "sol",
            options: [{ value: "sol", name: "GPT-5.6-Sol" }],
          }]}
          onSelectHarness={() => undefined}
          onSetConfigOption={() => undefined}
        />,
      );
    });

    const details = container.querySelector("details");
    const trigger = container.querySelector<HTMLElement>('[data-session-run-trigger="true"]');
    await act(async () => trigger?.click());
    expect(details?.hasAttribute("open")).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(details?.hasAttribute("open")).toBe(false);

    await act(async () => trigger?.click());
    document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(details?.hasAttribute("open")).toBe(false);
    act(() => root.unmount());
  });
});

describe("SessionTurnFooter", () => {
  const labels = {
    copyAnswer: "Copy answer",
    answerCopied: "Copied",
    continueInNewChat: "Continue in new chat",
  };

  function footerComponent() {
    return (
      sessionUI as typeof sessionUI & {
        SessionTurnFooter?: React.ComponentType<{
          status: "running" | "completed";
          timestamp?: string;
          copyText: string;
          labels: typeof labels;
          onFork?: () => void;
          writeClipboard?: (text: string) => void | Promise<void>;
          formatTimestamp?: (timestamp: string) => React.ReactNode;
        }>;
      }
    ).SessionTurnFooter;
  }

  it("shows the completed turn time, answer copy, and eligible fork in one stable row", () => {
    const Footer = footerComponent();
    expect(Footer).toBeTypeOf("function");
    if (!Footer) return;

    const html = renderToStaticMarkup(
      <Footer
        status="completed"
        timestamp="2026-08-30T00:19:00.000Z"
        copyText="Final answer"
        labels={labels}
        onFork={() => undefined}
        formatTimestamp={() => "00:19"}
      />,
    );

    expect(html).toContain('data-turn-footer="true"');
    expect(html).toContain('data-turn-timestamp="2026-08-30T00:19:00.000Z"');
    expect(html).toContain(">00:19</time>");
    expect(html).toContain('data-turn-copy-action="true"');
    expect(html).toContain('aria-label="Copy answer"');
    expect(html).toContain('data-turn-fork-action="true"');
    expect(html).toContain('aria-label="Continue in new chat"');
    expect(html).toContain("grid h-7 grid-cols-1 grid-rows-1");
  });

  it("keeps completed actions hidden while the turn is still running", () => {
    const Footer = footerComponent();
    expect(Footer).toBeTypeOf("function");
    if (!Footer) return;

    const html = renderToStaticMarkup(
      <Footer
        status="running"
        timestamp="2026-08-30T00:19:00.000Z"
        copyText="Partial answer"
        labels={labels}
        onFork={() => undefined}
        formatTimestamp={() => "00:19"}
      />,
    );

    expect(html).not.toContain("data-turn-timestamp");
    expect(html).not.toContain("data-turn-fork-action");
    expect(html).toContain("pointer-events-none opacity-0");
  });

  it("copies only the answer text and acknowledges success", async () => {
    vi.useFakeTimers();
    const Footer = footerComponent();
    expect(Footer).toBeTypeOf("function");
    if (!Footer) return;
    const writeClipboard = vi.fn(async () => undefined);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <Footer
          status="completed"
          copyText="  Final answer  "
          labels={labels}
          writeClipboard={writeClipboard}
        />,
      );
    });

    const copy = container.querySelector<HTMLButtonElement>(
      '[data-turn-copy-action="true"]',
    );
    expect(copy).not.toBeNull();
    await act(async () => copy?.click());

    expect(writeClipboard).toHaveBeenCalledWith("Final answer");
    expect(copy?.getAttribute("aria-label")).toBe("Copied");

    act(() => root.unmount());
  });
});
