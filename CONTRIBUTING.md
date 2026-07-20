# Contributing

## Scope

Keep only contracts that are genuinely shared by at least two OpenMA surfaces.
Product-specific components, copy, routing, storage, and theme-plugin validation
stay in their owning repository.

## Development

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

Use `pnpm test:watch` for contract work and `pnpm dev` for compiled-output watch
mode while a consumer is linked locally.

For ACP-facing changes, verify method names, update shapes, lifecycle behavior,
and `_meta` usage against the official ACP v1 documentation before editing:
https://agentclientprotocol.com/protocol/v1

## Release checklist

1. All common tests, type checks, and builds pass.
2. Both consumer repositories pass their focused event/theme tests and builds.
3. `package.json#version` follows semantic versioning.
4. The release commit is merged to `main`.
5. Create and push an immutable matching tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.
6. Update both consumers from the old Git tag to the new one and commit their lockfiles.

The package has `private: true` by design, so accidental npm publication fails.
