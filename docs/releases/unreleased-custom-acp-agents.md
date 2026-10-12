### Shared custom ACP agent store

New `@openma/common/acp-harnesses/custom-agents` module: reading, validating,
and writing custom ACP agent definitions that Backchat and Martty share.

The single shared store is `~/.oma/config.toml` `[[agents]]` — Backchat's
per-agent override format (`id`, `enabled`, `env` pairs, plus
`command_override` / `args_override` / `label_override` for custom agents).
Definitions surface in the canonical shape `{id, label, command, args, env}`
plus the store's `enabled` flag so a disabled agent stays disabled. Martty's
legacy `~/.oma/settings.json` `harnesses[]` still read through for
compatibility, and every write migrates them into `config.toml`, so removed
definitions cannot resurface.

Writes refuse to touch a `config.toml` that does not parse, preserve all
unrelated keys and sections, and keep user-written argument versions (for
example `@openma/pi-acp@beta`) exactly as written.

Part of openma-ai/openma-common#36.
