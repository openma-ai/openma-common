import { describe, expect, it } from "vitest";
import { OPENMA_ACP_HARNESS_CATALOG } from "../src/acp-harnesses/catalog.js";

describe("OPENMA_ACP_HARNESS_CATALOG", () => {
  it("uses one entry shape with npm sources for every managed harness", () => {
    const ids = OPENMA_ACP_HARNESS_CATALOG.map((entry) => entry.id);
    expect(ids).toEqual([
      "codex-acp",
      "claude-acp",
      "gemini",
      "kimi",
      "dsh-acp",
      "pi-acp",
    ]);
    for (const entry of OPENMA_ACP_HARNESS_CATALOG) {
      expect(entry.source.type).toBe("npm");
      if (entry.source.type === "npm") {
        expect(entry.source.package.length).toBeGreaterThan(0);
      }
      expect(entry.version).toMatch(/^\d+\.\d+\.\d+/);
    }
  });
});
