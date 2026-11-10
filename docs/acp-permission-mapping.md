# Opt-in ACP native permission mapping

`@openma/common/acp-runtime` exports `applyAcpPermissionMode`, its options/result
and `AcpPermissionModeError`. This is a standalone supervisor building block;
no runtime, launch recipe, permission callback or old consumer enables it by
default. It does not implement CMA auxiliary-model review.

```ts
import { applyAcpPermissionMode } from "@openma/common/acp-runtime";

// session is initialized. No prompt may race this operation.
const result = await applyAcpPermissionMode(session, {
  harnessId: "claude-acp", // canonical known-agent id from the supervisor
  mode: agentGlobalMode,    // always_ask | auto | always_allow | undefined
  abortSignal,
  timeoutMs: 10_000,
});
// Only now admit input. On any rejection, keep dispatch closed.
// undefined -> {status: "not-configured"}, intentionally no checks or RPC.
```

## Meaning and exact scope

These are **native harness policy presets**, not a guarantee that every tool
(read-only or preauthorized actions included) asks the user. `always_ask` selects
the harness's human-review policy; `auto` selects its own automatic reviewer;
`always_allow` selects native bypass/full access. Native sandbox and policy
constraints still apply. If a product requires *every tool call* to be confirmed
regardless of native exemptions, these presets cannot express that contract.
Do not advertise this helper as such enforcement.

| Harness and exact adapter version | always_ask | auto | always_allow |
| --- | --- | --- | --- |
| claude-acp 0.75.1, 0.94.0 | default | auto | bypassPermissions |
| codex-acp 1.8.0, 1.10.0 | read-only | agent | agent-full-access |

The initialize `agentInfo.name` must respectively be
`@agentclientprotocol/claude-agent-acp` or `@agentclientprotocol/codex-acp`, and
`agentInfo.version` must match exactly. No aliases, guessed version ranges,
command-name inference or label matching. Unknown versions fail closed pending
source review. Identity is the adapter's self-report, not binary attestation;
the supervisor remains responsible for trusted installation and identity.

The live `configOptions` must contain exactly one select `mode` option in
category `mode`, advertising the required native value. Grouped choices work.
Missing/duplicate options, missing native modes and legacy-only modes fail
**before dispatch**. Claude bypass can be absent under root without `IS_SANDBOX`;
there is no attempt to enable it through environment changes.

## Evidence / why this transport

Older source versions are tied to npm registry `gitHead`, fetched read-only.
0.94.0 was reviewed and exercised from the already-installed package, without
installation or cache edits (see verification limits below):

