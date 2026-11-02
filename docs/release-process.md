# Batch releases: release branches, beta and latest

Main is the integration branch, not an automatic publishing channel. No package
is published on PR merge. PR previews and main canaries are not enabled here.

## Cut a candidate

1. Choose a fixed main SHA whose push runs of **CI and CI heavy both succeeded**.
   Do not use a PR head/merge-ref green as a substitute for main verification.
2. Create `release/<major>.<minor>` from it (e.g. `release/0.14`). Freeze features.
   Use reviewed PRs targeting that branch to set `package.json` to
   `0.14.0-beta.1`, update README's Git pin and `docs/releases/v0.14.0.md`, and
   commit current dist. A minor/major version bump needs the matching release label.
3. Push an immutable tag `v0.14.0-beta.1` at the chosen release-branch commit.
   Every changed candidate needs a new version/tag; never move tags or overwrite
   versions. Release branch CI also runs before tagging for fast feedback.

## Required tag pipeline

`release-tag.yml` validates the tag/version/channel, that the commit belongs to
its release branch, and that its main merge-base has successful main CI and
CI-heavy push runs. Keep release fixes on the release branch; do not merge new
main features into an active line. If main is merged in, the new merge-base must
also have green verification. Keep the branch until publication/retries finish.

The tag's **exact SHA** then runs Linux tests/typecheck/build, dist freshness,
coverage, performance, browser-bundle, Windows verify and browser UI-surface
checks. The heavy checks are a reusable workflow, with no docs-only skip for tags.
Cursor Cloud live remains advisory and is not a release prerequisite.

Only after all required checks pass, CI packs committed dist without rebuilding,
installs the actual archive into an isolated npm consumer, checks every export,
and imports JavaScript exports. It saves that tarball with SHA and SHA-512
integrity in `release-manifest.json` as an immutable run artifact (30 days).

The existing `production` environment is used for both beta and stable; configure
required reviewers in GitHub settings to enforce human approval. Candidate validation
fails closed if that environment has no reviewer rule. Workflow YAML
cannot create an approval rule. Publishing uses the existing OIDC trusted
publisher (`release-tag.yml`), verifies the downloaded artifact identity, and
publishes **that same tarball**, not a fresh checkout build:

- `*-beta.N` -> npm `beta`
- stable `X.Y.Z` -> npm `latest`

Retries verify integrity if the npm version already exists, rather than treating
any existing version as success. They do not move channels. New publication
refuses to move a channel numerically backwards. Production-environment reviewers
must reject obsolete queued candidates. GitHub concurrency is not a FIFO queue;
only intentionally selected tags should be submitted for publication.

## Beta failure and stable release

Consumers pin the exact beta version in their lockfiles and validate their own
integration. If it fails, land a reviewed fix on the release branch, port that
fix to main, and issue beta.2. Do not change latest or pull unrelated features
from main. Abandoned candidates leave the previous stable version intact.

After acceptance, change the version and README pin to `0.14.0` in a release PR
**targeting the release branch**. Tag that final commit `v0.14.0`. The entire
pipeline runs again for the stable artifact: moving a beta dist-tag does not turn
a prerelease version into a stable version.

After publication, sync release fixes and stable version/notes back to main via
a PR, then delete the short-lived release branch. Include the release:minor/release:major label when the sync changes that version
component, and keep notes/README consistent. Do not bypass tag verification.
Old maintenance lines are not enabled.

## Migration

Older tags used a weaker tag-only gate. New tags require a `release/X.Y` branch
and the full pipeline. Existing published versions remain immutable; do not
re-tag v0.13.0 to exercise this workflow. Validate this workflow PR with normal
CI and `full-ci`, then use the next real release line.
