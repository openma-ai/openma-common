# OpenMA Common

Shared, product-agnostic contracts used by OpenMA Desktop and Open Managed Agents.
This repository is consumed directly from Git; it is intentionally not published
to npm.

## Exports

- `@openma/common/brand` — canonical token names, light/dark values, and brand RGB.
- `@openma/common/brand/tokens.css` — matching CSS custom properties.
- `@openma/common/brand/openma-logo-mark.svg` — canonical OpenMA vector mark.
- `@openma/common/session-events/managed` — Managed Agents wire-event normalizer and turn projector.
- `@openma/common/session-events/acp` — ACP event parser and chat-turn reducer.

Adapters keep wire-protocol differences at the boundary. Consumers may add
product-specific presentation after normalization, but should not fork the
shared parsing and reduction logic.

## Install from Git

Use an immutable release tag in `package.json`:

```json
{
  "dependencies": {
    "@openma/common": "github:openma-ai/openma-common#v0.1.1"
  }
}
```

The lockfile resolves that tag to an exact commit. Built `dist/` output is
committed, so consumer installs do not run package lifecycle scripts. Never
move an existing tag; create a new one for every consumer-visible change.

## Fast local development

No npm or GitHub release is needed while iterating.

```bash
# terminal 1
cd ../openma-common
pnpm install
pnpm build
pnpm dev

# terminal 2: links Desktop and all Managed Agents consumer packages
pnpm link:consumers
```

The helper expects `openma-common`, `openma-desktop`, and `open-managed-agents`
to be siblings. It swaps only each consumer's `node_modules/@openma/common`
symlink and never edits a manifest or lockfile. Run `pnpm unlink:consumers` to
restore the exact pnpm-store symlinks that were present before linking.

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
