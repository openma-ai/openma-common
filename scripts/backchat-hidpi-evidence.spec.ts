import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "@playwright/test";
import { injectEvent, injectSession, launchApp } from "./helpers";

const outDir = process.env.ARTIFACT_DIR ?? "/opt/cursor/artifacts/process-row-evidence";
const prefix = process.env.SNAPSHOT_PREFIX ?? "backchat";

async function captureTurn(page: import("@playwright/test").Page, name: string, hover: boolean) {
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
  const fileName = `${prefix}-${name}.png`;
  const path = join(outDir, fileName);
  const box = await turn.boundingBox();
  if (!box) {
    await page.locator("main").first().screenshot({ path, scale: "device" });
    return path;
  }
  await page.screenshot({
    path,
    scale: "device",
    clip: {
      x: Math.max(0, box.x - 32),
      y: Math.max(0, box.y - 64),
      width: Math.min(1280, Math.max(820, box.width + 64)),
      height: Math.min(560, box.height + 160),
    },
  });
  return path;
}

test(`hidpi process row (${prefix})`, async () => {
  await mkdir(outDir, { recursive: true });
  const launched = await launchApp({
    language: "zh-CN",
    env: { BACKCHAT_E2E_VISIBLE: "1", BACKCHAT_E2E_APP_ROOT: process.env.BACKCHAT_E2E_APP_ROOT },
  });
  const { app, page } = launched;
  try {
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1320, 920);
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 900,
      deviceScaleFactor: 2,
      mobile: false,
    });

    const sessionId = await injectSession(page, {
      sessionId: "hidpi-process-row",
      agentId: "codex-acp",
      cwd: "/tmp/demo-project",
    });
    const send = (turnId: string, event: Record<string, unknown>) =>
      injectEvent(page, {
        type: "session.event",
        session_id: sessionId,
        turn_id: turnId,
        event,
      });

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
    await captureTurn(page, "running-idle", false);
    await captureTurn(page, "running-hover", true);

    await injectEvent(page, {
      type: "session.complete",
      session_id: sessionId,
      turn_id: "turn-running",
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

    await captureTurn(page, "complete-idle", false);
    await captureTurn(page, "complete-hover", true);
  } finally {
    await launched.cleanup();
  }
});
