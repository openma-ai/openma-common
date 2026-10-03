/**
 * Before/after full-turn evidence (v0.7.6 vs current chat-ui CSS).
 * Run: node scripts/capture-activity-disclosure-evidence.mjs
 */
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const outDir =
  process.env.ARTIFACT_DIR ??
  "/opt/cursor/artifacts/activity-disclosure-evidence";

const cssV077 = execSync("git show v0.7.7:src/chat-ui/styles.css", {
  cwd: repoRoot,
  encoding: "utf8",
});
const cssHead = readFileSync(join(repoRoot, "src/chat-ui/styles.css"), "utf8");

mkdirSync(outDir, { recursive: true });

const PANEL = 820;

const HOST_RESET = `
button:not(.clickable-icon), summary {
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

function turnMarkup({ version }) {
  const head = version === "head";
  const reasoningClass = head
    ? "chat-interactive-surface chat-interactive-surface--transcript chat-reasoning-trigger activity-disclosure-row flex w-full items-center gap-2 text-sm"
    : "chat-reasoning-trigger activity-disclosure-row flex w-full items-center gap-2 text-sm";
  const activityClass = head
    ? "chat-interactive-surface chat-interactive-surface--transcript activity-disclosure-row min-h-6 text-[13px]"
    : "activity-disclosure-row min-h-6 text-[13px]";
  const activityAttr = head ? ' data-chat-activity-disclosure-trigger="true"' : "";
  return `
    <button type="button" data-chat-reasoning-trigger="true" aria-expanded="false"
      class="${reasoningClass}" data-turn-reasoning="true">
      <span class="chat-transcript-disclosure-summary min-w-0 flex-1 truncate text-left turn-muted">已工作 4 秒</span>
      <span class="activity-disclosure-chevron" aria-hidden="true">›</span>
    </button>
    <button type="button" aria-expanded="false"${activityAttr}
      class="${activityClass}" data-turn-activity="true">
      <span class="chat-transcript-disclosure-summary min-w-0 flex-1 truncate turn-muted">已执行 1 项操作</span>
      <span class="activity-disclosure-chevron" aria-hidden="true">›</span>
    </button>
    <div class="activity-body" data-activity-body="true" hidden>
      <div class="activity-body-inner">↳ Read README.md</div>
    </div>
    <div class="assistant">README 说明了安装、开发与发布流程。</div>`;
}

function sessionFixtures({ version }) {
  const head = version === "head";
  const control = head
    ? "chat-interactive-surface chat-interactive-surface--control "
    : "";
  return {
    menu: `
<div class="openma-session-menu" style="position:relative;display:flex;flex-direction:column;width:280px" data-session-panel="menu">
  <button type="button" class="${control}openma-session-menu-item openma-session-menu-item">
    <span class="openma-session-menu-item-copy"><strong>恢复会话</strong></span>
  </button>
  <button type="button" class="${control}openma-session-menu-item openma-session-menu-item" aria-checked="true">
    <span class="openma-session-menu-item-copy"><strong>当前工作区</strong></span>
  </button>
</div>`,
    chip: `
<details class="openma-session-chip-menu" id="chip-evidence" open data-session-panel="chip">
  <summary class="${control}openma-session-toolbar-chip openma-session-toolbar-chip">
    <span class="openma-session-chip-label">Codex · main</span>
    <span aria-hidden="true">▾</span>
  </summary>
  <div class="openma-session-menu openma-session-menu-align-start" style="position:relative;display:flex;flex-direction:column;width:200px">
    <button type="button" class="${control}openma-session-menu-item openma-session-menu-item">Fast</button>
  </div>
</details>`,
  };
}

function pageShell({ variant, version, css, bodyInner, panelSelector = "[data-panel=true]" }) {
  const isDark = variant === "dark";
  const canvas = isDark ? "#18181b" : "#f4f4f5";
  const panel = isDark ? "#27272a" : "#ffffff";
  const fg = isDark ? "#fafafa" : "#242424";
  const muted = isDark ? "#a1a1aa" : "#898885";
  const border = isDark ? "#3f3f46" : "#e4e4e7";
  const menuBg = panel;
  return {
    html: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" />
<style>
:root {
  --fg: ${fg}; --chat-fg: ${fg}; --fg-muted: ${muted};
  --border: ${border};
  --chat-border: ${border};
  --bg: ${panel};
  --chat-menu-bg: ${menuBg};
  --chat-activity-row-leading-space: 8px;
  --chat-control-bg-hover: color-mix(in srgb, ${fg} 8%, transparent);
  --interaction-bg-hover: color-mix(in srgb, ${fg} 8%, transparent);
}
body { margin:0; padding:32px; font-family:system-ui,sans-serif; background:${canvas}; color:${fg}; }
.shell { width:${PANEL}px; margin:0 auto; background:${panel}; border-radius:12px; padding:20px 24px; border:1px solid ${isDark ? "#3f3f46" : "#e4e4e7"}; }
.user { display:flex; justify-content:flex-end; margin-bottom:16px; }
.bubble { background:${isDark ? "#3f3f46" : "#18181b"}; color:${isDark ? fg : "#fafafa"}; padding:10px 14px; border-radius:16px 16px 4px 16px; font-size:14px; }
.turn-muted { color: ${muted}; font-size: 13px; }
.assistant { margin-top:12px; font-size:14px; line-height:1.6; }
.activity-body { margin-top:4px; margin-left:8px; font-size:13px; color:${muted}; }
${HOST_RESET}
${css}
</style></head><body>
<div class="shell" data-panel="true">
  <div data-hover-reset="true" style="font-size:12px;color:${muted};margin-bottom:12px">Session · demo · ${version === "head" ? "v0.7.8" : "v0.7.6"}</div>
  ${bodyInner}
</div></body></html>`,
    panelSelector,
  };
}

