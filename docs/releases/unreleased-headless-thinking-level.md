### Effective thinking level of a headless launch

New `resolveAcpHeadlessThinkingLevel(configOptions, requested)` in
`@openma/common/acp-harnesses/headless-launch`. It compares the thinking level
a headless launch asked for with the ACP `thought_level` config option of the
started session and returns `{ requested, effective, available, status }`,
where `status` is `applied`, `adjusted`, or `unreported`.

A harness resolves the requested level against the model and does not fail
when the model has no such level. With `@openma/pi-acp` 0.1.7 and the Pi SDK
1.1.0, `--model deepseek/deepseek-flash:medium` runs at `high`, and
`buildAcpHeadlessLaunch` reports nothing as unsupported. Hosts that record or
depend on the level call the new function after the session starts.

`buildAcpHeadlessLaunch` is unchanged.

Fixes openma-ai/openma-common#45.
