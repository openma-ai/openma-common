import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("shared session kernel contract", () => {
  it("publishes the canonical lifecycle and transport entrypoint", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8"),
    ) as { exports?: Record<string, unknown> };

    expect(pkg.exports?.["./session-kernel"]).toEqual({
      types: "./dist/session-kernel/index.d.ts",
      import: "./dist/session-kernel/index.js",
    });
  });
});
