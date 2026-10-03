import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

/** Path to the npm CLI entry script shipped with the `npm` dependency. */
export function defaultNpmCliPath(): string {
  const packageJson = require.resolve("npm/package.json");
  return join(dirname(packageJson), "bin/npm-cli.js");
}
