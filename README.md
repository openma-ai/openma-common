# OpenMA Common

Shared, product-agnostic contracts used by OpenMA Desktop and Open Managed Agents.
This repository is consumed directly from Git; it is intentionally not published
to npm.

## Exports

- `@openma/common/brand` — canonical token names, light/dark values, and brand RGB.
- `@openma/common/brand/tokens.css` — matching CSS custom properties.
- `@openma/common/brand/openma-logo-mark.svg` — canonical OpenMA vector mark.
- `@openma/common/protocol/managed` — v2 Managed Agents ↔ OpenMA codec, typed against the official Anthropic SDK event unions.
- `@openma/common/protocol/acp` — ACP v1 ↔ OpenMA codec, typed against the official Agent Client Protocol SDK message unions.
- `@openma/common/session-events/managed` — deprecated legacy Managed event projector plus a compatibility re-export of the v2 codec.
- `@openma/common/session-events/acp` — deprecated ACP parser/turn projector plus a compatibility re-export of the SDK codec.
- `@openma/common/session-events/openma` — OpenMA canonical event envelope, Vendor/raw records, and WorkItem lifecycle reducer.
- `@openma/common/agent-ui` — replayable headless Agent UI reducer and subscribable framework-neutral store.
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

The v2 event path is deliberately bidirectional only through the canonical
protocol; harness adapters never map directly to each other:

```text
Managed SessionEvent / StreamSessionEvents ──decode──┐
ACP notifications / requests / responses  ──decode──┤
                                                         ├──▶ OpenMAEvent
Managed EventParams                         ◀─encode──┤
ACP request / notification / response       ◀─encode──┘
                                                                  │
                                                                  ▼
                                                        headless AgentUIState
                                                                  │
                                                       React / Vue / CLI bindings
```

Codec results declare `exact`, `lossy`, or `unsupported` fidelity. Current
official events without a harness-neutral projection are retained as
`vendor.event`; unknown future or malformed records are retained as
`raw.event`, so replay never silently discards evidence. The Anthropic SDK is
an optional peer and a development dependency: the public codec declarations
track its official unions without adding a runtime SDK import.
Every official Managed Session event discriminant is classified explicitly as
canonical or vendor-preserved, so an SDK union change fails typecheck until the
mapping policy is reviewed.

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

## Shared local runtime

`@openma/common/local-runtime` owns the host-neutral ACP session execution loop,
checkpoints, daemon connection state and graceful shutdown. CLI and desktop
adapters provide process spawning, persistence, directory authorization, logging
and UI. Sharing this code does not give an observer ownership of another process.

`@openma/common/managed-runtime` owns the Managed Agents Work lease lifecycle,
Session HTTP control channel, ACP event projection and semantic recovery. These
modules use scoped Work credentials and the canonical `/v1/sessions` API. The
legacy reverse-WebSocket connection remains separate for existing installations;
importing this package alone does not migrate a daemon to the Work protocol.

The runtime modules were extracted from open-managed-agents `af45e233` with their
behavioral tests. Product adapters must depend on these exports rather than copy
source snapshots. The package does not install services, select a tenant, or
start a daemon on import.

## Public website design

Import `@openma/common/brand/website.css` for the Backchat-led marketing theme.
It supplies `--site-*` colors, Geist/monospace stacks, 1180px content width,
10px controls, 14px panels and 160ms transitions. Both public websites consume
these values; app and Console themes continue using `brand/tokens.css`.

Use `data-site-theme="light"` or `"dark"` for explicit selection; otherwise
the palette follows the OS. Keep editorial content and product components in
the consuming site. Use coral for the primary action, neutral bordered
secondary actions, sans-serif headings, thin separators and generous sections.

## Versioned ACP artifacts

`@openma/common/acp-artifacts` prepares published ACP harnesses independently of
the environment image. Execution still uses the existing shared ACP runtime.

```ts
const release = await resolveAcpRelease(
  { id: "goose", version: "1.50.0" },
  { type: "registry" },
);
// Persist the complete release with the Session before preparing/launching it.
const prepared = await prepareAcpRelease(release, { root: "/tmp/acp-artifacts", signal });
// Give command, args and env to the existing ACP runtime.
```

Supported sources:

| Source | Resolution and preparation |
| --- | --- |
| `npm` / `npx` | Exact npm version and SHA-512 tarball integrity; isolated local install |
| `uvx` | Exact PyPI version and artifact SHA-256 hashes; relocatable uv virtual environment |
| `registry` | Official ACP `agent.json`, including exact historical/preview releases; binary → npx → uvx preference |
| Binary manifest | Platform-specific archive/command from an ACP manifest; SHA-256 verified before extraction |

`parseAcpReleaseSource()` accepts npm package strings for compatibility, or typed
sources such as `{ type: "uvx", package: "python-agent", command: "agent", python: "3.12" }`.
A registry source can set `preference: ["uvx", "npx", "binary"]`, or an operator's
HTTPS `manifestUrl` with `{id}` / `{version}` placeholders. Custom manifests must
identify the exact requested release. The public registry resolves historical
versions through GitHub file history; it never substitutes the current version.
The low-level `resolveNpmAcpRelease`, `resolveUvxAcpRelease` and
`resolveBinaryAcpRelease` APIs remain available for hosts with their own catalogs.

Binary formats: raw executable, zip, tar, tar.gz/tgz, tar.bz2/tbz2 and tar.xz/txz.
Platform selection follows ACP's OS/architecture keys. Paths are checked before
extraction; tar links and special files are rejected. Installer formats such as
dmg, pkg, deb, rpm and msi are not executable distributions. Published checksums
are verified. For an older registry entry without a checksum, the first HTTPS
download's SHA-256 is recorded and subsequent preparation verifies that digest;
this records content identity, rather than claiming publisher attestation.

All release records have a digest. `validateAcpRelease()` validates restored
records, and `acpReleaseMatchesSource()` checks that a Session's catalog binding
has not changed. Publication is atomic, failed preparation remains unlaunchable,
and different versions coexist. Caches are separated by OS/CPU; npm adds Node
ABI and uvx adds Python runtime/interpreter identity. Already-prepared artifacts
can be used offline. Registry-provided arguments and environment are preserved;
hosts must still remove their own control-plane secrets from the final agent
environment. Installer subprocesses receive only the minimal system environment.

The host environment needs Node/npm for npm sources, uv plus a compatible Python
interpreter for uvx, and bzip2/xz when those archive formats are used. Python
interpreters may be provisioned with `uv python install`. These APIs target
POSIX sandboxes. uvx handles console entry points and wheel-packaged native
executables, verifies package ownership of the selected executable, and keeps
entry points valid when a completed virtual environment is published.

The release pins the top-level package/artifact. npm/uv resolve transitive
packages on first installation; identical dependency trees across independently
prepared sandboxes require bundled/shrinkwrapped or otherwise locked releases.
A native package may additionally require system libraries from its environment.

Artifact integration tests use actual npm/uv processes and local fixture
registries. Running `pnpm verify` requires uv, Python 3, tar, gzip, bzip2, xz and OpenSSL.

Artifact installers retain `SSL_CERT_FILE`, `SSL_CERT_DIR` and
`NODE_EXTRA_CA_CERTS` from the sandbox so its trusted outbound-proxy CA remains
available. uv uses native TLS trust. Certificate verification stays enabled;
Work/model credentials and arbitrary host environment variables remain excluded.
