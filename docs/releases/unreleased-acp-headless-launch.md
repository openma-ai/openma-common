# Unreleased: headless launch recipes and pinned harness installs

Additive. No exports were removed and product installs are unchanged, so this
is a minor change under the compatibility policy (new export, new optional
fields).

## Changes

- New export `@openma/common/acp-harnesses/headless-launch`:
  `buildAcpHeadlessLaunch(entry, options)` builds the arguments and variables
  for one unattended run from `KnownAgentEntry.headless`. Options are generic
  (`sessionDir`, `agentDir`, `trustProject`, `provider`, `model`,
  `thinkingLevel`); options a recipe cannot express are returned in
  `unsupported`.
- `KnownAgentEntry` gains optional `headless` and `pinned`. The `pi-acp` entry
  carries both: the openma-pi-acp flags and `PI_CODING_AGENT_DIR`, and exact
  versions for `@openma/pi-acp` and the `@earendil-works/*` Pi SDK packages.
- `installPinnedAcpHarness({ entry, binDir, ... })` installs `entry.pinned`.
  `installAcpRegistryAgent` accepts `npmOverrides`, writes them as npm
  `overrides` at the install prefix, verifies the installed versions, and
  records them in `install.json` and `InstallResult.dependencies`.
- `readAcpHarnessPinState({ entry, shimPath })` reports whether an existing
  install matches the pins.

Rename this file to `vX.Y.Z.md` in the release commit.
