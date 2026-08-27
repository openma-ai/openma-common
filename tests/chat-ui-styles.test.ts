import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("chat UI host style contract", () => {
  it("ships Backchat's structural disclosure and Markdown styles as an explicit asset", () => {
    const css = readFileSync(
      resolve(import.meta.dirname, "../src/chat-ui/styles.css"),
      "utf8",
    );

    for (const selector of [
      ".chat-turn-frame",
      ".chat-composer-frame",
      ".chat-activity-icon",
      ".activity-disclosure-row",
      ".activity-disclosure-chevron",
      ".home-empty-stage",
      ".home-empty-stack",
      ".home-composer-stack",
      ".reasoning-collapse",
      ".reasoning-collapse-inner",
      ".chat-markdown",
      ".streaming-md",
    ]) {
      expect(css).toContain(selector);
    }

    const emptyStack = css.slice(
      css.indexOf(".home-empty-stack {"),
      css.indexOf(".home-composer-stack {"),
    );
    expect(emptyStack).toContain("--home-empty-stack-offset-y");
    expect(emptyStack).toContain(
      "margin-top: var(--home-empty-stack-offset-y)",
    );
    expect(emptyStack).not.toContain("margin-top: -8vh");
  });

  it("exports styles separately so the host chooses when to inject them", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8"),
    ) as { exports?: Record<string, unknown> };

    expect(pkg.exports?.["./chat-ui/styles.css"]).toBe(
      "./dist/chat-ui/styles.css",
    );
  });
});
