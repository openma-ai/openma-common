/**
 * High-DPR chat-context screenshots for process / worked-for row evidence.
 *
 * Usage:
 *   node scripts/capture-process-row-screenshots.mjs --backchat-ref v0.0.8 --prefix backchat-broken-v0.0.8
 *   node scripts/capture-process-row-screenshots.mjs --fixture clash-current --prefix clash-current
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const outDir =
  process.env.ARTIFACT_DIR ?? "/opt/cursor/artifacts/process-row-evidence";

const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const prefix = arg("--prefix") ?? "capture";
const backchatRef = arg("--backchat-ref");
const fixture = arg("--fixture");
const commonCssPath = arg("--common-css") ?? join(repoRoot, "src/chat-ui/styles.css");

mkdirSync(outDir, { recursive: true });

const VIEWPORT_WIDTH = 960;
const VIEWPORT_HEIGHT = 720;
const PANEL_WIDTH = 820;

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

async function capturePanel(page, panel, fileName) {
  await panel.scrollIntoViewIfNeeded();
  const path = join(outDir, fileName);
  await panel.screenshot({ path, scale: "device" });
  return path;
}

async function readTriggerBg(page) {
  return page.evaluate(() => {
    const el = document.querySelector(
      '[data-chat-reasoning-trigger="true"], [data-session-process-state] button, [data-process-row-trigger="true"]',
    );
    if (!el) return null;
    const c = getComputedStyle(el);
    return { text: el.textContent?.trim(), backgroundColor: c.backgroundColor, width: c.width };
  });
}

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

function fixtureHtml({ css, extraCss = "", processState, hoverLabel }) {
  const streaming = processState === "running";
  const statusText = streaming ? "工作中 4 秒" : "已工作 4 秒";
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
  --chat-fg: var(--fg);
  --chat-activity-row-leading-space: 8px;
  --surface-canvas: #f4f4f5;
  --surface-panel: #ffffff;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 32px;
  font-family: "Geist", system-ui, sans-serif;
  background: var(--surface-canvas);
  color: var(--fg);
}
.chat-shell {
  width: ${PANEL_WIDTH}px;
  margin: 0 auto;
  background: var(--surface-panel);
  border: 1px solid #e4e4e7;
  border-radius: 12px;
  padding: 20px 24px 28px;
  box-shadow: 0 8px 30px rgba(15, 23, 42, 0.06);
}
.chat-heading {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #71717a;
  margin-bottom: 16px;
}
.user-row {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 16px;
}
.user-bubble {
  max-width: 70%;
  padding: 10px 14px;
  border-radius: 16px 16px 4px 16px;
  background: #18181b;
  color: #fafafa;
  font-size: 14px;
  line-height: 1.5;
}
.assistant-line {
  margin-top: 12px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--fg);
}
.tool-row {
  margin-top: 8px;
  padding-left: 8px;
  font-size: 13px;
  color: var(--fg-muted);
}
${css}
${extraCss}
</style>
</head>
<body>
  <div class="chat-shell" data-chat-evidence-panel="true">
    <div class="chat-heading">Session · codex-acp · /tmp/demo-project</div>
    <div class="user-row">
      <div class="user-bubble">请读一下 README 并总结要点。</div>
    </div>
    <div data-session-turn-response="true">
      <div data-session-process-state="${processState}">
        <button type="button" data-process-row-trigger="true"
          class="chat-reasoning-trigger activity-disclosure-row flex w-full select-none items-center gap-2 text-sm"
          data-chat-reasoning-trigger="true">
          <span class="min-w-0 flex-1 truncate text-left" style="color: var(--fg-muted)">${statusText}</span>
          <span aria-hidden="true" style="opacity:.5">›</span>
        </button>
      </div>
      <div class="tool-row">↳ Read README.md</div>
      <div class="assistant-line">${streaming ? "正在整理 README 里的安装步骤…" : "README 说明了安装、开发命令和发布流程。"}</div>
    </div>
    <p style="margin-top:20px;font-size:11px;color:#a1a1aa">${hoverLabel}</p>
  </div>
</body>
</html>`;
}

async function captureFixtureStates({ css, extraCss, filePrefix }) {
  const browser = await chromium.launch();
  const summary = {};
  for (const processState of ["running", "complete"]) {
    for (const hover of [false, true]) {
      const page = await browser.newPage();
      await enableHiDpi(page);
      const hoverLabel = hover ? "hover" : "idle";
      await page.setContent(
        fixtureHtml({
          css,
          extraCss,
          processState,
          hoverLabel: `${filePrefix} · ${processState} · ${hoverLabel}`,
        }),
        { waitUntil: "load" },
      );
      const trigger = page.locator("[data-chat-reasoning-trigger=true]");
      await trigger.waitFor({ state: "visible" });
      if (hover) await trigger.hover();
      else await page.mouse.move(0, 0);
      const panel = page.locator("[data-chat-evidence-panel=true]");
      const fileName = `${filePrefix}-${processState}-${hoverLabel}.png`;
      const path = await capturePanel(page, panel, fileName);
      summary[fileName] = {
        path,
        ...(await readTriggerBg(page)),
      };
      await page.close();
    }
  }
  await browser.close();
  return summary;
}

async function captureBackchat(backchatRoot, ref) {
  const { execSync } = await import("node:child_process");
  execSync(`git checkout --force ${ref}`, { cwd: backchatRoot, stdio: "inherit" });
  execSync("pnpm install", { cwd: backchatRoot, stdio: "inherit", env: process.env });
  execSync("pnpm exec electron-vite build", { cwd: backchatRoot, stdio: "inherit", env: process.env });

  const helpersPath = join(backchatRoot, "e2e/helpers.ts");
  const { launchApp, injectSession, injectEvent } = await import(
    pathToFileURL(helpersPath).href
  );

  const browserSummary = {};
  const launched = await launchApp({
    language: "zh-CN",
    env: {
      BACKCHAT_E2E_VISIBLE: "1",
      BACKCHAT_E2E_APP_ROOT: backchatRoot,
    },
  });
  const { app, page } = launched;
  try {
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win?.setContentSize(1320, 920);
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 900,
      deviceScaleFactor: 2,
      mobile: false,
    });

    const sessionId = await injectSession(page, {
      sessionId: "process-row-hidpi",
      agentId: "codex-acp",
      cwd: "/tmp/demo-project",
    });

    const send = (turnId, event) =>
      injectEvent(page, {
        type: "session.event",
        session_id: sessionId,
        turn_id: turnId,
        event,
      });

    async function shot(processState, hover) {
      const hoverLabel = hover ? "hover" : "idle";
      const trigger = page
        .locator(
          '[data-chat-reasoning-trigger="true"], [data-session-process-state] [data-slot="collapsible-trigger"]',
        )
        .first();
      await trigger.waitFor({ state: "visible", timeout: 20_000 });
      if (hover) await trigger.hover();
      else await page.mouse.move(0, 0);
      const turn = page.locator('[data-session-turn-response="true"]').first();
      await turn.waitFor({ state: "visible" });
      const fileName = `${prefix}-${processState}-${hoverLabel}.png`;
      const path = join(outDir, fileName);
      const box = await turn.boundingBox();
      if (!box || box.width < 400) {
        await page.locator("main").first().screenshot({ path, scale: "device" });
      } else {
        await page.screenshot({
          path,
          scale: "device",
          clip: {
            x: Math.max(0, box.x - 24),
            y: Math.max(0, box.y - 48),
            width: Math.min(1280, Math.max(820, box.width + 48)),
            height: Math.min(520, box.height + 120),
          },
        });
      }
      browserSummary[fileName] = {
        path,
        ...(await readTriggerBg(page)),
      };
    }

    await send("turn-running", {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "Planning" },
    });
    await send("turn-running", {
      sessionUpdate: "tool_call",
      toolCallId: "tool-1",
      kind: "read",
      status: "in_progress",
      title: "Read README.md",
    });
    await send("turn-running", {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "正在整理 README 里的安装步骤…" },
    });
    await shot("running", false);
    await shot("running", true);

    await injectEvent(page, {
      type: "session.complete",
      session_id: sessionId,
      turn_id: "turn-running",
    });

    await send("turn-done", {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "Done" },
    });
    await send("turn-done", {
      sessionUpdate: "tool_call",
      toolCallId: "tool-2",
      kind: "read",
      status: "completed",
      title: "Read README.md",
    });
    await send("turn-done", {
      sessionUpdate: "agent_message_chunk",
      content: {
        type: "text",
        text: "README 说明了安装、开发命令和发布流程。",
      },
    });
    await injectEvent(page, {
      type: "session.complete",
      session_id: sessionId,
      turn_id: "turn-done",
    });

    await shot("complete", false);
    await shot("complete", true);
  } finally {
    await launched.cleanup();
  }
  return browserSummary;
}

const manifest = { prefix, capturedAt: new Date().toISOString() };

if (backchatRef) {
  const backchatRoot = process.env.BACKCHAT_ROOT ?? "/tmp/backchat";
  manifest.backchat = await captureBackchat(backchatRoot, backchatRef);
}

if (fixture) {
  const css = readFileSync(commonCssPath, "utf8");
  let extraCss = "";
  if (fixture === "clash-current" || fixture === "common-fixed-clash-combo") {
    extraCss = "";
  }
  if (fixture === "common-fixed-clash-combo" || fixture === "backchat-main-combo") {
    extraCss = backchatOverride;
  }
  manifest.fixture = await captureFixtureStates({
    css,
    extraCss,
    filePrefix: prefix,
  });
}

writeFileSync(join(outDir, `${prefix}-manifest.json`), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
