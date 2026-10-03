/**
 * Playwright evidence for ChatReasoningTrigger surface styles.
 * Run: node scripts/verify-chat-reasoning-trigger-styles.mjs
 * Output: artifacts/chat-reasoning-trigger-pr/<scenario>-<state>.png + summary.json
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const outDir = process.env.ARTIFACT_DIR
  ? resolve(process.env.ARTIFACT_DIR)
  : join(repoRoot, "artifacts", "process-row-evidence");

const commonCss = readFileSync(
  join(repoRoot, "src/chat-ui/styles.css"),
  "utf8",
);

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

function fixtureHtml({ extraCss, processState, label }) {
  const streaming = processState === "running";
  const text = streaming ? "工作中 4 秒" : "已工作 4 秒";
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<style>
:root {
  --bg-bubble: #e9e9e9;
  --chat-bg-bubble: var(--bg-bubble);
  --fg: #242424;
  --fg-muted: #898885;
  --chat-activity-row-leading-space: 8px;
}
body { margin: 24px; font-family: system-ui, sans-serif; background: #fff; }
${commonCss}
${extraCss ?? ""}
</style>
</head>
<body>
<div data-session-turn-response="true" style="max-width: 720px">
  <div data-session-process-state="${processState}">
    <button type="button"
      class="chat-reasoning-trigger activity-disclosure-row flex w-full select-none items-center gap-2 text-sm"
      data-chat-reasoning-trigger="true">
      <span class="min-w-0 flex-1 truncate text-left" style="color: var(--fg-muted)">${text}</span>
    </button>
  </div>
</div>
<p id="fixture-label">${label}</p>
</body>
</html>`;
}

async function capture(page, trigger, name) {
  const box = await trigger.boundingBox();
  if (!box) throw new Error(`no box for ${name}`);
  const path = join(outDir, `${name}.png`);
  await page.screenshot({
    path,
    clip: {
      x: Math.max(0, box.x - 8),
      y: Math.max(0, box.y - 8),
      width: Math.min(1200, box.width + 16),
      height: box.height + 16,
    },
  });
  return path;
}

async function readStyles(page, hover) {
  return page.evaluate((hover) => {
    const el = document.querySelector("[data-chat-reasoning-trigger=true]");
    if (!el) return { error: "missing trigger" };
    if (hover) el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    else el.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    const computed = getComputedStyle(el);
    const rules = [];
    for (const sheet of Array.from(document.styleSheets)) {
      const source = sheet.href ?? "inline";
      try {
        for (const rule of Array.from(sheet.cssRules ?? [])) {
          if (!(rule instanceof CSSStyleRule)) continue;
          if (!el.matches(rule.selectorText)) continue;
          if (!rule.selectorText.includes("reasoning")) continue;
          rules.push({
            selector: rule.selectorText,
            source,
            background: rule.style.background || rule.style.backgroundColor || undefined,
          });
        }
      } catch {
        rules.push({ selector: "(blocked)", source });
      }
    }
    return {
      text: el.textContent?.trim(),
      backgroundColor: computed.backgroundColor,
      padding: computed.padding,
      width: computed.width,
      rules,
    };
  }, hover);
}

mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const summary = {};

for (const scenario of [
  { key: "host-only", extraCss: "" },
  { key: "with-backchat-override", extraCss: backchatOverride },
]) {
  for (const processState of ["running", "complete"]) {
    for (const hover of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 900, height: 180 } });
      const label = `${scenario.key}-${processState}-${hover ? "hover" : "idle"}`;
      await page.setContent(
        fixtureHtml({ extraCss: scenario.extraCss, processState, label }),
        { waitUntil: "load" },
      );
      const trigger = page.locator("[data-chat-reasoning-trigger=true]");
      await trigger.waitFor({ state: "visible" });
      if (hover) await trigger.hover();
      const shot = await capture(page, trigger, label);
      const styles = await readStyles(page, hover);
      summary[label] = { screenshot: shot, ...styles };
      await page.close();
    }
  }
}

await browser.close();

const summaryPath = join(outDir, "summary.json");
writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
console.log(`Wrote ${summaryPath}`);
for (const [key, value] of Object.entries(summary)) {
  console.log(`${key}: backgroundColor=${value.backgroundColor}`);
}
