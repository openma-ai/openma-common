import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
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
const consumers = [
  "openma-desktop",
  "open-managed-agents/apps/console",
  "open-managed-agents/apps/web",
  "open-managed-agents/apps/docs",
  "open-managed-agents/packages/cli",
].map((path) => resolve(workspaceRoot, path));

if (action === "link") {
  for (const consumer of consumers) {
    if (!existsSync(resolve(consumer, "package.json"))) {
      console.warn(`Skipping missing consumer: ${consumer}`);
      continue;
    }
    const packagePath = resolve(consumer, "node_modules/@openma/common");
    mkdirSync(dirname(packagePath), { recursive: true });
    if (existsSync(packagePath)) {
      if (!lstatSync(packagePath).isSymbolicLink()) {
        throw new Error(`Refusing to replace non-symlink package: ${packagePath}`);
      }
      unlinkSync(packagePath);
    }
    symlinkSync(commonRoot, packagePath, "dir");
    console.log(`Linked ${consumer}`);
  }
} else {
  const possibleLinks = [
    resolve(workspaceRoot, "openma-desktop/node_modules/@openma/common"),
    resolve(workspaceRoot, "open-managed-agents/node_modules/@openma/common"),
    ...consumers.slice(1).map((consumer) => resolve(consumer, "node_modules/@openma/common")),
  ];
  for (const path of possibleLinks) {
    if (!existsSync(path) || !lstatSync(path).isSymbolicLink()) continue;
    if (realpathSync(path) === commonRoot) unlinkSync(path);
  }

  for (const repository of [
    resolve(workspaceRoot, "openma-desktop"),
    resolve(workspaceRoot, "open-managed-agents"),
  ]) {
    if (!existsSync(resolve(repository, "package.json"))) continue;
    console.log(`Restoring locked dependencies in ${repository}`);
    const result = spawnSync("pnpm", ["--dir", repository, "install", "--offline"], {
      stdio: "inherit",
    });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
