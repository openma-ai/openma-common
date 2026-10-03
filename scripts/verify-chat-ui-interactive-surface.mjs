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
  <span class="min-w-0 flex-1 truncate">已执行 1 项操作</span>
  <span class="activity-disclosure-chevron">›</span>
</button>`,
  },
  {
    id: "process-row",
    target: '[data-chat-reasoning-trigger="true"]',
    html: `
<button type="button" aria-expanded="false" data-chat-reasoning-trigger="true"
  class="chat-interactive-surface chat-interactive-surface--transcript chat-reasoning-trigger activity-disclosure-row flex w-full items-center gap-2 text-sm">
  <span class="min-w-0 flex-1 truncate text-left">已工作 4 秒</span>
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
  --chat-fg: #111;
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

const report = { rows: [], failures: [] };

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

    const computed = await readSurfaceComputed(page, fixture.target);
    const key = `${fixture.id}/${state}`;
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

    const expectHoverWash = state === "hover";
    const hoverOk =
      !expectHoverWash || !isTransparentBg(computed.backgroundColor);

    const expectFocusRing = state === "focus-keyboard";
    const focusOk =
      !expectFocusRing ||
      (computed.outlineWidth !== "0px" && computed.outlineStyle !== "none");

    const pass = plainOk && hoverOk && focusOk;
    const row = { key, computed, pass, plainOk, hoverOk, focusOk, shotPath };
    report.rows.push(row);
    if (!pass) report.failures.push(row);
  }
}

await browser.close();

writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ total: report.rows.length, failed: report.failures.length }, null, 2));
if (report.failures.length > 0) {
  console.error(report.failures.map((f) => f.key).join(", "));
  process.exit(1);
}