async function setupHiDpi(page) {
  await page.setViewportSize({ width: 960, height: 720 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 960,
    height: 720,
    deviceScaleFactor: 2,
    mobile: false,
  });
}

async function captureTurnStates(page, { variant, version, css }) {
  const label = version === "head" ? "v078" : "v077";
  const body = `
  <div class="user"><div class="bubble">请读 README 并总结。</div></div>
  <div data-session-turn-response="true">${turnMarkup({ version })}</div>`;
  const { html } = pageShell({ variant, version, css, bodyInner: body });

  const states = [
    {
      name: "idle",
      apply: async () => {
        await page.locator("[data-hover-reset=true]").hover();
      },
    },
    {
      name: "hover",
      apply: async () => {
        await page.locator("[data-turn-activity=true]").hover();
      },
    },
    {
      name: "expanded-mouse-away",
      apply: async () => {
        const btn = page.locator("[data-turn-activity=true]");
        await btn.click();
        await page.evaluate(() => {
          const body = document.querySelector("[data-activity-body=true]");
          const btn = document.querySelector("[data-turn-activity=true]");
          if (body instanceof HTMLElement) body.hidden = false;
          if (btn instanceof HTMLElement) btn.setAttribute("aria-expanded", "true");
        });
        await page.locator("[data-hover-reset=true]").hover();
      },
    },
    {
      name: "focus-visible",
      apply: async () => {
        await page.locator("[data-turn-activity=true]").evaluate((el) => {
          if (el instanceof HTMLElement) el.focus({ focusVisible: true });
        });
      },
    },
  ];

  for (const state of states) {
    await page.setContent(html, { waitUntil: "load" });
    await state.apply();
    await page.waitForTimeout(150);
    const file = join(outDir, `${label}-${variant}-turn-${state.name}.png`);
    await page.locator("[data-panel=true]").screenshot({ path: file, scale: "device" });
    if (
      version === "head" &&
      (state.name === "idle" || state.name === "hover")
    ) {
      const activity = await readTurnSummaryColor(page, "activity");
      const process = await readTurnSummaryColor(page, "process");
      manifest.computedTextColors[`${label}-${variant}-turn-${state.name}`] = {
        activitySummary: activity,
        processSummary: process,
      };
    }
  }
}

async function captureSessionPanels(page, { variant, version, css }) {
  const label = version === "head" ? "v078" : "v077";
  const fixtures = sessionFixtures({ version });

  for (const [kind, inner] of [
    ["session-menu", fixtures.menu],
    ["toolbar-chip-open", fixtures.chip],
  ]) {
    const { html } = pageShell({
      variant,
      version,
      css,
      bodyInner: inner,
    });
    await page.setContent(html, { waitUntil: "load" });
    await page.locator("[data-hover-reset=true]").hover();
    await page.waitForTimeout(120);
    const file = join(outDir, `${label}-${variant}-${kind}.png`);
    await page.locator("[data-panel=true]").screenshot({ path: file, scale: "device" });
  }
}

const manifest = { outDir, files: [], computedTextColors: {} };

async function readTurnSummaryColor(page, which) {
  return page.evaluate((target) => {
    const el = document.querySelector(
      target === "activity"
        ? "[data-turn-activity=true] .chat-transcript-disclosure-summary, [data-turn-activity=true] .turn-muted"
        : "[data-turn-reasoning=true] .chat-transcript-disclosure-summary, [data-turn-reasoning=true] .turn-muted",
    );
    return el ? getComputedStyle(el).color : null;
  }, which);
}

const browser = await chromium.launch();
const page = await browser.newPage();
await setupHiDpi(page);

for (const version of ["v077", "head"]) {
  const css = version === "v077" ? cssV077 : cssHead;
  for (const variant of ["light", "dark"]) {
    await captureTurnStates(page, { variant, version, css });
    await captureSessionPanels(page, { variant, version, css });
  }
}

await browser.close();

const { readdirSync } = await import("node:fs");
manifest.files = readdirSync(outDir).filter((f) => f.endsWith(".png")).sort();
writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
