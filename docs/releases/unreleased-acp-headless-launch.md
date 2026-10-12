# Unreleased: headless launch recipes and pinned harness installs

Additive. No exports were removed, so this is a minor change under the
compatibility policy (new export, new optional fields). One product-path
behaviour changes on Windows only, listed last.

## Changes

- New export `@openma/common/acp-harnesses/headless-launch`:
  `buildAcpHeadlessLaunch(entry, options)` builds the arguments and variables
  for one unattended run from `KnownAgentEntry.headless`. Options are generic
  (`sessionDir`, `agentDir`, `trustProject`, `provider`, `model`,
  `thinkingLevel`). `unsupported` lists every option the launch does not
  carry, including a `provider` or `thinkingLevel` given without a `model`.
- `KnownAgentEntry` gains optional `headless` and `pinned`. The `pi-acp` entry
  carries both: the openma-pi-acp flags and `PI_CODING_AGENT_DIR`, and exact
  versions for `@openma/pi-acp` and the `@earendil-works/*` Pi SDK packages.
- `installPinnedAcpHarness({ entry, binDir, ... })` installs `entry.pinned`
  with npm `overrides`, verifies the installed versions and returns them in
  `InstallResult.dependencies`.
- Pinned installs have their own launcher (`<shim>-pinned`) and state
  (`registry/<id>-pinned/`), from `pinnedAcpHarnessPaths`. They do not
  overwrite a product install that shares the bin directory.
- Windows: the pinned launcher is a `.cmd` file; `acpLauncherInvocation`
  returns how to start it. The pinned install tests run on Windows CI.
- `readAcpHarnessPinState({ entry, shimPath })` reports whether an existing
  pinned install matches the pins. It throws on pins that are not exact
  versions, as the installer does.
- `installAcpRegistryAgent` accepts `npmOverrides` for npm installs and throws
  when the harness installs as a binary or through uvx on this platform.
- Pins are ordered by code point (not `localeCompare`), so the install
  directory hash does not depend on the machine's locale.
- CI measures coverage and uploads it to Codecov; `codecov.yml` requires 100%
  patch coverage.
- Windows product installs: `npm` given as a bare name or `.cmd` path now runs
  through `cmd.exe` (it could not start before). Hosts that pass an executable
  path as `npmCommand` are unaffected.

Rename this file to `vX.Y.Z.md` in the release commit.
