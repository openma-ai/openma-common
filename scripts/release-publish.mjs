import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { validatePublishedIntegrity } from "./release-pipeline.mjs";

const manifest = JSON.parse(readFileSync("release-manifest.json", "utf8"));
if (process.env.RELEASE_CHANNEL !== manifest.channel) throw new Error("Release channel mismatch");
// Read the full registry document so a missing candidate is distinguishable from
// a network/auth failure. Do not treat every npm-view error as 'not published'.
const response = await fetch("https://registry.npmjs.org/@openma%2fcommon", { signal: AbortSignal.timeout(30_000) });
if (!response.ok) throw new Error(`npm registry read failed: HTTP ${response.status}`);
const metadata = await response.json();
const existing = metadata.versions[manifest.version];
if (existing) {
  validatePublishedIntegrity(manifest.integrity, existing.dist?.integrity);
  console.log(`Verified existing immutable @openma/common@${manifest.version}; no channel mutation on retry`);
} else {
  // Avoid a late approval/re-run moving beta/latest backwards. Stable and beta
  // have separate channels and are compared numerically, never lexically.
  const current = metadata["dist-tags"][manifest.channel];
  if (current) {
    const numbers = value => value.replace("-beta.", ".").split(".").map(Number);
    const a = numbers(current), b = numbers(manifest.version);
    if (a.some(Number.isNaN) || b.some(Number.isNaN)) throw new Error(`Cannot compare channel version ${current}`);
    let comparison = 0;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if ((a[i] ?? 0) !== (b[i] ?? 0)) { comparison = (a[i] ?? 0) - (b[i] ?? 0); break; }
    }
    if (comparison >= 0) throw new Error(`Refusing to move ${manifest.channel} backwards from ${current}`);
  }
  execFileSync("npm", ["publish", manifest.filename, "--ignore-scripts", "--access", "public", "--provenance", "--tag", manifest.channel], { stdio: "inherit" });
}
// Verify the registry artifact identity after publication as well.
const integrity = JSON.parse(execFileSync("npm", ["view", `@openma/common@${manifest.version}`, "dist.integrity", "--json"], { encoding: "utf8" }));
validatePublishedIntegrity(manifest.integrity, integrity);
