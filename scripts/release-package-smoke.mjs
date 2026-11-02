// Run from a clean temporary consumer, not from this package's source tree.
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import assert from "node:assert/strict";
const root = resolve(dirname(fileURLToPath(import.meta.resolve("@openma/common/chat-ui"))), "../..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
for (const [name, target] of Object.entries(pkg.exports)) {
  const entry = typeof target === "string" ? target : target.import;
  assert.ok(existsSync(resolve(root, entry)), `Missing packed export ${name}`);
  if (typeof target !== "string" && target.types) {
    assert.ok(existsSync(resolve(root, target.types)), `Missing packed types ${name}`);
  }
  if (entry.endsWith(".js")) await import(`@openma/common${name.slice(1)}`);
}
console.log(`Installed ${pkg.name}@${pkg.version}: all exports present; JS entries imported`);
