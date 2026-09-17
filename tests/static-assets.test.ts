import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("static asset build", () => {
  it("updates file-package consumers without breaking their hard links", () => {
    const fixture = mkdtempSync(join(tmpdir(), "openma-static-assets-"));
    try {
      for (const directory of ["src/brand", "src/chat-ui", "dist/brand", "dist/chat-ui", "consumer"]) {
        mkdirSync(join(fixture, directory), { recursive: true });
      }
      const assets = [
        ["brand/tokens.css", "new tokens"],
        ["brand/website.css", "new website theme"],
        ["brand/openma-logo-mark.svg", "new mark"],
        ["chat-ui/styles.css", "new chat styles"],
      ] as const;
      for (const [asset, contents] of assets) {
        writeFileSync(join(fixture, "src", asset), contents);
        writeFileSync(join(fixture, "dist", asset), "stale");
      }

      const builtStyles = join(fixture, "dist/chat-ui/styles.css");
      const consumerStyles = join(fixture, "consumer/styles.css");
      linkSync(builtStyles, consumerStyles);
      const inode = statSync(consumerStyles).ino;

      const result = spawnSync(
        process.execPath,
        [resolve(import.meta.dirname, "../scripts/copy-static-assets.mjs")],
        { cwd: fixture, encoding: "utf8" },
      );

      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(consumerStyles, "utf8")).toBe("new chat styles");
      expect(statSync(builtStyles).ino).toBe(inode);
      expect(statSync(consumerStyles).ino).toBe(inode);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
