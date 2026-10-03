/**
 * Full-turn evidence for activity disclosure row states (light theme).
 * Run: node scripts/capture-activity-disclosure-evidence.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const outDir =
  process.env.ARTIFACT_DIR ??
  "/opt/cursor/artifacts/activity-disclosure-evidence";
const css = readFileSync(join(repoRoot, "src/chat-ui/styles.css"), "utf8");

mkdirSync(outDir, { recursive: true });

const PANEL = 820;

function pageHtml({ variant }) {
  const isDark = variant === "dark";
  const canvas = isDark ? "#18181b" : "#f4f4f5";
  const panel = isDark ? "#27272a" : "#ffffff";
  const fg = isDark ? "#fafafa" : "#242424";
  const muted = isDark ? "#a1a1aa" : "#898885";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" />
<style>
:root {
  --fg: ${fg}; --chat-fg: ${fg}; --fg-muted: ${muted};
  --chat-activity-row-leading-space: 8px;
  --chat-control-bg-hover: color-mix(in srgb, ${fg} 8%, transparent);
}
body { margin:0; padding:32px; font-family:system-ui,sans-serif; background:${canvas}; color:${fg}; }
.shell { width:${PANEL}px; margin:0 auto; background:${panel}; border-radius:12px; padding:20px 24px; border:1px solid ${isDark ? "#3f3f46" : "#e4e4e7"}; }
.user { display:flex; justify-content:flex-end; margin-bottom:16px; }
.bubble { background:${isDark ? "#3f3f46" : "#18181b"}; color:${isDark ? fg : "#fafafa"}; padding:10px 14px; border-radius:16px 16px 4px 16px; font-size:14px; }
.assistant { margin-top:12px; font-size:14px; line-height:1.6; }
${css}
</style></head><body>
<div class="shell" data-panel="true">
  <div data-hover-reset="true" style="font-size:12px;color:${muted};margin-bottom:12px">Session · demo</div>
  <div class="user"><div class="bubble">请读 README 并总结。</div></div>
  <div data-session-turn-response="true">
    <button type="button" data-chat-reasoning-trigger="true" aria-expanded="false"
      class="chat-interactive-surface chat-interactive-surface--transcript chat-reasoning-trigger activity-disclosure-row flex w-full items-center gap-2 text-sm">
      <span style="color:${muted}" class="min-w-0 flex-1 truncate text-left">已工作 4 秒</span>
      <span class="activity-disclosure-chevron">›</span>
    </button>
    <button type="button" data-chat-activity-disclosure-trigger="true" aria-expanded="false"
      class="chat-interactive-surface chat-interactive-surface--transcript activity-disclosure-row min-h-6 text-[13px]">
      <span style="color:${muted}" class="min-w-0 flex-1 truncate">已执行 1 项操作</span>
      <span class="activity-disclosure-chevron">›</span>
    </button>
    <div class="assistant">README 说明了安装、开发与发布流程。</div>
  </div>
</div></body></html>`;
}

async function captureStates(page, prefix) {
  const rows = [
    { name: "idle", run: async (loc) => page.locator("[data-hover-reset=true]").hover() },
    {
      name: "hover",
      run: async (loc) => loc.hover(),
    },
    {
      name: "expanded-focus",
      run: async (loc) => {
        await loc.click();
        await page.locator("[data-hover-reset=true]").hover();
      },
    },
    {
      name: "focus-visible",
      run: async (loc) => {
        await loc.evaluate((el) => {
          if (el instanceof HTMLElement) el.focus({ focusVisible: true });
        });
      },
    },
  ];
  for (const row of rows) {
    for (const sel of [
      '[data-chat-reasoning-trigger="true"]',
      '[data-chat-activity-disclosure-trigger="true"]',
    ]) {
      const loc = page.locator(sel);
      await page.locator("[data-hover-reset=true]").hover();
      await row.run(loc);
      await page.waitForTimeout(100);
      const path = join(outDir, `${prefix}-${sel.includes("reasoning") ? "reasoning" : "activity"}-${row.name}.png`);
      await page.locator("[data-panel=true]").screenshot({ path, scale: "device" });
    }
  }
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize({ width: 960, height: 720 });
const cdp = await page.context().newCDPSession(page);
await cdp.send("Emulation.setDeviceMetricsOverride", {
  width: 960,
  height: 720,
  deviceScaleFactor: 2,
  mobile: false,
});

for (const variant of ["light", "dark"]) {
  await page.setContent(pageHtml({ variant }), { waitUntil: "load" });
  await captureStates(page, variant);
}

await browser.close();
writeFileSync(join(outDir, "manifest.json"), JSON.stringify({ outDir }, null, 2));
console.log("Wrote evidence to", outDir);
