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

  it("publishes the vendor-neutral Agent Contract and wire adapter entrypoints", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8"),
    ) as { exports?: Record<string, unknown> };

    expect(pkg.exports).toMatchObject({
      "./agent-contract": {
        types: "./dist/agent-contract/index.d.ts",
        import: "./dist/agent-contract/index.js",
      },
      "./agent-contract/acp": {
        types: "./dist/agent-contract/acp.d.ts",
        import: "./dist/agent-contract/acp.js",
      },
      "./agent-contract/managed": {
        types: "./dist/agent-contract/managed.d.ts",
        import: "./dist/agent-contract/managed.js",
      },
    });
  });
});
