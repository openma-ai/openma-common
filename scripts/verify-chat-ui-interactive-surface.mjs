/**
 * Playwright regression for chat-interactive-surface states.
 * Run: node scripts/verify-chat-ui-interactive-surface.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const outDir =
  process.env.ARTIFACT_DIR ??
  join(repoRoot, "artifacts", "chat-interactive-surface");

const commonCss = readFileSync(
  join(repoRoot, "src/chat-ui/styles.css"),
  "utf8",
);

const HOST_RESET = `
button, summary {
  appearance: auto;
  padding: 10px 16px;
  border: 2px solid #999;
  background: #f3f3f3;
  box-shadow: 0 0 0 2px #ccc;
  font: 16px/1.5 system-ui, sans-serif;
}
button:focus, summary:focus {
  outline: 3px solid #f90;
  background: #fff8dc;
}
`;

const FIXTURES = [
  {
    id: "activity-group",
    target: '[data-chat-activity-disclosure-trigger="true"]',
    html: `
<button type="button" aria-expanded="false"
  data-chat-activity-disclosure-trigger="true"
  class="chat-interactive-surface chat-interactive-surface--transcript activity-disclosure-row min-h-6 text-[13px]">
  <span class="chat-transcript-disclosure-summary min-w-0 flex-1 truncate text-fg-muted">已执行 1 项操作</span>
  <span class="activity-disclosure-chevron">›</span>
</button>`,
  },
  {
    id: "process-row",
    target: '[data-chat-reasoning-trigger="true"]',
    html: `
<button type="button" aria-expanded="false" data-chat-reasoning-trigger="true"
  class="chat-interactive-surface chat-interactive-surface--transcript chat-reasoning-trigger activity-disclosure-row flex w-full items-center gap-2 text-sm">
  <span class="chat-transcript-disclosure-summary min-w-0 flex-1 truncate text-left text-fg-muted">已工作 4 秒</span>
  <span class="activity-disclosure-chevron">›</span>
</button>`,
  },
  {
    id: "menu-item",
    target: "button.openma-session-menu-item",
    html: `
<div class="openma-session-menu" style="position:relative;display:flex">
  <button type="button" class="chat-interactive-surface chat-interactive-surface--control openma-session-menu-item openma-session-menu-item">
    <span class="openma-session-menu-item-copy"><strong>Resume session</strong></span>
  </button>
</div>`,
  },
  {
    id: "toolbar-chip",
    target: "summary.openma-session-toolbar-chip",
    html: `
<details class="openma-session-chip-menu" id="chip-menu">
  <summary class="chat-interactive-surface chat-interactive-surface--control openma-session-toolbar-chip openma-session-toolbar-chip">
    <span class="openma-session-chip-label">Codex · main</span>
  </summary>
</details>`,
    openSelector: "#chip-menu",
  },
];

function shell(bodyHtml) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" />
<style>
:root {
  --fg: #111;
  --fg-muted: #898885;
  --chat-fg: #111;
  --chat-fg-muted: var(--fg-muted);
  --chat-control-bg-hover: color-mix(in srgb, #111 8%, transparent);
  --interaction-bg-hover: color-mix(in srgb, #111 8%, transparent);
}
${HOST_RESET}${commonCss}</style></head>
<body style="margin:24px;font-family:system-ui,sans-serif;background:#fff">
<div data-parity-panel="true" style="max-width:420px">${bodyHtml}</div>
<div data-hover-reset="true" style="width:1px;height:1px;margin-top:40px"></div>
</body></html>`;
}

function readSurfaceComputed(page, selector) {
  return page.$eval(selector, (el) => {
    const c = getComputedStyle(el);
    return {
      backgroundColor: c.backgroundColor,
      color: c.color,
      paddingLeft: c.paddingLeft,
      borderTopWidth: c.borderTopWidth,
      outlineWidth: c.outlineWidth,
      outlineStyle: c.outlineStyle,
      boxShadow: c.boxShadow,
    };
  });
}

function isTransparentBg(color) {
  return (
    color === "transparent" ||
    color === "rgba(0, 0, 0, 0)" ||
    color.endsWith(", 0)") ||
    color.endsWith(",0)")
  );
}

mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize({ width: 900, height: 640 });

const report = { rows: [], failures: [], alignment: null };
const idleColors = new Map();
const idleSummaryTextColors = new Map();

async function readSummaryTextColor(page, buttonSelector) {
  return page.$eval(buttonSelector, (btn) => {
    const summary = btn.querySelector(
      ".chat-transcript-disclosure-summary, .text-fg-muted, .turn-muted",
    );
    if (!(summary instanceof HTMLElement)) return null;
    return getComputedStyle(summary).color;
  });
}

for (const fixture of FIXTURES) {
  for (const state of [
    "idle",
    "hover",
    "open",
    "focus-mouse",
    "focus-keyboard",
  ]) {
    await page.setContent(shell(fixture.html), { waitUntil: "load" });
    const locator = page.locator(fixture.target).first();
    await locator.waitFor({ state: "visible" });

    await page.locator("[data-hover-reset=true]").hover({ force: true });

    if (fixture.openSelector && state === "open") {
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el instanceof HTMLDetailsElement) el.open = true;
      }, fixture.openSelector);
    } else if (fixture.openSelector) {
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el instanceof HTMLDetailsElement) el.open = false;
      }, fixture.openSelector);
    } else if (state === "open") {
      await locator.evaluate((el) => {
        el.setAttribute("aria-expanded", "true");
      });
    }

    if (state === "hover") {
      await locator.hover({ force: true });
    } else if (state === "focus-mouse") {
      await locator.click();
      await page.locator("[data-hover-reset=true]").hover({ force: true });
    } else if (state === "focus-keyboard") {
      await locator.evaluate((el) => {
        if (el instanceof HTMLElement) {
          el.focus({ focusVisible: true });
        }
      });
    } else if (state !== "open") {
      await page.locator("[data-hover-reset=true]").hover({ force: true });
    }

    await page.waitForTimeout(120);

    const transcriptFixture =
      fixture.id === "activity-group" ||
      fixture.id === "process-row" ||
      fixture.id === "activity-tool-row";

    const computed = await readSurfaceComputed(page, fixture.target);
    const key = `${fixture.id}/${state}`;
    if (state === "idle") {
      idleColors.set(fixture.id, computed.color);
      if (transcriptFixture) {
        idleSummaryTextColors.set(
          fixture.id,
          await readSummaryTextColor(page, fixture.target),
        );
      }
    }
    const shotPath = join(outDir, `${key}.png`);
    await page.locator("[data-parity-panel=true]").screenshot({
      path: shotPath,
      scale: "device",
    });

    const expectPlain =
      state === "idle" ||
      state === "open" ||
      state === "focus-mouse";
    const plainOk =
      !expectPlain ||
      (computed.borderTopWidth === "0px" &&
        computed.boxShadow === "none" &&
        isTransparentBg(computed.backgroundColor) &&
        (computed.outlineWidth === "0px" || computed.outlineStyle === "none"));

    const expectHoverColor = state === "hover" && transcriptFixture;
    const idleColor = idleColors.get(fixture.id);
    const idleSummaryColor = idleSummaryTextColors.get(fixture.id);
    let summaryTextColor = null;
    if (transcriptFixture) {
      summaryTextColor = await readSummaryTextColor(page, fixture.target);
    }
    const hoverColorOk =
      !expectHoverColor ||
      (isTransparentBg(computed.backgroundColor) &&
        idleColor !== undefined &&
        computed.color !== idleColor &&
        idleSummaryColor !== null &&
        summaryTextColor !== null &&
        summaryTextColor !== idleSummaryColor);

    const expectHoverControlBg = state === "hover" && !transcriptFixture;
    const hoverControlOk =
      !expectHoverControlBg || !isTransparentBg(computed.backgroundColor);

    const hoverOk = hoverColorOk && hoverControlOk;

    const expectFocusRing = state === "focus-keyboard";
    const focusOk =
      !expectFocusRing ||
      (computed.outlineWidth !== "0px" && computed.outlineStyle !== "none");

    const pass = plainOk && hoverOk && focusOk;
    const row = {
      key,
      computed,
      summaryTextColor,
      pass,
      plainOk,
      hoverOk,
      hoverColorOk,
      hoverControlOk,
      focusOk,
      shotPath,
    };
    report.rows.push(row);
    if (!pass) report.failures.push(row);
  }
}

await browser.close();

const alignmentBrowser = await chromium.launch();
const alignmentPage = await alignmentBrowser.newPage();
await alignmentPage.setViewportSize({ width: 900, height: 640 });
const turnShell = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" />
<style>
:root {
  --fg: #242424;
  --fg-muted: #898885;
  --chat-fg: var(--fg);
  --chat-fg-muted: var(--fg-muted);
}
.text-fg-muted { color: var(--fg-muted); }
${HOST_RESET}${commonCss}
</style></head>
<body style="margin:24px;font-family:system-ui,sans-serif;background:#fff">
<div data-turn-panel="true" style="max-width:420px;font-size:14px;line-height:1.6">
  <p data-assistant-body="true">这是一条助手回复，用于给进程行提供上下文。</p>
  <button type="button" data-chat-reasoning-trigger="true" data-chat-turn-disclosure-trigger="true"
    class="chat-interactive-surface chat-interactive-surface--transcript chat-reasoning-trigger activity-disclosure-row flex w-full items-center gap-2 text-sm">
    <span class="min-w-0 flex-1 truncate text-left text-fg-muted">已工作 1 秒</span>
    <span class="activity-disclosure-chevron">›</span>
  </button>
  <button type="button" data-chat-activity-disclosure-trigger="true" data-chat-turn-disclosure-trigger="true" tabindex="0"
    class="chat-interactive-surface chat-interactive-surface--transcript activity-disclosure-row min-h-6 text-[13px]">
    <span class="chat-activity-icon text-fg-muted">▤</span>
    <span class="min-w-0 flex-1 truncate text-fg-muted">运行一些命令</span>
    <span class="activity-disclosure-chevron">›</span>
  </button>
</div></body></html>`;
await alignmentPage.setContent(turnShell, { waitUntil: "load" });
report.alignment = await alignmentPage.evaluate(() => {
  const body = document.querySelector("[data-assistant-body=true]");
  const processText = document.querySelector(
    "[data-chat-reasoning-trigger=true] span.text-fg-muted",
  );
  const toolIcon = document.querySelector(
    '[data-chat-activity-disclosure-trigger="true"] .chat-activity-icon',
  );
  const processBtn = document.querySelector("[data-chat-reasoning-trigger=true]");
  const toolBtn = document.querySelector(
    '[data-chat-activity-disclosure-trigger="true"]',
  );
  const rect = (el) => (el ? el.getBoundingClientRect().left : null);
  const pad = (el) => (el ? getComputedStyle(el).paddingLeft : null);
  return {
    bodyLeft: rect(body),
    processTextLeft: rect(processText),
    toolIconLeft: rect(toolIcon),
    processPaddingLeft: pad(processBtn),
    toolPaddingLeft: pad(toolBtn),
    processDelta: Math.abs(rect(processText) - rect(body)),
    toolIconDelta: Math.abs(rect(toolIcon) - rect(body)),
  };
});
if (
  report.alignment.processDelta > 1 ||
  report.alignment.toolIconDelta > 1 ||
  report.alignment.processPaddingLeft !== "0px" ||
  report.alignment.toolPaddingLeft !== "0px"
) {
  report.failures.push({ key: "turn-alignment", ...report.alignment });
}
await alignmentBrowser.close();

const tabBrowser = await chromium.launch();
const tabPage = await tabBrowser.newPage();
await tabPage.setViewportSize({ width: 900, height: 640 });
await tabPage.setContent(turnShell, { waitUntil: "load" });
const tabShot = join(outDir, "turn-keyboard-tab-order.png");
await tabPage.keyboard.press("Tab");
await tabPage.keyboard.press("Tab");
const focusedSelector = await tabPage.evaluate(() => {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return null;
  return el.matches("[data-chat-activity-disclosure-trigger=true]")
    ? "activity"
    : el.matches("[data-chat-reasoning-trigger=true]")
      ? "process"
      : el.tagName;
});
await tabPage.locator("[data-turn-panel=true]").screenshot({
  path: tabShot,
  scale: "device",
});
report.tabFocus = { focusedSelector, tabShot };
if (focusedSelector !== "activity") {
  report.failures.push({ key: "turn-tab-order", focusedSelector });
}
await tabBrowser.close();

writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ total: report.rows.length, failed: report.failures.length }, null, 2));
if (report.failures.length > 0) {
  console.error(report.failures.map((f) => f.key).join(", "));
  process.exit(1);
}
