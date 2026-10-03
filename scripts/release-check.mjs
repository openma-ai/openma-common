/**
 * Release gate for @openma/common.
 *
 * Pull requests always print `::notice::` for each pull request merged to the
 * base branch since the previous `v*` tag. Those notices do not fail CI.
 *
 * When `package.json` `version` changes, the same command fails unless:
 * - `docs/releases/vX.Y.Z.md` exists and mentions every `(#N)` from those
 *   commit subjects (`#100` does not count as `#10`)
 * - `docs/releases/unreleased-*.md` is gone
 * - README pins `github:openma-ai/openma-common#vX.Y.Z`
 * - the bump is a patch, or the PR has `release:minor` / `release:major`
 * - `pnpm build` leaves `dist/` with no diff
 *
 * `node scripts/release-check.mjs --tag` checks a `v*` tag push: the tag
 * equals `v` plus `package.json` version, the release notes exist, and
 * `dist/` is clean after `pnpm build`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PIN = /github:openma-ai\/openma-common#v(\d+\.\d+\.\d+)/g;
const UNRELEASED_NOTE = /^unreleased-.*\.md$/;

export function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`Version must be x.y.z, got ${JSON.stringify(version)}`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    raw: version,
  };
}

/** @returns {"major" | "minor" | "patch" | "downgrade" | "same"} */
export function classifyBump(previous, next) {
  if (next.major !== previous.major) return next.major > previous.major ? "major" : "downgrade";
  if (next.minor !== previous.minor) return next.minor > previous.minor ? "minor" : "downgrade";
  if (next.patch !== previous.patch) return next.patch > previous.patch ? "patch" : "downgrade";
  return "same";
}

/** Pull request numbers from GitHub squash subjects, in order. `(#10)` only. */
export function extractPrNumbers(message) {
  const numbers = [];
  const re = /\(#(\d+)\)/g;
  for (const match of message.matchAll(re)) {
    numbers.push(Number(match[1]));
  }
  return numbers;
}

export function mentionsPr(notes, number) {
  return new RegExp(`(^|[^0-9])#${number}(?![0-9])`).test(notes);
}

/** @param {readonly number[]} numbers */
export function missingPrNumbers(notes, numbers) {
  return numbers.filter((number) => !mentionsPr(notes, number));
}

export function readmePinErrors(readme, version) {
  const found = [...readme.matchAll(PIN)].map((match) => match[1]);
  if (found.length === 0) {
    return [`README.md does not pin github:openma-ai/openma-common#v${version}`];
  }
  return found
    .filter((pin) => pin !== version)
    .map((pin) => `README.md pins github:openma-ai/openma-common#v${pin}, expected #v${version}`);
}

/** @param {readonly string[]} names */
export function unreleasedNoteNames(names) {
  return names.filter((name) => UNRELEASED_NOTE.test(name));
}

/**
 * @param {"major" | "minor" | "patch" | "downgrade" | "same"} bump
 * @param {readonly string[]} labels
 */
export function bumpLabelErrors(bump, labels, previous, next) {
  const present = new Set(labels);
  if (bump === "patch" || bump === "same") return [];
  if (bump === "minor") {
    if (present.has("release:minor")) return [];
    return [`version ${previous} -> ${next} is a minor bump; add the release:minor label or keep the bump to a patch`];
  }
  if (bump === "major") {
    if (present.has("release:major")) return [];
    return [`version ${previous} -> ${next} is a major bump; add the release:major label or keep the bump to a patch`];
  }
  return [`version ${previous} -> ${next} does not increase the version`];
}

export function uniquePrNumbers(commits) {
  const seen = new Set();
  const numbers = [];
  for (const commit of commits) {
    for (const number of extractPrNumbers(commit.subject)) {
      if (seen.has(number)) continue;
      seen.add(number);
      numbers.push(number);
    }
  }
  return numbers;
}

export function unreleasedNotices({ previousTag, baseRevision, commits }) {
  if (!previousTag) {
    return [`::notice::No previous v* tag is reachable from ${baseRevision}; unreleased pull requests were not listed.`];
  }
  const notices = [];
  const seen = new Set();
  for (const commit of commits) {
    const numbers = extractPrNumbers(commit.subject);
    if (numbers.length === 0) {
      notices.push(`::notice::Unreleased commit ${commit.sha.slice(0, 7)} on ${baseRevision} since ${previousTag} has no (#N): ${commit.subject}`);
      continue;
    }
    for (const number of numbers) {
      if (seen.has(number)) continue;
      seen.add(number);
      notices.push(`::notice::Unreleased PR #${number} on ${baseRevision} since ${previousTag}: ${commit.subject}`);
    }
  }
  return notices;
}

export function evaluateVersionBump({
  previousVersion,
  nextVersion,
  labels,
  notes,
  notesPath,
  readme,
  unreleasedNames,
  mergedPrNumbers,
  previousTag,
  baseRevision,
}) {
  const errors = [];
  let previous;
  let next;
  try {
    previous = parseVersion(previousVersion);
  } catch (error) {
    errors.push(`${baseRevision} package.json: ${error instanceof Error ? error.message : String(error)}`);
    return errors;
  }
  try {
    next = parseVersion(nextVersion);
  } catch (error) {
    errors.push(`package.json: ${error instanceof Error ? error.message : String(error)}`);
    return errors;
  }
  const bump = classifyBump(previous, next);
  errors.push(...bumpLabelErrors(bump, labels, previous.raw, next.raw));
  if (notes == null) errors.push(`${notesPath} does not exist`);
  if (!previousTag) errors.push(`no v* tag is reachable from ${baseRevision}`);
  for (const number of missingPrNumbers(notes ?? "", mergedPrNumbers)) {
    errors.push(`${notesPath} does not mention #${number}`);
  }
  for (const name of unreleasedNoteNames(unreleasedNames)) {
    errors.push(`docs/releases/${name} must not remain when the package version changes`);
  }
  errors.push(...readmePinErrors(readme, next.raw));
  return errors;
}

function git(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || result.error?.message || "").trim();
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
  return (result.stdout ?? "").replace(/\n$/, "");
}

