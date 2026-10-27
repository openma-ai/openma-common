import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  COMPOSER_BODY_CLASS,
  COMPOSER_SHELL_CLASS,
  COMPOSER_TOOLBAR_CLASS,
  COMPOSER_TOOLBAR_END_CLASS,
  COMPOSER_TOOLBAR_START_CLASS,
  COMPOSER_TOOLBAR_START_CLIP_CLASS,
  ComposerShell,
  ComposerToolbar,
} from "../src/chat-ui/composer-shell.js";

describe("ComposerShell", () => {
  it("owns body + start|end toolbar topology", () => {
    const html = renderToStaticMarkup(
      <ComposerShell
        slots={{
          body: <textarea aria-label="draft">hello</textarea>,
          toolbarStart: <button type="button">attach</button>,
          toolbarEnd: (
            <>
              <span data-agent-picker="">Dsh Acp</span>
              <button type="button">send</button>
            </>
          ),
        }}
      />,
    );

    expect(html).toContain(`class="${COMPOSER_SHELL_CLASS}"`);
    expect(html).toContain(`class="${COMPOSER_BODY_CLASS}"`);
    expect(html).toContain(`class="${COMPOSER_TOOLBAR_CLASS}"`);
    expect(html).toContain(COMPOSER_TOOLBAR_START_CLASS);
    expect(html).toContain(COMPOSER_TOOLBAR_END_CLASS);
    expect(html).toContain('data-openma-composer-shell=""');
    expect(html).toContain('data-openma-composer-body=""');
    expect(html).toContain('data-openma-composer-toolbar=""');
    expect(html).toContain('data-openma-composer-toolbar-start=""');
    expect(html).toContain('data-openma-composer-toolbar-end=""');
    expect(html).toContain('data-composer-run-actions="true"');
    expect(html).toContain("hello");
    expect(html).toContain("attach");
    expect(html).toContain('data-agent-picker=""');
    expect(html).toContain("send");
  });

  it("renders host slots without inventing product widgets", () => {
    const html = renderToStaticMarkup(
      <ComposerShell
        slots={{
          toolbarStart: <span data-host-chip="">perm</span>,
          toolbarEnd: <span data-host-mic="">mic</span>,
        }}
      />,
    );

    expect(html).toContain('data-host-chip=""');
    expect(html).toContain('data-host-mic=""');
    expect(html).not.toContain("aria-label");
    expect(html).not.toContain("<textarea");
  });

  it("applies density attrs when density is set", () => {
    const comfortable = renderToStaticMarkup(
      <ComposerShell density="comfortable" slots={{ body: <p>a</p> }} />,
    );
    expect(comfortable).toContain('data-chat-density="comfortable"');
    expect(comfortable).not.toContain("--composer-card-padding-block");

    const compact = renderToStaticMarkup(
      <ComposerShell density="compact" slots={{ body: <p>b</p> }} />,
    );
    expect(compact).toContain('data-chat-density="compact"');
    expect(compact).toContain("--composer-card-padding-block:8px");
    expect(compact).toContain("--composer-section-gap:4px");
    expect(compact).toContain("--composer-body-min-height:48px");
  });

  it("clips the start cluster by default and can opt out", () => {
    const clipped = renderToStaticMarkup(
      <ComposerToolbar start={<span>s</span>} end={<span>e</span>} />,
    );
    expect(clipped).toContain(COMPOSER_TOOLBAR_START_CLIP_CLASS);

    const open = renderToStaticMarkup(
      <ComposerToolbar
        clipStart={false}
        start={<span>s</span>}
        end={<span>e</span>}
      />,
    );
    expect(open).not.toContain(COMPOSER_TOOLBAR_START_CLIP_CLASS);
  });

  it("forwards host classNames onto shell regions", () => {
    const html = renderToStaticMarkup(
      <ComposerShell
        className="host-shell"
        bodyClassName="host-body"
        toolbarClassName="host-toolbar"
        toolbarStartClassName="host-start"
        toolbarEndClassName="host-end"
        slots={{
          body: <span>body</span>,
          toolbarStart: <span>start</span>,
          toolbarEnd: <span>end</span>,
        }}
      />,
    );

    expect(html).toContain("host-shell");
    expect(html).toContain("host-body");
    expect(html).toContain("host-toolbar");
    expect(html).toContain("host-start");
    expect(html).toContain("host-end");
  });
});

describe("composer shell style contract", () => {
  it("ships topology selectors and token hooks in styles.css", () => {
    const css = readFileSync(
      resolve(import.meta.dirname, "../src/chat-ui/styles.css"),
      "utf8",
    );

    for (const token of [
      ".openma-composer-shell",
      ".openma-composer-body",
      ".openma-composer-toolbar",
      ".openma-composer-toolbar-start",
      ".openma-composer-toolbar-start--clip",
      ".openma-composer-toolbar-end",
      "--composer-toolbar-gap",
      "--composer-toolbar-start-gap",
      "--composer-toolbar-end-gap",
      "--composer-toolbar-clip-outset",
      "--composer-control-height",
      "--composer-chip-height",
      "--composer-chip-radius",
      "--composer-chip-padding-inline",
    ]) {
      expect(css).toContain(token);
    }
  });
});
