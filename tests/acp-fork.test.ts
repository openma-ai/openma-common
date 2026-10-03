import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACP_INCLUSIVE_FORK_CAPABILITY,
  acpForkPointsFromMessages,
  acpInclusiveForkCapabilityMeta,
  forkSupport,
} from "../src/acp-fork/index.js";
import {
  acpForkPointsFromMessages as acpForkPointsFromMessagesRuntime,
  forkSupport as forkSupportRuntime,
} from "../src/acp-runtime/fork-support.js";

describe("@openma/common/acp-fork", () => {
  it("re-exports the same client helpers from acp-runtime", () => {
    expect(forkSupportRuntime).toBe(forkSupport);
    expect(acpForkPointsFromMessagesRuntime).toBe(acpForkPointsFromMessages);
  });

  it("does not import node: built-ins in its source tree", () => {
    const root = resolve(import.meta.dirname, "../src/acp-fork");
    const files: string[] = [];
    const walk = (directory: string) => {
      for (const name of readdirSync(directory)) {
        const path = join(directory, name);
        if (statSync(path).isDirectory()) {
          walk(path);
          continue;
        }
        if (path.endsWith(".ts")) files.push(path);
      }
    };
    walk(root);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/\bfrom\s+["']node:/);
      expect(source, file).not.toMatch(/\bimport\s+["']node:/);
    }
  });

  it("exports the frozen inclusive capability and nested meta wrapper", () => {
    expect(ACP_INCLUSIVE_FORK_CAPABILITY).toEqual({ version: 1, inclusive: true });
    expect(Object.isFrozen(ACP_INCLUSIVE_FORK_CAPABILITY)).toBe(true);
    expect(acpInclusiveForkCapabilityMeta()).toEqual({
      jetbrains: { air: { fork: ACP_INCLUSIVE_FORK_CAPABILITY } },
    });
  });

  it("counts identical assistant text in the prefix", () => {
    expect(acpForkPointsFromMessages([
      { messageId: "a", text: "hello" },
      { messageId: "b", text: "world" },
      { messageId: "c", text: "hello" },
    ])).toEqual([
      { messageId: "a", messageText: "hello", messageOccurrence: 1 },
      { messageId: "b", messageText: "world", messageOccurrence: 1 },
      { messageId: "c", messageText: "hello", messageOccurrence: 2 },
    ]);
  });
});
