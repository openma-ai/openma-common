# Unreleased: shared custom ACP agent store under `~/.oma`

Additive. No exports were removed, so this is a minor change under the
compatibility policy (new subpath export). Closes #36.

## Changes

- New export `@openma/common/acp-harnesses/custom-agents`: the shared store
  for custom ACP agent definitions under `~/.oma`, previously duplicated as
  Backchat `config.toml` `[[agents]]` overrides and Martty `settings.json`
  `harnesses[]` rows.
- Canonical file: `<oma>/agents.json`, one definition per agent in the
  `AcpHarnessSpec` shape (`id`, `label`, `command`, `args`, optional `env`).
  `readCustomAcpAgentsFile`, `writeCustomAcpAgentsFile` (atomic
  temp-file + rename), `upsertCustomAcpAgent`, and `removeCustomAcpAgent`
  read and write it.
- `readCustomAcpAgents(omaDir)` merges `agents.json` with compatible reads
  of `config.toml` `[[agents]]` rows carrying `command_override` and
  `settings.json` `harnesses[]` rows, deduplicated by `id` — existing
  Backchat and Martty configurations keep working. Adapters
  (`customAcpAgentsFromConfigToml`, `customAcpAgentsFromSettingsJson`,
  `mergeCustomAcpAgents`) are exported for consumers that already hold a
  parsed settings document.
- Versions the user writes in `args` are kept exactly as written; nothing
  rewrites a pin such as `@openma/pi-acp@beta`. Runner flags Martty used to
  inject into its own stored `npx` rows (`--yes`, `--prefer-offline`) are
  still normalized away on read of `settings.json` only.
- `validateCustomAcpAgent` throws with a reason for write paths;
  `normalizeCustomAcpAgent(s)` drops malformed rows for stored reads, so one
  bad row cannot break a whole file.

Rename this file to `vX.Y.Z.md` in the release commit.
