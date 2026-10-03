/**
 * PR #24 evidence: 8 screenshots with real Playwright hover + bg assertions.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const outDir = "/opt/cursor/artifacts/process-row-evidence";
const TRANSITION_MS = 350;

mkdirSync(outDir, { recursive: true });

const PANEL_WIDTH = 820;
const VIEWPORT_WIDTH = 960;
const VIEWPORT_HEIGHT = 720;

const backchatOverride = `
[data-session-turn-response] .activity-disclosure-row:hover {
  background: transparent;
  color: var(--fg);
}
[data-session-turn-response] .chat-reasoning-trigger {
  width: 100% !important;
  padding: 0 !important;
  padding-inline-start: var(--chat-activity-row-leading-space, 0px) !important;
  border-radius: 0;
  background: transparent !important;
  box-shadow: none !important;
}
[data-session-turn-response] .chat-reasoning-trigger:hover {
  background: color-mix(in srgb, var(--fg) 8%, transparent) !important;
  color: var(--fg);
}
`;

function fixtureHtml({ css, extraCss = "", processState }) {
  const streaming = processState === "running";
  const statusText = streaming ? "工作中 4 秒" : "已工作 4 秒";
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" /><style>
:root {
  --bg-bubble: #e9e9e9; --chat-bg-bubble: var(--bg-bubble);
  --fg: #242424; --fg-muted: #898885; --chat-fg: var(--fg);
  --chat-activity-row-leading-space: 8px;
  --surface-canvas: #f4f4f5; --surface-panel: #ffffff;
}
body { margin: 0; padding: 32px; font-family: system-ui, sans-serif; background: var(--surface-canvas); }
.chat-shell {
  width: ${PANEL_WIDTH}px; margin: 0 auto; background: var(--surface-panel);
  border: 1px solid #e4e4e7; border-radius: 12px; padding: 20px 24px 28px;
}
.chat-heading { font-size: 12px; color: #71717a; margin-bottom: 16px; }
.user-row { display: flex; justify-content: flex-end; margin-bottom: 16px; }
.user-bubble {
  max-width: 70%; padding: 10px 14px; border-radius: 16px 16px 4px 16px;
  background: #18181b; color: #fafafa; font-size: 14px;
}
.tool-row { margin-top: 8px; padding-left: 8px; font-size: 13px; color: var(--fg-muted); }
.assistant-line { margin-top: 12px; font-size: 14px; line-height: 1.6; }
${css}
${extraCss}
</style></head><body>
<div class="chat-shell" data-chat-evidence-panel="true">
  <div class="chat-heading" data-hover-reset="true">Session · demo</div>
  <div class="user-row"><div class="user-bubble">请读 README。</div></div>
  <div data-session-turn-response="true">
    <div data-session-process-state="${processState}">
      <button type="button" data-chat-reasoning-trigger="true"
        class="chat-reasoning-trigger activity-disclosure-row flex w-full items-center gap-2 text-sm">
        <span class="min-w-0 flex-1 truncate text-left" style="color:var(--fg-muted)">${statusText}</span>
        <span aria-hidden="true">›</span>
      </button>
    </div>
    <div class="tool-row">↳ Read README.md</div>
    <div class="assistant-line">${streaming ? "正在整理…" : "README 说明了安装与发布流程。"}</div>
  </div>
</div></body></html>`;
}

async function enableHiDpi(page) {
  await page.setViewportSize({ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: VIEWPORT_WIDTH,
    height: VIEWPORT_HEIGHT,
    deviceScaleFactor: 2,
    mobile: false,
  });
}

async function pointerState(page, trigger, hover) {
  if (hover) {
    await trigger.scrollIntoViewIfNeeded();
    await trigger.hover();
  } else {
    await page.locator("[data-hover-reset=true]").hover();
  }
  await page.waitForTimeout(TRANSITION_MS);
}

async function readBg(trigger) {
  return trigger.evaluate((el) => getComputedStyle(el).backgroundColor);
}

function loadBackchatTurnRailCss() {
  const indexPath =
    process.env.BACKCHAT_INDEX_CSS ??
    "/tmp/backchat/src/renderer/src/styles/index.css";
  const indexCss = readFileSync(indexPath, "utf8");
  const start = indexCss.indexOf("[data-session-turn-response] .activity-disclosure-row {");
  const end = indexCss.indexOf("[data-session-turn-response] [data-thought-stream-body]");
  if (start < 0 || end < 0) {
    throw new Error(`Backchat turn-rail overrides not found in ${indexPath}`);
  }
  return indexCss.slice(start, end);
}

async function captureFixture({
  css,
  extraCss,
  filePrefix,
  assertHoverChanges,
  processStates = ["running", "complete"],
}) {
  const browser = await chromium.launch();
  const rows = {};
  for (const processState of processStates) {
    const idleKey = `${filePrefix}-${processState}-idle`;
    const hoverKey = `${filePrefix}-${processState}-hover`;
    for (const [hover, key] of [
      [false, idleKey],
      [true, hoverKey],
    ]) {
      const page = await browser.newPage();
      await enableHiDpi(page);
      await page.setContent(
        fixtureHtml({ css, extraCss, processState }),
        { waitUntil: "load" },
      );
      const trigger = page.locator("[data-chat-reasoning-trigger=true]");
      await trigger.waitFor({ state: "visible" });
      await pointerState(page, trigger, hover);
      const bg = await readBg(trigger);
      const panel = page.locator("[data-chat-evidence-panel=true]");
      const path = join(outDir, `${key}.png`);
      await panel.screenshot({ path, scale: "device" });
      rows[key] = { path, backgroundColor: bg, hover };
      await page.close();
    }
    const idleBg = rows[idleKey].backgroundColor;
    const hoverBg = rows[hoverKey].backgroundColor;
    if (assertHoverChanges && idleBg === hoverBg) {
      throw new Error(
        `${filePrefix} ${processState}: hover bg unchanged (${idleBg})`,
      );
    }
  }
  await browser.close();
  return rows;
}

async function captureBackchatFixedMainFixture() {
  const rows = await captureFixture({
    css: fixedCss,
    extraCss: loadBackchatTurnRailCss(),
    filePrefix: "backchat-fixed-main",
    assertHoverChanges: true,
    processStates: ["complete"],
  });
  const idlePath = rows["backchat-fixed-main-complete-idle"]?.path;
  const hoverPath = rows["backchat-fixed-main-complete-hover"]?.path;
  if (idlePath && hoverPath) {
    const idleHash = execSync(`md5sum ${JSON.stringify(idlePath)}`, {
      encoding: "utf8",
    }).split(/\s/)[0];
    const hoverHash = execSync(`md5sum ${JSON.stringify(hoverPath)}`, {
      encoding: "utf8",
    }).split(/\s/)[0];
    if (idleHash === hoverHash) {
      throw new Error("backchat-fixed-main complete idle/hover PNGs are identical");
    }
  }
  return rows;
}

const fixedCss = readFileSync(join(repoRoot, "src/chat-ui/styles.css"), "utf8");
const brokenCss = readFileSync(
  "/tmp/openma-common-v0.7.5-chat-ui-styles.css",
  "utf8",
);

const summary = {
  capturedAt: new Date().toISOString(),
  fixtures: {},
};

summary.fixtures.clashCombo = await captureFixture({
  css: fixedCss,
  extraCss: "",
  filePrefix: "common-v0.7.6-clash-style-combo",
  assertHoverChanges: true,
});

summary.fixtures.backchatOverride = await captureFixture({
  css: fixedCss,
  extraCss: backchatOverride,
  filePrefix: "common-v0.7.6-with-backchat-override",
  assertHoverChanges: true,
});

summary.fixtures.clashCurrentComplete = await captureFixture({
  css: brokenCss,
  extraCss: "",
  filePrefix: "clash-current-style-combo",
  assertHoverChanges: false,
});
// Only need complete-hover re-shot from clash; running shots overwritten too — user only lists complete-hover for clash broken. Still capture all 4 for clash in second call - actually user only wants clash-current-style-combo-complete-hover from clash set. The captureFixture does all 4 - that's ok, report only lists 8 files.

summary.fixtures.backchatFixedMain = await captureBackchatFixedMainFixture();

writeFileSync(join(outDir, "pr-evidence-summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
