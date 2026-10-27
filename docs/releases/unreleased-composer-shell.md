# Unreleased — ComposerShell

Minor candidate (`0.12.0`): shared composer chrome topology for chat-ui hosts.

- Export `ComposerShell` and `ComposerToolbar` from `@openma/common/chat-ui`.
- Own `start` | `end` flex toolbar topology + CSS token hooks; hosts inject
  attach / chips / agent picker / mic / send via slots.
- Document tokens and Clash / Backchat adoption in
  [docs/chat-ui-composer-shell.md](../chat-ui-composer-shell.md).
- Keep `createComposerDraftStore`, `agentChatDensityAttributes`, and
  `AgentChatView` unchanged.

After merge: cut `release: v0.12.0` (label `release:minor`), mention this PR
number in `docs/releases/v0.12.0.md`, update the README git pin, then bump
Clash / Backchat to the published tag.
