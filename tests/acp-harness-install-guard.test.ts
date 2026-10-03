import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OPENMA_ACP_HARNESS_CATALOG } from "../src/acp-harnesses/catalog.js";

const INSTALL_SOURCE = join(process.cwd(), "src/acp-harnesses/install.ts");

describe("ACP harness install generic path", () => {
  it("does not branch on specific harness ids in install code", () => {
    const source = readFileSync(INSTALL_SOURCE, "utf8");
    expect(source).not.toMatch(/\bswitch\s*\(\s*entry\.id\s*\)/);
    expect(source).not.toMatch(/\bif\s*\(\s*entry\.id\s*===/);
    for (const { id } of OPENMA_ACP_HARNESS_CATALOG) {
      expect(source.includes(`"${id}"`)).toBe(false);
      expect(source.includes(`'${id}'`)).toBe(false);
    }
  });
});
