import { describe, expect, it } from "vitest";
import {
  DEFAULT_ACP_HARNESSES,
  cloneAcpHarnesses,
  normalizeAcpHarnesses,
} from "../src/acp-harnesses/index.js";

describe("ACP harness catalog", () => {
  it("provides the shared OpenMA desktop harness defaults", () => {
    expect(DEFAULT_ACP_HARNESSES.map(({ id }) => id)).toEqual([
      "claude-acp",
      "codex-acp",
      "gemini",
      "opencode",
      "kimi",
    ]);
    expect(DEFAULT_ACP_HARNESSES.find(({ id }) => id === "gemini")).toMatchObject({
      command: "gemini",
      args: ["--acp"],
    });
  });

  it("normalizes persisted harnesses and returns detached copies", () => {
    const input = [{
      id: "custom",
      label: "Custom",
      command: "custom-acp",
      args: ["serve"],
      env: { TOKEN: "value" },
    }];
    const normalized = normalizeAcpHarnesses(input);
    const cloned = cloneAcpHarnesses(normalized);

    expect(normalized).toEqual(input);
    expect(normalizeAcpHarnesses([...input, input[0]])).toHaveLength(1);
    expect(cloned).toEqual(input);
    expect(cloned).not.toBe(normalized);
    expect(cloned[0]?.args).not.toBe(normalized[0]?.args);
    expect(cloned[0]?.env).not.toBe(normalized[0]?.env);
  });

  it("rejects malformed persisted entries", () => {
    expect(normalizeAcpHarnesses([
      { id: "", label: "Missing id", command: "x", args: [] },
      { id: "broken", label: "Broken", command: "x", args: "--acp" },
      null,
    ])).toEqual([]);
  });
});