function gitOk(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return result.status === 0 ? (result.stdout ?? "").trim() : null;
}

function baseRevision() {
  if (process.env.GITHUB_BASE_REF) return `origin/${process.env.GITHUB_BASE_REF}`;
  if (gitOk(["rev-parse", "--verify", "--quiet", "origin/main"])) return "origin/main";
  if (gitOk(["rev-parse", "--verify", "--quiet", "main"])) return "main";
  throw new Error("Cannot find the base branch (origin/main).");
}

function versionAt(rev) {
  const parsed = JSON.parse(git(["show", `${rev}:package.json`]));
  if (typeof parsed.version !== "string") {
    throw new Error(`${rev}:package.json has no string version`);
  }
  return parsed.version;
}

function headVersion() {
  const parsed = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  if (typeof parsed.version !== "string") throw new Error("package.json has no string version");
  return parsed.version;
}

function latestTag(rev) {
  return gitOk(["describe", "--tags", "--abbrev=0", "--match", "v*", rev]);
}

function commitsSince(tag, rev) {
  const raw = git(["log", "--reverse", "--format=%H%x09%s", `${tag}..${rev}`]);
  if (!raw) return [];
  return raw.split("\n").filter(Boolean).map((line) => {
    const tab = line.indexOf("\t");
    if (tab === -1) return { sha: line, subject: "" };
    return { sha: line.slice(0, tab), subject: line.slice(tab + 1) };
  });
}

function releaseLabels() {
  return (process.env.RELEASE_LABELS ?? "").split(",").map((label) => label.trim()).filter(Boolean);
}

function emitNotice(line) {
  const message = line.startsWith("::notice::") ? line.slice("::notice::".length) : line;
  const escaped = process.env.GITHUB_ACTIONS === "true"
    ? message.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")
    : message;
  console.log(`::notice::${escaped}`);
}

