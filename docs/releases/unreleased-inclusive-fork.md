# Unreleased: inclusive ACP message fork

Draft notes for the next release. This change does not bump `package.json`,
publish to npm, move a tag, or create a GitHub release.

## Planned changes

- `forkSupport()` is the client entry for whole-session and inclusive message
  fork. Clients stop hardcoding harness names and versions.
- Agents advertise `agentCapabilities._meta.jetbrains.air.fork` as
  `{ "version": 1, "inclusive": true }` next to `sessionCapabilities.fork`.
- `SessionOptions.forkPoint` deep-merges `jetbrains.air.fork` v1 into the
  `session/fork` request. The runtime refuses the fork when the agent cannot
  fork from a message.
- `acpForkPointsFromMessages()` numbers duplicate assistant text for clients.
- `acpForkRequestMeta()` is unchanged and still builds the v1 request meta.

See [fork-support.md](../fork-support.md).
