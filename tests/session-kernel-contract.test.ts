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

  it("publishes the ACP codec independently from the legacy turn projector", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8"),
    ) as { exports?: Record<string, unknown> };

    expect(pkg.exports?.["./protocol/acp"]).toEqual({
      types: "./dist/protocol/acp/index.d.ts",
      import: "./dist/protocol/acp/index.js",
    });
  });

  it("does not re-export the Agent UI domain from the runtime kernel", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "../src/session-kernel/index.ts"),
      "utf8",
    );

    expect(source).not.toContain("../agent-ui");
  });
});
