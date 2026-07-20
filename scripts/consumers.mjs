import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const action = process.argv[2];
if (action !== "link" && action !== "unlink") {
  console.error("Usage: node scripts/consumers.mjs <link|unlink>");
  process.exit(1);
}

const commonRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = dirname(commonRoot);
const consumers = [
  "openma-desktop",
  "open-managed-agents/apps/console",
  "open-managed-agents/apps/web",
  "open-managed-agents/apps/docs",
  "open-managed-agents/packages/cli",
].map((path) => resolve(workspaceRoot, path));

for (const consumer of consumers) {
  if (!existsSync(resolve(consumer, "package.json"))) {
    console.warn(`Skipping missing consumer: ${consumer}`);
    continue;
  }
  const args = action === "link"
    ? ["--dir", consumer, "link", commonRoot]
    : ["--dir", consumer, "unlink", "@openma/common"];
  console.log(`${action === "link" ? "Linking" : "Unlinking"} ${consumer}`);
  const result = spawnSync("pnpm", args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
