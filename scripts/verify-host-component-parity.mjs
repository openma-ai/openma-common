/**
 * Compare v0.7.5 vs v0.7.6 common chat-ui CSS under Backchat + Clash host sheets.
 * Non–process-row components must have zero pixel + computed-style drift.
 *
 * Run: node scripts/verify-host-component-parity.mjs
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const outDir =
  process.env.ARTIFACT_DIR ?? "/opt/cursor/artifacts/host-component-parity";

const CSS_075 =
  process.env.COMMON_CSS_075 ??
  "/tmp/openma-common-v0.7.5-chat-ui-styles.css";
const CSS_076 = join(repoRoot, "src/chat-ui/styles.css");
const BACKCHAT_INDEX =
  process.env.BACKCHAT_INDEX_CSS ??
  "/tmp/backchat/src/renderer/src/styles/index.css";
const CLASH_GLOBALS =
  process.env.CLASH_GLOBALS_CSS ?? "/tmp/clash/apps/web/app/globals.css";

const TRANSITION_MS = 200;
const VIEWPORT = { width: 900, height: 640 };

mkdirSync(outDir, { recursive: true });

/** Components whose v0.7.5 → v0.7.6 visual change is intentional. */
const ALLOWED_DIFF_IDS = new Set(["process-row-reasoning"]);

const COMPUTED_KEYS = [
  "backgroundColor",
  "color",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderTopColor",
  "borderTopStyle",
];

const HOST_RESET = `
summary { height: 32px; padding: 12px; line-height: 2; margin: 4px; border: 1px solid #ccc; }
button {
  appearance: auto;
  -webkit-appearance: button;
  padding: 10px 16px;
  border: 2px solid #999;
  background: #f3f3f3;
  font: 16px/1.5 system-ui, sans-serif;
  line-height: 1.5;
}
svg { width: 24px; height: 24px; }
`;

function loadBackchatHostCss() {
  return readFileSync(BACKCHAT_INDEX, "utf8");
}

function loadClashHostCss() {
  const raw = readFileSync(CLASH_GLOBALS, "utf8");
  return raw
    .split("\n")
    .filter(
      (line) =>
        !line.startsWith("@import") &&
        !line.startsWith("@source") &&
        !line.startsWith("@custom-variant"),
    )
    .join("\n");
}

