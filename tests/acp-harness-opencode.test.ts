import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { resolveNpmAcpRelease } from "../src/acp-artifacts/index.js";
import { catalogHarnessById } from "../src/acp-harnesses/catalog.js";
import { installAcpHarnesses } from "../src/acp-harnesses/install.js";
import { runCaptured } from "./run-command.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

describe("opencode-ai catalog harness", () => {
  it("resolves the opencode bin from npm metadata", async () => {
    const entry = catalogHarnessById("opencode");
    expect(entry?.source).toEqual({ type: "npm", package: "opencode-ai" });
    const release = await resolveNpmAcpRelease({
      id: "opencode",
      version: "1.18.34",
      package: "opencode-ai",
    });
    expect(release.bin).toBe("opencode");
  });

  it("installs and launches the Linux opencode binary on CI", async () => {
    if (process.platform !== "linux") return;
    const root = await mkdtemp(join(tmpdir(), "acp-opencode-"));
    roots.push(root);
    const entry = catalogHarnessById("opencode");
    if (!entry) throw new Error("missing catalog entry");
    const results = await installAcpHarnesses({
      root,
      catalog: [entry],
      ids: ["opencode"],
      nodePath: process.execPath,
    });
    const installed = results[0];
    expect(installed).toBeDefined();
    expect(installed!.args).toEqual(["acp"]);
    const version = (await runCaptured(installed!.command, ["--version"])).stdout.trim();
    expect(version).toBe("1.18.34");
  }, 120_000);
});
