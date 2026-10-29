# Unreleased — Composer chrome (chips, brand icons, run action)

- Export `AgentBrandIcon` / `normalizeAgentBrandId` (DeepSeek mark for `dsh-acp`).
- Export `ComposerChip`, `ComposerIconButton`, `ComposerRunAction` + class helpers.
- Export `DshPresetStandardIcon` / `agentPresetIcon` (collaboration chip glyphs).
- Extend `chat-ui/styles.css` with token-driven chip / icon-button / run-action rules.
- Hosts (Clash, Backchat) consume these; theming stays on host CSS variables.
