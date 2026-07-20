import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const action = process.argv[2];
if (action !== "link" && action !== "unlink") {
  console.error("Usage: node scripts/consumers.mjs <link|unlink>");
  process.exit(1);
}

const commonRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = dirname(commonRoot);
const statePath = resolve(commonRoot, ".consumer-links.json");
const consumers = [
  "openma-desktop",
  "openma-desktop/packages/acp",
  "open-managed-agents/packages/acp-runtime",
  "open-managed-agents/apps/console",
  "open-managed-agents/apps/web",
  "open-managed-agents/apps/docs",
  "open-managed-agents/packages/cli",
].map((path) => resolve(workspaceRoot, path));

if (action === "link") {
  if (existsSync(statePath)) {
    throw new Error("Consumers are already linked; run pnpm unlink:consumers first");
  }
  const originalLinks = {};
  for (const consumer of consumers) {
    if (!existsSync(resolve(consumer, "package.json"))) {
      console.warn(`Skipping missing consumer: ${consumer}`);
      continue;
    }
    const packagePath = resolve(consumer, "node_modules/@openma/common");
    mkdirSync(dirname(packagePath), { recursive: true });
    if (!existsSync(packagePath) || !lstatSync(packagePath).isSymbolicLink()) {
      throw new Error(`Install the locked dependency before linking: ${packagePath}`);
    }
    originalLinks[packagePath] = readlinkSync(packagePath);
  }
  for (const [packagePath] of Object.entries(originalLinks)) {
    unlinkSync(packagePath);
    symlinkSync(commonRoot, packagePath, "dir");
    console.log(`Linked ${dirname(dirname(dirname(packagePath)))}`);
  }
  writeFileSync(statePath, `${JSON.stringify(originalLinks, null, 2)}\n`);
} else {
  if (!existsSync(statePath)) {
    console.log("Consumers are not linked");
    process.exit(0);
  }
  const originalLinks = JSON.parse(readFileSync(statePath, "utf8"));
  for (const [packagePath, target] of Object.entries(originalLinks)) {
    if (existsSync(packagePath)) {
      if (!lstatSync(packagePath).isSymbolicLink() || realpathSync(packagePath) !== commonRoot) {
        throw new Error(`Refusing to replace an unexpected package: ${packagePath}`);
      }
      unlinkSync(packagePath);
    }
    symlinkSync(target, packagePath, "dir");
    console.log(`Restored ${dirname(dirname(dirname(packagePath)))}`);
  }
  unlinkSync(statePath);
}
