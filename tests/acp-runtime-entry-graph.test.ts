// The acp-runtime entry is imported by hosts without child processes, such as
// Cloudflare Workers. Only the Node-specific subpaths (node-spawner, probe's
// default spawner) may reach node:child_process, and only lazily.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

/** Value imports and re-exports; `import type` / `export type` and dynamic import() are skipped. */
function staticSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /^\s*(import|export)\s+(?!type\b)(?:[^"';]*?\bfrom\s+)?["']([^"']+)["']/gm;
  for (const match of source.matchAll(pattern)) specifiers.push(match[2]!);
  return specifiers;
}

function staticGraph(entry: string): { files: Set<string>; external: Set<string> } {
  const files = new Set<string>();
  const external = new Set<string>();
  const visit = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    for (const specifier of staticSpecifiers(readFileSync(file, "utf8"))) {
      if (specifier.startsWith(".")) {
        visit(resolve(dirname(file), specifier).replace(/\.js$/, ".ts"));
      } else {
        external.add(specifier);
      }
    }
  };
  visit(entry);
  return { files, external };
}

describe("acp-runtime entry module graph", () => {
  it("does not statically import node:child_process", () => {
    const { files, external } = staticGraph(resolve(src, "acp-runtime/index.ts"));
    expect(files).toContain(resolve(src, "acp-runtime/probe.ts"));
    expect(files).not.toContain(resolve(src, "acp-runtime/spawners/node.ts"));
    expect(external).not.toContain("node:child_process");
    expect(external).not.toContain("child_process");
  });

  it("the walker sees the node-spawner subpath's child_process import", () => {
    const { external } = staticGraph(resolve(src, "acp-runtime/spawners/node.ts"));
    expect(external).toContain("node:child_process");
  });
});
