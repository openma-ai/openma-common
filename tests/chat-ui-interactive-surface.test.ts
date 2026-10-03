import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const stylesPath = resolve(import.meta.dirname, "../src/chat-ui/styles.css");
const componentsPath = resolve(
  import.meta.dirname,
  "../src/chat-ui/components.tsx",
);
const sessionUiPath = resolve(import.meta.dirname, "../src/session-ui/index.tsx");

describe("chat UI interactive surface contract", () => {
  const css = readFileSync(stylesPath, "utf8");
  const components = readFileSync(componentsPath, "utf8");
  const sessionUi = readFileSync(sessionUiPath, "utf8");

  it("defines shared interactive tokens and surface classes", () => {
    for (const token of [
      "--chat-interactive-hover-bg",
      "--chat-interactive-selected-bg",
      "--chat-interactive-control-hover-bg",
      "--chat-interactive-focus-ring-color",
    ]) {
      expect(css).toContain(token);
    }
    for (const selector of [
      ".chat-interactive-surface",
      ".chat-interactive-surface--transcript",
      ".chat-interactive-surface--control",
      ".chat-interactive-surface--chip",
    ]) {
      expect(css).toContain(selector);
    }
    expect(css).toContain(":focus:not(:focus-visible)");
    expect(css).toContain(":focus-visible");
    expect(css).toContain('aria-expanded="true"]');
    expect(css).toContain(":not(:focus-visible)");
  });

  it("does not use bare :focus selectors in chat-ui styles", () => {
    const lines = css.split("\n");
    const offenders = lines.filter((line) => {
      const trimmed = line.trim();
      if (!trimmed.includes(":focus")) return false;
      if (trimmed.includes(":focus-visible")) return false;
      if (trimmed.includes(":focus:not(:focus-visible)")) return false;
      if (trimmed.includes(":focus-within")) return false;
      return true;
    });
    expect(offenders).toEqual([]);
  });

  it("requires chat-interactive-surface on transcript disclosure triggers", () => {
    expect(components).toContain("data-chat-activity-disclosure-trigger");
    expect(components).toContain("data-chat-turn-disclosure-trigger");
    expect(components).toContain("chat-transcript-disclosure-summary");
    expect(css).toContain(".chat-transcript-disclosure-summary");
    expect(css).toContain(":is(");
    expect(css).toContain(".turn-muted");
    expect(components).toContain(
      "chat-interactive-surface chat-interactive-surface--transcript",
    );
    expect(components).toContain("chat-interactive-surface--chip");
  });

  it("requires chat-interactive-surface on session menu and chip controls", () => {
    expect(sessionUi).toContain(
      "chat-interactive-surface chat-interactive-surface--control openma-session-history-trigger",
    );
    expect(sessionUi).toContain(
      "chat-interactive-surface chat-interactive-surface--control openma-session-menu-item",
    );
    expect(sessionUi).toContain(
      "chat-interactive-surface chat-interactive-surface--control openma-session-toolbar-chip",
    );
  });
});
