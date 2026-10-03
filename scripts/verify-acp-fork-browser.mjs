import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const tempDir = mkdtempSync(join(tmpdir(), "openma-acp-fork-browser-"));
const entry = join(tempDir, "entry.mjs");
const outfile = join(tempDir, "bundle.mjs");

writeFileSync(
  entry,
  `import { acpForkPointsFromMessages, forkSupport } from "@openma/common/acp-fork";
console.log(forkSupport({ agentCapabilities: { sessionCapabilities: { fork: {} } } }).level);
console.log(acpForkPointsFromMessages([{ messageId: "m1", text: "hi" }]).length);
`,
);

const result = spawnSync(
  "npx",
  [
    "--yes",
    "esbuild@0.25.12",
    entry,
    "--bundle",
    "--platform=browser",
    "--format=esm",
    `--outfile=${outfile}`,
    `--alias:@openma/common/acp-fork=${join(root, "dist/acp-fork/index.js")}`,
    "--log-level=warning",
  ],
  { cwd: root, encoding: "utf8" },
);

if (result.status !== 0) {
  console.error(result.stdout);
  console.error(result.stderr);
  rmSync(tempDir, { recursive: true, force: true });
  process.exit(result.status ?? 1);
}

const bundled = readFileSync(outfile, "utf8");
rmSync(tempDir, { recursive: true, force: true });

if (/\bnode:/.test(bundled) || /from\s+["']node:/.test(bundled)) {
  console.error("browser bundle still references node: built-ins");
  process.exit(1);
}

console.log("acp-fork browser bundle ok");
