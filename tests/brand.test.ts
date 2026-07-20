import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  COMMON_THEME_TOKEN_NAMES,
  OPENMA_BRAND_RGB,
  commonDarkTokens,
  commonLightTokens,
} from "../src/brand/index.js";

describe("OpenMA brand contract", () => {
  it("keeps light and dark themes on the complete shared token contract", () => {
    expect(Object.keys(commonLightTokens).sort()).toEqual([...COMMON_THEME_TOKEN_NAMES].sort());
    expect(Object.keys(commonDarkTokens).sort()).toEqual([...COMMON_THEME_TOKEN_NAMES].sort());
    expect(commonLightTokens["bg-bubble"]).toBe("oklch(0.955 0.0015 95)");
    expect(commonDarkTokens["shadow-input-rest"]).toContain("rgb(0 0 0 / 0.3)");
    expect(OPENMA_BRAND_RGB).toEqual([248, 79, 50]);
  });

  it("keeps CSS variables synchronized with the TypeScript token maps", () => {
    const css = readFileSync(resolve(import.meta.dirname, "../src/brand/tokens.css"), "utf8");
    for (const [name, value] of Object.entries(commonLightTokens)) {
      expect(css).toContain(`--${name}: ${value};`);
    }
    for (const [name, value] of Object.entries(commonDarkTokens)) {
      expect(css.slice(css.indexOf(".dark"))).toContain(`--${name}: ${value};`);
    }
  });

  it("ships the canonical OpenMA vector mark", () => {
    const svg = readFileSync(resolve(import.meta.dirname, "../src/brand/openma-logo-mark.svg"), "utf8");
    expect(svg).toContain('viewBox="240 244 548 454"');
    expect(svg).toContain('<circle cx="535" cy="520" r="42"/>');
    expect(svg.match(/<path /g)).toHaveLength(3);
  });
});
