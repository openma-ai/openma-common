import { describe, expect, it } from "vitest";
import { OPENMA_ACP_HARNESS_CATALOG } from "../src/acp-harnesses/catalog.js";

describe("OPENMA_ACP_HARNESS_CATALOG", () => {
  it("uses registry sources for upstream agents and npm only for OpenMA adapters", () => {
    const ids = OPENMA_ACP_HARNESS_CATALOG.map((entry) => entry.id);
    expect(ids).toEqual([
      "codex-acp",
      "claude-acp",
      "gemini",
      "opencode",
      "kimi",
      "dsh-acp",
      "pi-acp",
    ]);
    for (const entry of OPENMA_ACP_HARNESS_CATALOG) {
      expect(entry.version).toMatch(/^\d+\.\d+\.\d+/);
      if (entry.source.type === "npm") {
        expect(entry.id === "dsh-acp" || entry.id === "pi-acp").toBe(true);
        expect(entry.source.package.startsWith("@openma/")).toBe(true);
      } else {
        expect(entry.source.type).toBe("registry");
        expect(entry.source).toEqual({ type: "registry" });
      }
    }
  });
});
