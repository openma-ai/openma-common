import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  AgentBrandIcon,
  agentBrandDisplayTitle,
  normalizeAgentBrandId,
} from "../src/chat-ui/agent-brand-icon.js";
import {
  COMPOSER_CHIP_CLASS,
  COMPOSER_TOOLBAR_CHIP_CLASS,
  COMPOSER_ICON_BUTTON_CLASS,
  COMPOSER_RUN_ACTION_CLASS,
  ComposerChip,
  ComposerIconButton,
  ComposerRunAction,
  composerChipClass,
} from "../src/chat-ui/composer-chrome.js";
import {
  DshPresetStandardIcon,
  agentPresetIcon,
} from "../src/chat-ui/dsh-preset-icons.js";
import {
  COMPOSER_SHELL_CLASS,
  ComposerShell,
} from "../src/chat-ui/composer-shell.js";

describe("AgentBrandIcon", () => {
  it("normalizes dsh / deepseek ids onto the DeepSeek brand key", () => {
    expect(normalizeAgentBrandId("dsh-acp")).toBe("dsh-acp");
    expect(normalizeAgentBrandId("DeepSeek Harness")).toBe("dsh-acp");
    expect(normalizeAgentBrandId("custom-dsh-runner")).toBe("dsh-acp");
  });

  it("renders the DeepSeek brand mark for dsh-acp (not a generic robot)", () => {
    const html = renderToStaticMarkup(<AgentBrandIcon agentId="dsh-acp" />);
    expect(html).toContain('data-agent-brand-id="dsh-acp"');
    expect(html).toContain('data-agent-icon-source="brand"');
    expect(html).toContain('aria-label="DeepSeek"');
    expect(html).not.toContain('data-agent-icon-source="generic"');
  });


  it("keeps DeepSeek aria-label even when hosts pass a harness display title", () => {
    const html = renderToStaticMarkup(
      <AgentBrandIcon agentId="dsh-acp" title="Dsh Acp" />,
    );
    expect(html).toContain('aria-label="DeepSeek"');
    expect(agentBrandDisplayTitle("dsh-acp")).toBe("DeepSeek");
  });

  it("keeps Cursor / Claude on brand paths", () => {
    expect(renderToStaticMarkup(<AgentBrandIcon agentId="cursor" />)).toContain(
      'data-agent-brand-id="cursor"',
    );
    expect(
      renderToStaticMarkup(<AgentBrandIcon agentId="claude-acp" />),
    ).toContain('data-agent-brand-id="claude-acp"');
  });
});

describe("composer chrome widgets", () => {
  it("exports stable chip / icon / run class names", () => {
    expect(COMPOSER_CHIP_CLASS).toBe("openma-composer-chip");
    expect(COMPOSER_TOOLBAR_CHIP_CLASS).toBe(COMPOSER_CHIP_CLASS);
    expect(COMPOSER_ICON_BUTTON_CLASS).toBe("openma-composer-icon-button");
    expect(COMPOSER_RUN_ACTION_CLASS).toBe("openma-composer-run-action");
    expect(composerChipClass("host")).toContain("openma-composer-chip");
  });

  it("renders ComposerChip with icon slot + label", () => {
    const html = renderToStaticMarkup(
      <ComposerChip
        icon={<DshPresetStandardIcon className="size-3.5" />}
        label="Standard"
        trailing={<span data-chevron="">v</span>}
        aria-label="Collaboration"
      />,
    );
    expect(html).toContain(COMPOSER_CHIP_CLASS);
    expect(html).toContain('data-openma-composer-chip=""');
    expect(html).toContain('data-control-icon=""');
    expect(html).toContain('data-dsh-preset-icon="standard"');
    expect(html).toContain("Standard");
    expect(html).toContain("openma-composer-chip-label");
    expect(html).toContain('data-openma-composer-chip-label=""');
    expect(html).toContain('data-chevron=""');
  });

  it("renders run action with submit / stop data attrs", () => {
    const send = renderToStaticMarkup(
      <ComposerRunAction aria-label="Send">⏎</ComposerRunAction>,
    );
    expect(send).toContain(COMPOSER_RUN_ACTION_CLASS);
    expect(send).toContain('data-composer-submit="true"');
    expect(send).not.toContain("data-composer-stop");

    const stop = renderToStaticMarkup(
      <ComposerRunAction stopPrimary aria-label="Stop">
        ■
      </ComposerRunAction>,
    );
    expect(stop).toContain('data-composer-stop="true"');
    expect(stop).not.toContain('data-composer-submit="true"');
  });

  it("composes inside ComposerShell toolbar topology", () => {
    const html = renderToStaticMarkup(
      <ComposerShell
        slots={{
          toolbarStart: (
            <>
              <ComposerIconButton aria-label="Attach">+</ComposerIconButton>
              <ComposerChip label="Workspace write" />
              <ComposerChip
                icon={<DshPresetStandardIcon />}
                label="Standard"
              />
            </>
          ),
          toolbarEnd: (
            <>
              <ComposerChip
                icon={<AgentBrandIcon agentId="dsh-acp" />}
                label="High"
              />
              <ComposerRunAction aria-label="Send">⏎</ComposerRunAction>
            </>
          ),
        }}
      />,
    );
    expect(html).toContain(COMPOSER_SHELL_CLASS);
    expect(html).toContain('data-openma-composer-icon-button=""');
    expect(html).toContain("Workspace write");
    expect(html).toContain("Standard");
    expect(html).toContain('data-agent-brand-id="dsh-acp"');
    expect(html).toContain("High");
    expect(html).toContain('data-composer-submit="true"');
  });
});

describe("dsh preset icons", () => {
  it("defaults unknown presets to Standard", () => {
    expect(agentPresetIcon("standard")).toBe(DshPresetStandardIcon);
    expect(agentPresetIcon("Agent")).toBe(DshPresetStandardIcon);
  });
});

describe("composer chrome styles", () => {
  it("ships chip / run-action rules in styles.css", () => {
    const css = readFileSync(
      resolve(import.meta.dirname, "../src/chat-ui/styles.css"),
      "utf8",
    );
    expect(css).toContain(".openma-composer-chip");
    expect(css).toContain(".openma-composer-icon-button");
    expect(css).toContain(".openma-composer-run-action");
    expect(css).toContain("[data-control-icon]");
  });
});
