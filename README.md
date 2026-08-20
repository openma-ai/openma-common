# OpenMA Common

Shared, product-agnostic contracts used by OpenMA Desktop and Open Managed Agents.
This repository is consumed directly from Git; it is intentionally not published
to npm.

The Agent-facing architecture is additive and vendor-neutral:

```text
OpenMA Agent Contract
├── commands, capabilities, session handles, and canonical OpenMA events
├── ACP wire adapter + existing ACP runtime
└── Claude Managed Agents wire adapter
```

ACP and Managed Agents remain bindings. Consumers orchestrate against the
OpenMA Agent Contract instead of leaking either provider's session identifiers
or wire-event shapes into product state.

## Exports

- `@openma/common/brand` — canonical token names, light/dark values, and brand RGB.
- `@openma/common/brand/tokens.css` — matching CSS custom properties.
- `@openma/common/brand/openma-logo-mark.svg` — canonical OpenMA vector mark.
- `@openma/common/agent-contract` — vendor-neutral Agent Connector, session handle, command, capability, Turn, and canonical event contracts.
- `@openma/common/agent-contract/acp` — ACP wire updates to canonical OpenMA events.
- `@openma/common/agent-contract/managed` — Claude Managed Agents wire events to canonical OpenMA events.
- `@openma/common/session-events/managed` — Managed Agents wire-event normalizer and turn projector.
- `@openma/common/session-events/acp` — ACP event parser and chat-turn reducer.
- `@openma/common/session-events/openma` — OpenMA canonical event envelope, Vendor/raw records, and WorkItem lifecycle reducer.
- `@openma/common/session-kernel` — canonical local/cloud lifecycle, relay commands, and wire conversion.
- `@openma/common/acp-runtime` — shared ACP session/runtime implementation used by both Backchat and OpenManaged.
- `@openma/common/acp-runtime/node-spawner` — shared Node subprocess adapter for the ACP runtime.
- `@openma/common/session-ui` — shared Session turn frame and status semantics with product-specific content slots.

`projectCanonicalChatTurns()` adapts Managed events into the same `TurnRender`
model used by Backchat. This is the migration seam for a shared Session GUI;
the current OpenManaged Console can move to it without changing its API wire
format.

Adapters keep wire-protocol differences at the boundary. Consumers may add
product-specific presentation after normalization, but should not fork the
shared parsing and reduction logic.

`agent-contract` is the new orchestration boundary. Existing `session-kernel`,
`session-events/*`, and `acp-runtime` exports remain available for compatibility;
new runtime-neutral code should use an `OpenMAAgentConnector` and store an
`AgentSessionHandle` rather than an ACP-specific session id.

Every event emitted by an Agent Connector is a deeply immutable JSON fact and
is correlated by `session_id`, `turn_id`, and monotonic `seq`. The wire bindings
standardize these provider lifecycles:

The JSON boundary is strict: it accepts primitives, finite numbers, arrays, and
plain or null-prototype objects. It rejects undefined values, functions,
symbols, BigInt, non-finite numbers, cyclic/sparse structures, and objects such
as Date or Map instead of silently coercing them.

| OpenMA fact | ACP | Claude Managed Agents |
| --- | --- | --- |
| `turn.started` | connector begins `session/prompt` | `session.status_running` |
| `turn.completed` | `promptComplete` | `session.status_idle` |
| `turn.failed` | `promptError` | idle with `retries_exhausted` |
| `turn.cancelled` | prompt stop reason `cancelled` | idle with `cancelled` |
| `turn.interrupted` | explicit host interruption fact | `user.interrupt` / idle with `interrupted` |
| `callback.requested` | client request | custom tool or permission request |

`callback.requested.data.fingerprint` binds the session, Turn, category,
method, callback id, and canonical request parameters. Approval caches must use
the fingerprint, not the provider callback id alone. Consumers can use
`isTurnTerminalEvent`, `turnTerminalStatus`, `isPermissionRequestEvent`, and
`isElicitationRequestEvent` without parsing provider event strings.

The `session-events/openma` export is the harness-neutral event boundary. It
distinguishes canonical events from `vendor.event` records and opaque
`raw.event` records; vendor/raw records do not imply GUI lifecycle semantics.

## Install from Git

Use an immutable release tag in `package.json`:

```json
{
  "dependencies": {
    "@openma/common": "github:openma-ai/openma-common#v0.4.0"
  }
}
```

The lockfile resolves that tag to an exact commit. Built `dist/` output is
committed, so consumer installs do not run package lifecycle scripts. Never
move an existing tag; create a new one for every consumer-visible change.

## Fast local development

No npm or GitHub release is needed while iterating. From this repository, the
single-command flow links all consumers, starts the common watch build, and
restores the original dependencies on exit:

```bash
pnpm install
pnpm dev:consumers
```

Run the consumer's normal dev server in another terminal, for example
`pnpm --dir ../openma-desktop dev` or `pnpm --dir ../open-managed-agents/apps/console dev`.
Press `Ctrl+C` in the common terminal when finished.

For more control, `pnpm dev` starts only the common watch build;
`pnpm link:consumers` and `pnpm unlink:consumers` can be run independently.
The helper expects `openma-common`, `openma-desktop`, and
`open-managed-agents` to be siblings. It swaps only each consumer's
`node_modules/@openma/common` symlink (including the two ACP wrapper packages)
and never edits a manifest or lockfile.

## Change lifecycle

1. Add or update tests here before implementation.
2. Run `pnpm verify`.
3. Link the package locally and verify both consumers.
4. Merge the common change, bump `version`, then create an immutable `vX.Y.Z` tag.
5. Update each consumer's Git ref and lockfile in an ordinary reviewed PR.

Compatibility policy:

- patch: fixes or additive fields that do not change existing output;
- minor: new tokens, exports, normalized event variants, or optional behavior;
- major: removed/renamed tokens, exports, types, or changed reducer semantics.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the release checklist.