- Claude 0.75.1: `3e23c5b960b66a6d2c892e7524c952e731c076a7`
  - [session-mode.ts](https://github.com/agentclientprotocol/claude-agent-acp/blob/3e23c5b960b66a6d2c892e7524c952e731c076a7/src/session-mode.ts): catalog, native SDK `setPermissionMode`, model-dependent `auto` → `acceptEdits` fallback.
  - [acp-agent.ts](https://github.com/agentclientprotocol/claude-agent-acp/blob/3e23c5b960b66a6d2c892e7524c952e731c076a7/src/acp-agent.ts): `setSessionConfigOption` awaits mode selection, updates effective config, returns full config state. Package pins Claude Agent SDK 0.3.257.
- Claude 0.94.0: installed `@agentclientprotocol/claude-agent-acp/package.json`
  pins ACP SDK **2.0.0**, Claude Agent SDK **0.3.303**.
  `dist/acp-agent.js` exports the v1 router `v1AgentApp`; initialize still reports
  protocolVersion 1 and the exact package name/version. `dist/session-mode.js`
  retains default/auto/bypassPermissions and model-dependent acceptEdits fallback.
  `setSessionConfigOption` awaits native `query.setPermissionMode`, publishes the
  effective mode, synchronizes config and returns the actual full config state.
  Bypass advertisement is additionally gated by settings
  `permissions.disableBypassPermissionsMode` and the session option
  `allowDangerouslySkipPermissions` (besides root/sandbox eligibility). The helper
  respects absence and never enables those flags itself. Source hashes and the
  exact installed path are in `.validation/permission-mapping-094/`.
- Codex 1.8.0: `87997e2627e8fa246a49de533c612f6196c4004e`
  - [AgentMode.ts](https://github.com/agentclientprotocol/codex-acp/blob/87997e2627e8fa246a49de533c612f6196c4004e/src/AgentMode.ts): `read-only` is on-request/user/workspace-write; `agent` is on-request/auto_review/workspace-write; `agent-full-access` is never/user/danger-full-access.
  - [CodexAcpServer.ts](https://github.com/agentclientprotocol/codex-acp/blob/87997e2627e8fa246a49de533c612f6196c4004e/src/CodexAcpServer.ts): config setter applies `sessionState.agentMode` then returns derived config; legacy mode setter returns `{}`.
  - [CodexAcpClient.ts](https://github.com/agentclientprotocol/codex-acp/blob/87997e2627e8fa246a49de533c612f6196c4004e/src/CodexAcpClient.ts): next `turn/start` receives mode approvalPolicy, approvalsReviewer and sandboxPolicy. This is an adapter next-turn setting, not a mid-turn engine acknowledgement.
- Codex 1.10.0: `061f9a4a2e463a220d7a3ab2ae5e9732837085ef`
  - Same files [AgentMode.ts](https://github.com/agentclientprotocol/codex-acp/blob/061f9a4a2e463a220d7a3ab2ae5e9732837085ef/src/AgentMode.ts), [CodexAcpServer.ts](https://github.com/agentclientprotocol/codex-acp/blob/061f9a4a2e463a220d7a3ab2ae5e9732837085ef/src/CodexAcpServer.ts), [CodexAcpClient.ts](https://github.com/agentclientprotocol/codex-acp/blob/061f9a4a2e463a220d7a3ab2ae5e9732837085ef/src/CodexAcpClient.ts) retain these semantics. Both reviewed versions use **agent-full-access**, not **full-access**. Codex engine dependencies are ranges, not an attested engine version.
- Installed ACP SDK 1.9.0 `SetSessionConfigOptionResponse.configOptions` is the
  full current configuration. `SetSessionModeResponse` has only optional
  `_meta`; [session modes](https://agentclientprotocol.com/protocol/v1/session-modes)
  does not promise an effective-mode readback in that empty ACK.

The helper always sends `session/set_config_option` (`mode`, native id), even
when initial state already matches. It validates the returned current value
and advertised values, and rejects already-observed contradictory config state.
It **never calls `setMode`** or treats its optimistic `modes.currentModeId`
assignment as evidence. The existing best-effort legacy setter is intentionally
unchanged for compatibility. No legacy transport fallback is attempted.

`status: applied` means the **adapter's config response** confirms the preset;
it is not an OS security boundary, engine attestation, guarantee about existing
permission rules, or proof of eventual tool behavior. Tests use actual common
AcpSessionImpl and SDK streams with a synthetic agent, not live authenticated
Claude/Codex. Additionally `tests/fixtures/permission-mapping/native-claude.mjs`
exercises the installed 0.94.0 **native v1 router, initialize, mode catalog,
selection, fallback, config setter and notifications** with common's real SDK
1.9 client. Session creation/auth probing/engine control/cleanup are test doubles;
no model prompt is sent. Node permissions forbid subprocesses and file writes,
network calls are denied, and only source/dependencies are readable. This is
adapter protocol integration, **not live Claude engine or product E2E**. It checks
all three presets, missing bypass, auto fallback, native rejection, cancellation,
timeout and late ACK. Run explicitly with an absolute installed package path;
there is no cache lookup, installation or native dependency in production code.
Those downstream live integrations still require validation.

## Errors, cancellation, and supervisor responsibilities

- `unsupported`: unproven identity/version/catalog or unverifiable response.
- `mode-mismatch`: effective value differs, including stricter substitutions;
  includes `effectiveModeId`. Claude `acceptEdits` is **not** accepted as auto.
- `apply-failed`: native RPC failed; original error is `cause`.
- `aborted` / `timeout`: local waiting stopped. Default deadline 10s, positive
  finite milliseconds up to 2^31−1. No remote `session/cancel` is sent.
- `busy`: a previous helper RPC on this session has not settled.

`outcome: not-dispatched` means no native setter was called.
`outcome: unknown` means it may have applied, even after timeout/cancellation;
keep admission closed, reconcile explicitly or dispose/recreate the session.
There is **no automatic retry, rollback, downgrade or permission auto-approval**.
Late responses/rejections are observed without producing success to the cancelled
caller. The helper's concurrency guard remains held until the actual RPC settles.

Supervisor must serialize helper, other mode/model setters and input dispatch,
use it before a new turn, and watch native mode/config changes. This helper is a
one-shot verified write, **not a lifetime lock**: Claude can downgrade auto when
models change, and agents may switch modes themselves. Revalidate at admission
and stop on drift. After failed application do not rely on the old mode. Native
permission callbacks must still be honored; do not auto-allow unexpected requests
merely because the global mode is `always_allow`.
