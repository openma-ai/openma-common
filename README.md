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
- `@openma/common/protocol/managed` — v2 Managed Agents ↔ OpenMA codec, typed against the official Anthropic SDK event unions.
- `@openma/common/protocol/acp` — ACP v1 ↔ OpenMA codec, typed against the official Agent Client Protocol SDK message unions.
- `@openma/common/protocol/openai-agents` — OpenAI Agents items, turns, and session stream events decoded into OpenMA events. The mapping matches backchat `direct-agent-runtime` at `64fd74d`.
- `@openma/common/protocol/cursor-cloud` — Cursor Cloud Agents API v1 run SSE events decoded into OpenMA events.
- `@openma/common/session-events/managed` — deprecated legacy Managed event projector plus a compatibility re-export of the v2 codec.
- `@openma/common/session-events/acp` — deprecated ACP parser/turn projector plus a compatibility re-export of the SDK codec.
- `@openma/common/session-events/openma` — OpenMA canonical event envelope, Vendor/raw records, and WorkItem lifecycle reducer.
- `@openma/common/agent-contract` — immutable Agent facts, connector commands, and lifecycle helpers.
- `@openma/common/agent-contract/acp` — ACP wire events translated into Agent facts.
- `@openma/common/agent-contract/managed` — Claude Managed wire events translated into Agent facts.
- `@openma/common/agent-ui` — replayable headless Agent UI reducer and subscribable framework-neutral store.
- `@openma/common/session-kernel` — canonical local/cloud lifecycle, relay commands, and wire conversion.
- `@openma/common/acp-fork` — browser-safe inclusive ACP fork client API: `forkSupport()`, `acpForkPointsFromMessages()`, `ACP_INCLUSIVE_FORK_CAPABILITY`, capability metadata helpers, and `AcpForkPoint` types. No Node built-ins and no SHA-256 fingerprinting; pass the selected `forkPoint` to the Node runtime (for example via `@openma/common/acp-runtime`) which builds `jetbrains.air.fork` request meta. See [docs/fork-support.md](./docs/fork-support.md).
- `@openma/common/acp-runtime` — shared ACP session/runtime implementation used by both Backchat and OpenManaged. It exports `sessionConfigOptionsFromResponse()` (legacy `models` catalog → model select), `acpForkRequestMeta()` (`jetbrains.air.fork` v1, Node-only), re-exports the `acp-fork` client helpers, `probeAgentAuthStatus()`, and `authenticateAgent()`. Sessions expose `legacyModels` and `forkSupport`, and accept an optional `clientCapabilityOverlay` and `forkPoint`. See [docs/fork-support.md](./docs/fork-support.md).
- `@openma/common/acp-runtime/node-spawner` — shared Node subprocess adapter for the ACP runtime. On POSIX it starts each agent in its own process group and signals that group on kill and on host shutdown. A pure Node process with no other listener for that `SIGHUP`, `SIGINT`, or `SIGTERM` re-raises the signal after cleanup, so the process still exits with it. The Electron main process keeps its own handlers; children are reaped from the `exit` hook when that process actually quits.
- `@openma/common/acp-harnesses` — shared PATH-based ACP harness catalog (`DEFAULT_ACP_HARNESSES`) and persisted-catalog cloning and validation.
- `@openma/common/acp-harnesses/registry` — official ACP registry fetch/cache plus OpenMA overlay (`known-agents`), and managed-bin / PATH detection.
- `@openma/common/acp-harnesses/installer` — registry-backed npm/uvx/binary installs into a managed bin directory (host-agnostic `npmCommand` / `npmEnv`).
- `@openma/common/acp-harnesses/headless-launch` — `buildAcpHeadlessLaunch(entry, options)`: the launch arguments and variables for one unattended run, built from the harness's own recipe (`KnownAgentEntry.headless`). `resolveAcpHeadlessThinkingLevel(configOptions, requested)`: the thinking level the started session runs at. See [Unattended runs and pinned installs](#unattended-runs-and-pinned-installs).
- `@openma/common/acp-harnesses/agent-setup` — install/upgrade/uninstall and capability inspection service used by Backchat. See [Managed ACP harness installation](#managed-acp-harness-installation).
- `@openma/common/acp-harnesses/custom-agents` — shared store for custom ACP agent definitions under `~/.oma`: `config.toml` `[[agents]]` override rows plus compatible reads of Martty `settings.json` `harnesses[]` rows (migrated on write). Versions in `args` are kept verbatim.
- `@openma/common/session-ui` — shared Session turn frame, OpenMA/harness icons, live ACP configuration controls, and status semantics with product-specific content slots.

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

## ACP inclusive fork

Clients ask `forkSupport()` whether an agent can fork a whole session or from one assistant message. They do not hardcode harness names or versions. `SessionOptions.forkPoint` is valid only with `forkFromAcpSessionId`. After `initialize`, the runtime refuses the fork when `forkSupport()` is not `"message"` — it does not fall back to a whole-session fork. The same refusal applies when the caller puts `jetbrains.air.fork` on `sessionRequestMeta` directly. A supported `forkPoint` is deep-merged into that metadata for the `session/fork` request only, so other keys such as `claudeCode` stay in place.

Adapters that implement the request advertise `sessionCapabilities.fork` together with `agentCapabilities._meta.jetbrains.air.fork = { "version": 1, "inclusive": true }`. The nested object is the capability. A flat `"jetbrains.air.fork"` key is not. Own adapters copy `ACP_INCLUSIVE_FORK_CAPABILITY` and keep it byte-identical; they do not depend on this private package.

Truncation keeps the selected assistant message and everything before it, and drops everything after it. If that message contains tool calls whose results sit after the message, adapters remove those tool calls from the truncated message. The new session stays a legal model transcript, and `session/load` replay still ends on the target message. Tool calls that already completed before that message stay as they were. The contract, client example, and dependency order are in [docs/fork-support.md](./docs/fork-support.md).

## Install from npm

```json
{
  "dependencies": {
    "@openma/common": "^0.9.1"
  }
}
```

Release tags are published to npm by CI with provenance. Built `dist/` output
is what ships, so installs do not run package lifecycle scripts.

## Install from Git

Git installs keep working for pinned commits. Use an immutable release tag in `package.json`:

```json
{
  "dependencies": {
    "@openma/common": "github:openma-ai/openma-common#v0.9.1"
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

npm installs accept an optional `nodePath` (any Node-compatible executable) and
`env` map; the installer runs the bundled `npm` CLI through that executable.
Hosts that embed Node (for example Electron) pass their executable and whatever
environment that runtime requires.

The host environment needs Node/npm for npm sources when `nodePath` is omitted,
uv plus a compatible Python interpreter for uvx, and bzip2/xz when those archive
formats are used. Python
interpreters may be provisioned with `uv python install`. uvx virtual environments
use `bin/python` on POSIX and `Scripts\python.exe` on Windows. uvx handles console
entry points and wheel-packaged scripts, verifies package ownership of the selected
executable, and keeps entry points valid when a completed virtual environment is published.

The release pins the top-level package/artifact. npm/uv resolve transitive
packages on first installation; identical dependency trees across independently
prepared sandboxes require bundled/shrinkwrapped or otherwise locked releases.
A native package may additionally require system libraries from its environment.

Artifact integration tests use actual npm/uv processes and local fixture
registries. Running `pnpm verify` requires uv, Python 3, gzip, bzip2, xz and OpenSSL.
Archive fixtures are built with the `tar` package. Product extraction uses that
package as well; it does not shell out to system tar.

Artifact installers retain `SSL_CERT_FILE`, `SSL_CERT_DIR` and
`NODE_EXTRA_CA_CERTS` from the sandbox so its trusted outbound-proxy CA remains
available. uv uses native TLS trust. Certificate verification stays enabled;
Work/model credentials and arbitrary host environment variables remain excluded.

## Managed ACP harness installation

The harness modules vend Backchat's ACP registry and installer into
`@openma/common` so Clash, Martty, and Backchat can share one implementation.
`loadRegistry()` merges the official CDN registry with `OVERLAY_AGENTS` (pi/dsh
npm overlays, featured metadata, and other curated entries). `detect()` /
`detectAll()` resolve commands from the managed bin directory or system PATH as
in Backchat.

Hosts that bundle their own Node pass `npmCommand`, `npmCommandArgs`, and
`npmEnv` into `installAcpRegistryAgent()` or `createAcpAgentSetupService()`.
`@openma/common/acp-artifacts` remains the low-level release resolver for
session-scoped artifact preparation; the harness installer uses registry
snapshots and npm shims the same way Backchat does.

```ts
import { loadRegistry, detect } from "@openma/common/acp-harnesses/registry";
import { installAcpRegistryAgent } from "@openma/common/acp-harnesses/installer";
import { createAcpAgentSetupService } from "@openma/common/acp-harnesses/agent-setup";

await loadRegistry({ cachePath: "/var/acp/.registry/official.json" });
const claude = await detect("claude-acp", { managedBinDirs: ["/var/acp/bin"] });

await installAcpRegistryAgent({
  registryId: "codex-acp",
  shimName: "openma-codex-acp",
  binDir: "/var/acp/bin",
  npmCommand: "/path/to/node",
  npmCommandArgs: ["/path/to/npm-cli.js"],
});

const setup = createAcpAgentSetupService({
  registryCachePath: "/var/acp/.registry/official.json",
  acpBinDir: "/var/acp/bin",
  acpInstallRoot: "/var/acp/install",
});
await setup.warmup();
await setup.installAgent("pi");
```

## Unattended runs and pinned installs

A host that runs a harness without a person at the keyboard (a benchmark trial,
a CI job) names the harness id and passes generic options. Flags and variable
names stay in the registry entry:

```ts
import { resolveKnownAgent } from "@openma/common/acp-harnesses/registry";
import { buildAcpHeadlessLaunch } from "@openma/common/acp-harnesses/headless-launch";
import {
  acpLauncherInvocation,
  installPinnedAcpHarness,
  pinnedAcpHarnessPaths,
  readAcpHarnessPinState,
} from "@openma/common/acp-harnesses/installer";

const entry = resolveKnownAgent("pi-acp")!;
const { commandPath, version, dependencies } = await installPinnedAcpHarness({ entry, binDir });
const { args, env, unsupported } = buildAcpHeadlessLaunch(entry, {
  agentDir,        // the agent's user-level configuration directory
  sessionDir,
  trustProject: true,
  provider: "deepseek",
  model: "deepseek-v4-pro",
  thinkingLevel: "medium",
});
if (unsupported.length > 0) throw new Error(`cannot express: ${unsupported.join(", ")}`);
const { file, args: argv, windowsVerbatimArguments } = acpLauncherInvocation(commandPath, args);
```

**Launch.** `unsupported` lists every requested option the launch does not
carry: one the recipe has no flag or variable for, and a `provider` or
`thinkingLevel` given without a `model` (both are written inside the model
value). A host that depends on an option, such as `agentDir` for isolation,
must stop when the list is not empty. An entry without a recipe throws.

**Thinking level.** The launch only requests a level. A harness resolves it
against the model and does not fail when the model has no such level: Pi runs
`deepseek-flash:medium` at `high`. After the session starts, read what it
reports:

```ts
import { resolveAcpHeadlessThinkingLevel } from "@openma/common/acp-harnesses/headless-launch";

const thinking = resolveAcpHeadlessThinkingLevel(session.configOptions, "medium");
// { requested: "medium", effective: "high", available: ["off", "low", "high", "max"], status: "adjusted" }
```

`status` is `applied` (the session runs at the requested level), `adjusted`
(the harness chose another one; record `effective`), or `unreported` (the
session has no `thought_level` select option, so the request had no effect).

**Pinned install.** `installPinnedAcpHarness` installs `entry.pinned`: the
adapter package at one exact version, with `entry.pinned.dependencies` written
as npm `overrides` in the install prefix and checked against what npm
installed. It fails when a pinned package is missing or at another version,
including when it reuses an existing install directory. The result carries
`version` and `dependencies` (the installed versions), which a host should
record with its run.

A pinned install never uses the product install's names. Its launcher is
`<shim>-pinned` (`openma-acp-pi-acp-pinned`) and its state is
`registry/<id>-pinned/` (`install.json` and the versioned prefix), from
`pinnedAcpHarnessPaths(entry, binDir)`. It can share a bin directory and
install root with a product install without either overwriting the other.
Hosts should still give benchmark installs a directory of their own.

`readAcpHarnessPinState({ entry, shimPath })` compares an existing pinned
install with the pins from local files only. It returns `null` for an entry
that pins nothing and throws, like the installer, for pins that are not exact
versions. Pins are applied in code-point order, so the install directory name
is the same on every machine.

`npmOverrides` on `installAcpRegistryAgent` applies to npm installs only. For
a harness that installs as a binary or through uvx on the current platform the
call throws instead of installing an unpinned agent.

**Windows.** The pinned launcher is a `.cmd` file
(`openma-acp-pi-acp-pinned.cmd`) that sets the entry's variables and calls the
package's `.cmd` bin. A `.cmd` file cannot be started by `CreateProcess`, so
start it with `acpLauncherInvocation(commandPath, args)`, which returns
`cmd.exe /d /s /c "<line>"` with `windowsVerbatimArguments` on Windows and the
launcher itself elsewhere. `npm` given as a bare name or a `.cmd` path runs
through `cmd.exe` the same way; an executable path such as a bundled
`node.exe` (`npmCommand` + `npmCommandArgs`) starts directly. The pinned
install tests run on `verify-windows`. Product installs
(`installAcpRegistryAgent`, `AcpAgentSetupService`) still write a POSIX shell
shim and still follow `registryDistribution` and npm's latest.

Only `pi-acp` has a recipe and pins today. The pins cover `@openma/pi-acp` and
the `@earendil-works/*` packages it resolves. Other transitive dependencies
still follow their own ranges. Update the pins in the same PR that moves the
adapter to a new Pi SDK.

## Coverage

`pnpm test:coverage` writes `coverage/lcov.info`. CI uploads it to Codecov,
and `codecov.yml` requires 100% coverage of the lines a pull request changes
(`patch` target). The project-wide number is informational.
