import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { injectEvent, injectSession, launchApp } from "./helpers";

const outDir = process.env.ARTIFACT_DIR ?? "/opt/cursor/artifacts/process-row-evidence";
const prefix = process.env.SNAPSHOT_PREFIX ?? "backchat-fixed-main";

async function pointerState(
  page: import("@playwright/test").Page,
  trigger: import("@playwright/test").Locator,
  hover: boolean,
) {
  if (hover) {
    await trigger.scrollIntoViewIfNeeded();
    await trigger.hover({ force: true });
  } else {
    await page.mouse.move(8, 8);
  }
  await page.waitForTimeout(350);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

test(`complete row hover evidence (${prefix})`, async () => {
  await mkdir(outDir, { recursive: true });
  const launched = await launchApp({
    language: "zh-CN",
    env: {
      BACKCHAT_E2E_VISIBLE: "1",
      BACKCHAT_E2E_APP_ROOT: process.env.BACKCHAT_E2E_APP_ROOT,
    },
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
      sessionId: "complete-hover-evidence",
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

    await send("turn-done", {
      sessionUpdate: "tool_call",
      toolCallId: "t1",
      kind: "read",
      status: "completed",
      title: "Read README.md",
    });
    await send("turn-done", {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "README 说明了安装与发布流程。" },
    });
    await injectEvent(page, {
      type: "session.complete",
      session_id: sessionId,
      turn_id: "turn-done",
    });

    const completeTurn = page
      .locator("[data-session-turn-response]")
      .filter({ hasText: "已工作" })
      .last();
    const trigger = completeTurn.locator(
      '[data-chat-reasoning-trigger="true"], [data-slot="collapsible-trigger"]',
    ).first();

    async function capture(name: string, hover: boolean) {
      await pointerState(page, trigger, hover);
      const backgroundColor = await trigger.evaluate(
        (el) => getComputedStyle(el).backgroundColor,
      );
      const path = join(outDir, `${prefix}-${name}.png`);
      const box = await trigger.boundingBox();
      if (!box) {
        await trigger.screenshot({ path, scale: "device" });
      } else {
        await page.screenshot({
          path,
          scale: "device",
          clip: {
            x: box.x,
            y: box.y,
            width: box.width,
            height: Math.max(box.height, 32),
          },
        });
      }
      return backgroundColor;
    }

    const idleBg = await capture("complete-idle", false);
    const hoverBg = await capture("complete-hover", true);
    expect(idleBg).not.toBe(hoverBg);
  } finally {
    await launched.cleanup();
  }
});