function fixtureShell({ hostCss, commonCss, bodyHtml }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<style>
${HOST_RESET}
${hostCss}
${commonCss}
</style></head>
<body style="margin:24px;font-family:system-ui,sans-serif;background:#fff">
<div data-parity-panel="true" style="max-width:420px">${bodyHtml}</div>
<div data-hover-reset="true" style="width:1px;height:1px;margin-top:40px"></div>
</body></html>`;
}

const SCENARIOS = [
  {
    id: "session-history",
    states: ["idle", "hover", "open"],
    html: `
<details class="openma-session-history" id="history-menu">
  <summary class="openma-session-history-trigger">
    <span>Session title goes here</span>
    <svg viewBox="0 0 16 16"><path d="M4 6l4 4 4-4" fill="currentColor"/></svg>
  </summary>
</details>`,
    target: ".openma-session-history-trigger",
    openSelector: "#history-menu",
  },
  {
    id: "toolbar-chip",
    states: ["idle", "hover", "open"],
    html: `
<details class="openma-session-chip-menu" id="chip-menu">
  <summary class="openma-session-toolbar-chip openma-session-run-trigger">
    <span class="openma-session-chip-label">Codex · main</span>
    <svg viewBox="0 0 16 16"><path d="M4 6l4 4 4-4" fill="currentColor"/></svg>
  </summary>
  <div class="openma-session-menu openma-session-menu-align-start" hidden></div>
</details>`,
    target: "summary.openma-session-toolbar-chip",
    openSelector: "#chip-menu",
  },
  {
    id: "session-menu-item",
    states: ["idle", "hover"],
    html: `
<div class="openma-session-menu" style="position:relative;display:flex">
  <button type="button" class="openma-session-menu-item">
    <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="currentColor"/></svg>
    <span class="openma-session-menu-item-copy"><strong>Resume session</strong></span>
  </button>
</div>`,
    target: ".openma-session-menu-item",
  },
  {
    id: "session-menu-item-checked",
    states: ["idle"],
    html: `
<div class="openma-session-menu" style="position:relative;display:flex">
  <button type="button" class="openma-session-menu-item" aria-checked="true">
    <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="currentColor"/></svg>
    <span class="openma-session-menu-item-copy"><strong>Selected harness</strong></span>
  </button>
</div>`,
    target: ".openma-session-menu-item",
  },
  {
    id: "submenu-trigger",
    states: ["idle", "hover"],
    html: `
<div class="openma-session-menu" style="position:relative;display:flex">
  <button type="button" class="openma-session-menu-item openma-session-submenu-trigger">
    <span class="openma-session-menu-item-copy">Working directory</span>
    <span class="openma-session-submenu-value">/tmp/demo</span>
    <svg viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" fill="currentColor"/></svg>
  </button>
</div>`,
    target: ".openma-session-submenu-trigger",
  },
  {
    id: "activity-tool-row",
    states: ["idle", "hover"],
    html: `
<button type="button" class="activity-disclosure-row min-h-6 text-[13px]">
  <span class="chat-activity-icon"><svg viewBox="0 0 16 16"><rect width="16" height="16" fill="currentColor"/></svg></span>
  <span class="min-w-0 flex-1 truncate">Read README.md</span>
  <span class="activity-disclosure-chevron"><svg viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" fill="currentColor"/></svg></span>
</button>`,
    target: "button.activity-disclosure-row",
  },
  {
    id: "reasoning-chip",
    states: ["idle", "hover"],
    html: `
<button type="button"
  class="chat-reasoning-trigger chat-reasoning-trigger--chip activity-disclosure-row">
  <span>Thought for 4s</span>
  <span class="activity-disclosure-chevron"><svg viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" fill="currentColor"/></svg></span>
</button>`,
    target: "button.chat-reasoning-trigger--chip",
  },
  {
    id: "process-row-reasoning",
    states: ["idle", "hover"],
    html: `
<div data-session-turn-response="true">
  <button type="button"
    class="chat-reasoning-trigger activity-disclosure-row flex w-full items-center gap-2 text-sm"
    data-chat-reasoning-trigger="true">
    <span class="min-w-0 flex-1 truncate text-left">已工作 4 秒</span>
    <span class="activity-disclosure-chevron"><svg viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" fill="currentColor"/></svg></span>
  </button>
</div>`,
    target: "[data-chat-reasoning-trigger=true]",
  },
];

async function applyState(page, scenario, state, target) {
  const locator = page.locator(scenario.target);
  await locator.waitFor({ state: "visible" });
  if (scenario.openSelector && state === "open") {
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el instanceof HTMLDetailsElement) el.open = true;
    }, scenario.openSelector);
  } else if (scenario.openSelector && state !== "open") {
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el instanceof HTMLDetailsElement) el.open = false;
    }, scenario.openSelector);
  }
  if (state === "hover") {
    await locator.hover({ force: true });
  } else {
    await page.locator("[data-hover-reset=true]").hover();
  }
  await page.waitForTimeout(TRANSITION_MS);
}

async function readComputed(page, selector) {
  return page.$eval(selector, (el) => {
    const c = getComputedStyle(el);
    const out = {};
    for (const key of [
      "backgroundColor",
      "color",
      "fontSize",
      "fontWeight",
      "lineHeight",
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
      "borderTopWidth",
      "borderRightWidth",
      "borderBottomWidth",
      "borderLeftWidth",
      "borderTopColor",
      "borderTopStyle",
    ]) {
      out[key] = c[key];
    }
    return out;
  });
}

function diffPixels(aBuf, bBuf) {
  const a = PNG.sync.read(aBuf);
  const b = PNG.sync.read(bBuf);
  const w = Math.max(a.width, b.width);
  const h = Math.max(a.height, b.height);
  const pa = new PNG({ width: w, height: h });
  const pb = new PNG({ width: w, height: h });
  PNG.bitblt(a, pa, 0, 0, a.width, a.height, 0, 0);
  PNG.bitblt(b, pb, 0, 0, b.width, b.height, 0, 0);
  const diff = new PNG({ width: w, height: h });
  const numDiff = pixelmatch(pa.data, pb.data, diff.data, w, h, {
    threshold: 0,
    includeAA: true,
  });
  return { numDiff, width: w, height: h, diffPng: PNG.sync.write(diff) };
}

async function captureVariant(page, { hostCss, commonCss, scenario, state }) {
  await page.setContent(
    fixtureShell({ hostCss, commonCss, bodyHtml: scenario.html }),
    { waitUntil: "load" },
  );
  await applyState(page, scenario, state, scenario.target);
  const panel = page.locator("[data-parity-panel=true]");
  const shot = await panel.screenshot({ scale: "device" });
  const computed = await readComputed(page, scenario.target);
  return { shot, computed };
}

const css075 = readFileSync(CSS_075, "utf8");
const css076 = readFileSync(CSS_076, "utf8");
const hosts = {
  backchat: loadBackchatHostCss(),
  clash: loadClashHostCss(),
};

const report = {
  capturedAt: new Date().toISOString(),
  css075: CSS_075,
  css076: CSS_076,
  componentsRemovedImportant: [
    "openma-session-history-trigger > svg (14×14)",
    "openma-session-toolbar-chip summary (height, padding, margin, border, line-height, icon sizes)",
    "openma-session-submenu-trigger (align-items, chevron svg)",
    "openma-session-menu-item buttons (layout, border, backgrounds, hover/checked)",
    "openma-session-menu-item > svg",
    "chat-activity-icon",
    "activity-disclosure-row (padding, border, background reset)",
    "activity-disclosure-chevron > svg",
    "chat-reasoning-trigger--chip (bubble chip; not the plain process row)",
  ],
  rows: [],
  failures: [],
  screenshots: [],
};

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize(VIEWPORT);

for (const [hostName, hostCss] of Object.entries(hosts)) {
  for (const scenario of SCENARIOS) {
    for (const state of scenario.states) {
      const key = `${hostName}/${scenario.id}/${state}`;
      const v075 = await captureVariant(page, {
        hostCss,
        commonCss: css075,
        scenario,
        state,
      });
      const v076 = await captureVariant(page, {
        hostCss,
        commonCss: css076,
        scenario,
        state,
      });

      const { numDiff, diffPng } = diffPixels(v075.shot, v076.shot);
      const computedDiff = {};
      for (const k of COMPUTED_KEYS) {
        const a = v075.computed[k];
        const b = v076.computed[k];
        if (a !== b) computedDiff[k] = { v075: a, v076: b };
      }

      const allowed = ALLOWED_DIFF_IDS.has(scenario.id);
      const pixelOk = allowed ? numDiff > 0 || Object.keys(computedDiff).length > 0 : numDiff === 0;
      const computedOk = allowed || Object.keys(computedDiff).length === 0;

      const row = {
        key,
        host: hostName,
        component: scenario.id,
        state,
        allowedDiff: allowed,
        pixelDiffCount: numDiff,
        computedDiff,
        pass: pixelOk && computedOk,
      };
      report.rows.push(row);

      if (!row.pass) {
        report.failures.push(row);
        const base = `${hostName}-${scenario.id}-${state}`;
        const p075 = join(outDir, `${base}-v075.png`);
        const p076 = join(outDir, `${base}-v076.png`);
        const pdiff = join(outDir, `${base}-diff.png`);
        writeFileSync(p075, v075.shot);
        writeFileSync(p076, v076.shot);
        writeFileSync(pdiff, diffPng);
        report.screenshots.push({ base, p075, p076, pdiff });
      } else if (allowed && report.screenshots.length < 4) {
        const base = `${hostName}-${scenario.id}-${state}`;
        writeFileSync(join(outDir, `${base}-v075.png`), v075.shot);
        writeFileSync(join(outDir, `${base}-v076.png`), v076.shot);
        writeFileSync(
          join(outDir, `${base}-diff.png`),
          diffPng,
        );
        report.screenshots.push({
          base,
          p075: join(outDir, `${base}-v075.png`),
          p076: join(outDir, `${base}-v076.png`),
          pdiff: join(outDir, `${base}-diff.png`),
        });
      }
    }
  }
}

report.summary = {
  total: report.rows.length,
  failed: report.failures.length,
  nonProcessPass: report.rows.filter((r) => !r.allowedDiff && r.pass).length,
  nonProcessTotal: report.rows.filter((r) => !r.allowedDiff).length,
};

const representative = [
  "backchat-process-row-reasoning-idle-v075.png",
  "backchat-process-row-reasoning-idle-v076.png",
  "backchat-process-row-reasoning-hover-diff.png",
  "clash-process-row-reasoning-hover-diff.png",
  "backchat-toolbar-chip-open-v075.png",
  "backchat-toolbar-chip-open-v076.png",
  "clash-session-menu-item-hover-v075.png",
  "clash-session-menu-item-hover-v076.png",
];

async function writeRepresentativePair(page, hostName, hostCss, scenario, state, file075, file076) {
  const v075 = await captureVariant(page, {
    hostCss,
    commonCss: css075,
    scenario,
    state,
  });
  const v076 = await captureVariant(page, {
    hostCss,
    commonCss: css076,
    scenario,
    state,
  });
  writeFileSync(join(outDir, file075), v075.shot);
  writeFileSync(join(outDir, file076), v076.shot);
  const { numDiff } = diffPixels(v075.shot, v076.shot);
  return { hostName, scenario: scenario.id, state, pixelDiffCount: numDiff };
}

await browser.close();

const proofBrowser = await chromium.launch();
const proofPage = await proofBrowser.newPage();
await proofPage.setViewportSize(VIEWPORT);
const toolbar = SCENARIOS.find((s) => s.id === "toolbar-chip");
const menu = SCENARIOS.find((s) => s.id === "session-menu-item");
report.representativeProof = [
  await writeRepresentativePair(
    proofPage,
    "backchat",
    hosts.backchat,
    toolbar,
    "open",
    "backchat-toolbar-chip-open-v075.png",
    "backchat-toolbar-chip-open-v076.png",
  ),
  await writeRepresentativePair(
    proofPage,
    "clash",
    hosts.clash,
    menu,
    "hover",
    "clash-session-menu-item-hover-v075.png",
    "clash-session-menu-item-hover-v076.png",
  ),
];
await proofBrowser.close();

report.representativeScreenshots = representative.map((name) => join(outDir, name));

writeFileSync(join(outDir, "parity-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.summary, null, 2));
console.log("representative:", report.representativeScreenshots);

if (report.failures.length > 0) {
  console.error("Parity failures:", report.failures.map((f) => f.key).join(", "));
  process.exit(1);
}