function fail(title, errors) {
  console.error(`${title}:`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

function assertCleanDist() {
  console.log("Running pnpm build to verify dist/.");
  const build = spawnSync("pnpm", ["build"], { cwd: root, stdio: "inherit" });
  if (build.error) {
    console.error(build.error.message);
    process.exit(1);
  }
  if (build.status !== 0) process.exit(build.status ?? 1);
  const diff = spawnSync("git", ["diff", "--exit-code", "--", "dist"], {
    cwd: root,
    encoding: "utf8",
  });
  const status = spawnSync("git", ["status", "--porcelain", "--", "dist"], {
    cwd: root,
    encoding: "utf8",
  });
  if (diff.status !== 0 || (status.stdout ?? "").trim()) {
    console.error("dist/ is not clean after pnpm build:");
    if (diff.stdout) console.error(diff.stdout);
    if (diff.stderr) console.error(diff.stderr);
    if ((status.stdout ?? "").trim()) console.error(status.stdout);
    process.exit(1);
  }
  console.log("dist/ has no diff after pnpm build.");
}

function checkPullRequest() {
  const base = baseRevision();
  const previousTag = latestTag(base);
  const commits = previousTag ? commitsSince(previousTag, base) : [];
  const notices = unreleasedNotices({ previousTag, baseRevision: base, commits });
  for (const notice of notices) emitNotice(notice);
  if (notices.length === 0 && previousTag) {
    console.log(`No unreleased changes on ${base} since ${previousTag}.`);
  }

  const previousVersion = versionAt(base);
  const nextVersion = headVersion();
  console.log(`Base ${base} is ${previousVersion}; this tree is ${nextVersion}; previous tag ${previousTag ?? "(none)"}.`);
  if (previousVersion === nextVersion) {
    console.log(`package.json version is unchanged (${nextVersion}); release gate skipped.`);
    return;
  }

  const notesPath = `docs/releases/v${nextVersion}.md`;
  const notesFile = path.join(root, notesPath);
  const releaseDir = path.join(root, "docs/releases");
  const errors = evaluateVersionBump({
    previousVersion,
    nextVersion,
    labels: releaseLabels(),
    notes: existsSync(notesFile) ? readFileSync(notesFile, "utf8") : null,
    notesPath,
    readme: readFileSync(path.join(root, "README.md"), "utf8"),
    unreleasedNames: existsSync(releaseDir) ? readdirSync(releaseDir) : [],
    mergedPrNumbers: uniquePrNumbers(commits),
    previousTag,
    baseRevision: base,
  });
  if (errors.length > 0) fail("release check failed", errors);
  console.log(`Release notes, README pin, and version bump ${previousVersion} -> ${nextVersion} passed.`);
  assertCleanDist();
  console.log(`release check passed for ${previousVersion} -> ${nextVersion}.`);
}

function tagName() {
  const ref = process.env.GITHUB_REF ?? "";
  if (ref.startsWith("refs/tags/")) return ref.slice("refs/tags/".length);
  if (process.argv.includes("--tag") && process.env.GITHUB_REF_NAME && !ref) {
    return process.env.GITHUB_REF_NAME;
  }
  return gitOk(["describe", "--tags", "--exact-match", "HEAD"]) ?? "";
}

function checkTag() {
  const version = headVersion();
  const tag = tagName();
  const notesPath = `docs/releases/v${version}.md`;
  const errors = [];
  try {
    parseVersion(version);
  } catch (error) {
    errors.push(`package.json: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (tag !== `v${version}`) {
    errors.push(`tag ${tag || "(missing)"} does not match package.json version ${version} (expected v${version})`);
  }
  if (!existsSync(path.join(root, notesPath))) errors.push(`${notesPath} does not exist`);
  if (errors.length > 0) fail("release tag check failed", errors);
  console.log(`Tag ${tag} matches package.json ${version}, and ${notesPath} exists.`);
  assertCleanDist();
  console.log("release tag check passed.");
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isDirectRun()) {
  try {
    if (process.argv.includes("--tag")) checkTag();
    else checkPullRequest();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
