import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function releaseIdentity(tag, version) {
  const match = /^v((0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-beta\.(0|[1-9]\d*))?)$/.exec(tag);
  if (!match || match[1] !== version) throw new Error("Release tag must match the stable or beta package version");
  return { version, channel: match[5] === undefined ? "latest" : "beta", branch: `release/${match[2]}.${match[3]}` };
}
export function validatePublishedIntegrity(expected, actual) {
  if (!expected || expected !== actual) throw new Error("Published npm artifact differs from the verified tarball");
}
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
function output(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}
function validate() {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const identity = releaseIdentity(process.env.GITHUB_REF_NAME, pkg.version);
  const sha = git("rev-parse", "HEAD");
  git("fetch", "origin", "+refs/heads/main:refs/remotes/origin/main", `+refs/heads/${identity.branch}:refs/remotes/origin/${identity.branch}`);
  git("merge-base", "--is-ancestor", sha, `origin/${identity.branch}`);
  const base = git("merge-base", sha, "origin/main");
  // Require an actual successful main push run, not a PR merge ref or a tag run.
  for (const workflow of ["ci.yml", "ci-heavy.yml"]) {
    const path = `repos/${process.env.GITHUB_REPOSITORY}/actions/workflows/${workflow}/runs?head_sha=${base}&branch=main&event=push&per_page=100`;
    const runs = JSON.parse(execFileSync("gh", ["api", path], { encoding: "utf8" })).workflow_runs;
    const run = runs.find(run => run.head_sha === base && run.conclusion === "success");
    if (!run) {
      throw new Error(`Release base ${base} needs successful main ${workflow} verification`);
    }
    const jobs = JSON.parse(execFileSync("gh", ["api", `repos/${process.env.GITHUB_REPOSITORY}/actions/runs/${run.id}/jobs?per_page=100`], { encoding: "utf8" })).jobs;
    const required = workflow === "ci.yml" ? ["verify"] : ["verify-windows", "verify-chat-ui-surface"];
    for (const name of required) {
      if (!jobs.some(job => job.name === name && job.conclusion === "success")) {
        throw new Error(`Main base ${base}: ${name} must pass (skipped is not verification)`);
      }
    }
  }
  const environment = JSON.parse(execFileSync("gh", ["api", `repos/${process.env.GITHUB_REPOSITORY}/environments/production`], { encoding: "utf8" }));
  if (!environment.protection_rules?.some(rule => rule.type === "required_reviewers" && rule.reviewers?.length > 0)) {
    throw new Error("Configure required reviewers for the production environment before publishing");
  }
  // Stable notes cover the whole release line, including beta candidates.
  readFileSync(`docs/releases/v${pkg.version.replace(/-beta\.\d+$/, "")}.md`, "utf8");
  for (const [key, value] of Object.entries({ ...identity, sha, base })) output(key, value);
}
function record() {
  const [pack] = JSON.parse(readFileSync("pack.json", "utf8"));
  const integrity = `sha512-${createHash("sha512").update(readFileSync(pack.filename)).digest("base64")}`;
  validatePublishedIntegrity(pack.integrity, integrity);
  const identity = releaseIdentity(process.env.GITHUB_REF_NAME, pack.version);
  if (pack.name !== "@openma/common" || !/^openma-common-[0-9A-Za-z.-]+\.tgz$/.test(pack.filename)) throw new Error("Unexpected package archive identity");
  const manifest = { ...identity, sha: git("rev-parse", "HEAD"), filename: pack.filename, integrity };
  writeFileSync("release-manifest.json", JSON.stringify(manifest, null, 2) + "\n");
  output("filename", pack.filename);
}
function verify() {
  const manifest = JSON.parse(readFileSync("release-manifest.json", "utf8"));
  if (!/^openma-common-[0-9A-Za-z.-]+\.tgz$/.test(manifest.filename)) throw new Error("Invalid package archive path");
  const identity = releaseIdentity(process.env.GITHUB_REF_NAME, manifest.version);
  if (manifest.sha !== process.env.GITHUB_SHA || identity.channel !== manifest.channel) throw new Error("Artifact SHA/channel mismatch");
  validatePublishedIntegrity(manifest.integrity, `sha512-${createHash("sha512").update(readFileSync(manifest.filename)).digest("base64")}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const commands = { validate, record, verify };
  const command = commands[process.argv[2]];
  if (!command) throw new Error("Expected validate, record or verify");
  command();
}
