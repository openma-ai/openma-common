import { describe, expect, it } from "vitest";
import { releaseIdentity, validatePublishedIntegrity } from "../scripts/release-pipeline.mjs";

describe("release candidate identity", () => {
  it.each([
    ["v0.14.0-beta.1", "0.14.0-beta.1", "beta"],
    ["v0.14.0", "0.14.0", "latest"],
  ])("binds %s to its package version and channel", (tag, version, channel) => {
    expect(releaseIdentity(tag, version)).toEqual({ version, channel, branch: "release/0.14" });
  });
  it.each([
    ["v0.14.0-beta.1", "0.14.0"],
    ["v0.14.0-canary.1", "0.14.0-canary.1"],
    ["v0.14.0-rc.1", "0.14.0-rc.1"],
    ["v0.14.0", "0.13.0"],
    ["v01.14.0", "01.14.0"],
  ])("rejects invalid or mismatched identity %s", (tag, version) => {
    expect(() => releaseIdentity(tag, version)).toThrow();
  });
  it("does not treat an existing different npm artifact as success", () => {
    expect(() => validatePublishedIntegrity("sha512-one", "sha512-two")).toThrow(/differs/);
    expect(() => validatePublishedIntegrity("sha512-one", undefined)).toThrow();
    expect(() => validatePublishedIntegrity("sha512-one", "sha512-one")).not.toThrow();
  });
});

describe("release workflow wiring", () => {
  it("gates packaging on both verification workflows and publishes the saved artifact", async () => {
    const { readFileSync } = await import("node:fs");
    const workflow = readFileSync(new URL("../.github/workflows/release-tag.yml", import.meta.url), "utf8");
    expect(workflow).toContain("needs: [verify, heavy]");
    expect(workflow).toContain("needs: [candidate, package]");
    expect(workflow).toContain("node scripts/release-pipeline.mjs verify");
    expect(workflow).toContain("actions/download-artifact@v4");
    const heavy = readFileSync(new URL("../.github/workflows/ci-heavy.yml", import.meta.url), "utf8");
    expect(heavy.match(/startsWith\(github.ref, 'refs\/tags\/v'\)/g)).toHaveLength(2);
  });
});

describe("browser runner compatibility", () => {
  it("pins the browser surface job to the supported Ubuntu image", async () => {
    const { readFileSync } = await import("node:fs");
    const workflow = readFileSync(new URL("../.github/workflows/ci-heavy.yml", import.meta.url), "utf8");
    const job = workflow.split("  verify-chat-ui-surface:")[1]!.split("  report-failure:")[0]!;
    expect(job).toContain("runs-on: ubuntu-24.04");
  });
});
