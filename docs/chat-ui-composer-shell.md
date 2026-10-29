# Composer shell (`@openma/common/chat-ui`)

Shared **layout topology** for the agent composer chrome. Hosts (Backchat,
Clash, …) keep product widgets; common owns structure and CSS token hooks so
hosts can theme without forking flex/grid.

## Exports

From `@openma/common/chat-ui`:

| Export | Role |
| --- | --- |
| `ComposerShell` | Column: optional `body` + bottom toolbar (`start` \| `end`) |
| `ComposerToolbar` | Toolbar row only (when the host already owns the card/body) |
| `COMPOSER_*_CLASS` | Stable class-name constants |
| `createComposerDraftStore` | Unchanged draft persistence helper |
| `agentChatDensityAttributes` | Unchanged density `data-*` + compact CSS vars |
| `AgentBrandIcon` / `ComposerChip` / `ComposerRunAction` | Brand marks + chip / Enter chrome (see below) |

Import styles once:

```ts
import "@openma/common/chat-ui/styles.css";
```

## Topology

```text
.openma-composer-shell
├── .openma-composer-body          ← textarea / editor / strips (slot)
└── .openma-composer-toolbar
    ├── .openma-composer-toolbar-start   ← attach + chips / accessories
    └── .openma-composer-toolbar-end     ← agent picker + mic / send / stop
         (also data-composer-run-actions="true")
```

Reference layout matches Backchat `Composer.tsx`: chips truncate on the left;
run actions stay shrink-0 on the right.

## Slots

```tsx
import { ComposerShell } from "@openma/common/chat-ui";

<ComposerShell
  density="compact" // optional; omit when a parent already set density
  slots={{
    body: <textarea />,
    toolbarStart: (
      <>
        <AttachButton />
        <PermissionChips />
      </>
    ),
    toolbarEnd: (
      <>
        <AgentPicker />
        <MicButton />
        <SendOrStop />
      </>
    ),
  }}
/>
```

Hosts that already wrap a card may use `ComposerToolbar` alone:

```tsx
import { ComposerToolbar } from "@openma/common/chat-ui";

<ComposerToolbar
  className="clash-chat-input-toolbar-row"
  startClassName="clash-chat-input-toolbar-start"
  endClassName="clash-chat-input-toolbar-end"
  start={<>{attach}{toolbarAccessory}</>}
  end={<>{rightToolbarAccessory}{mic}{send}</>}
/>
```

## CSS custom properties (token hooks)

Set on any ancestor (or override on `.openma-composer-shell`). Defaults fall
back to existing chat / control tokens where possible.

| Token | Default | Purpose |
| --- | --- | --- |
| `--composer-section-gap` | `6px` (compact density: `4px`) | Gap between body and toolbar |
| `--composer-body-min-height` | `3rem` (compact: `48px`) | Body min height |
| `--composer-toolbar-gap` | `8px` | Gap between start and end clusters |
| `--composer-toolbar-start-gap` | `2px` | Gap inside start cluster |
| `--composer-toolbar-end-gap` | `2px` | Gap inside end cluster |
| `--composer-toolbar-clip-outset` | `4px` | Clip-box padding for focus rings (`--clip` modifier) |
| `--composer-control-height` | `var(--control-height-compact, var(--control-height-sm, 28px))` | Suggested control box |
| `--composer-control-icon-size` | `var(--composer-attachment-icon-size, 14px)` | Suggested icon size |
| `--composer-chip-height` | `var(--composer-control-height)` | Suggested chip height |
| `--composer-chip-radius` | `var(--composer-control-radius, 6px)` | Suggested chip radius |
| `--composer-chip-padding-inline` | `var(--composer-chip-padding-x, 6px)` | Suggested chip horizontal padding |
| `--composer-card-padding-block` | host / density | Card block padding (density compact sets `8px`) |
| `--composer-frame-padding-inline` | host (`12px` via `.chat-composer-frame`) | Outer frame inset |

Colors should reuse host fg/bg tokens (`--fg`, `--fg-muted`, `--control-bg-hover`,
`--chat-fg-muted`, …) rather than hard-coded values inside the shell.

Density: pass `density="compact"` to `ComposerShell`, or put
`{...agentChatDensityAttributes("compact")}` on a parent dock (Clash
`DashboardComposerDock` pattern).

## Clash adoption

1. Import `ComposerToolbar` (or `ComposerShell`) from `@openma/common/chat-ui`.
2. Replace the hand-rolled `.clash-chat-input-toolbar-row` flex/grid wrapper
   with `ComposerToolbar`, keeping Clash class names via `className` /
   `startClassName` / `endClassName` for host-only CSS.
3. Stop forcing `display: grid` on the shared toolbar when the openma class is
   present (shared flex topology is the asymmetry fix for Dsh Acp + mic).
4. Theme heights via `--composer-control-height` / `--control-height-sm` rather
   than forking the row structure.

## Backchat adoption

Thin migration: swap the footer

```tsx
<div className="flex items-center justify-between gap-2">
  <div className="composer-toolbar-chip-row ...">…</div>
  <div data-composer-run-actions="true">…</div>
</div>
```

for

```tsx
<ComposerToolbar
  startClassName="composer-toolbar-chip-row"
  start={<>{attach}{chips}</>}
  end={<>{picker}{send}</>}
/>
```

`ComposerSurface` / draft store / slash menus stay Backchat-owned. Optional;
not required for the Clash asymmetry fix.

## Non-goals

- No shared agent-picker, mic, or permission-chip widgets (product-specific).
- Does not replace `AgentChatView`’s `slots.composer` — hosts still pass the
  whole composer node; the shell is what that node is built from.
- Does not change `createComposerDraftStore` or transcript presentation.

## Chrome widgets (chips / brand icons / run action)

Also from `@openma/common/chat-ui`:

| Export | Role |
| --- | --- |
| `AgentBrandIcon` | Harness brand mark (`dsh-acp` → DeepSeek whale, not generic robot) |
| `ComposerChip` | Footer-trigger chip chrome (icon + label + trailing) |
| `ComposerIconButton` | Attach / mic / follow square control |
| `ComposerRunAction` | Enter / stop affordance (`data-composer-submit` / `stop`) |
| `DshPresetStandardIcon` / `agentPresetIcon` | Collaboration preset glyphs |
| `composerChipClass` / `COMPOSER_CHIP_CLASS` | Class helpers for host-owned triggers |

Hosts still own menu/popover content and product-specific labels; common owns
density, icon slots, and Enter topology so Clash/Backchat stay aligned.

### Narrow → icon-only density

`.openma-composer-shell` is a named container (`openma-composer`). When its
inline size is **≤ 32rem**, **toolbar-start** chip labels collapse to icon-only
(Backchat side-panel pattern). Toolbar-end labels (e.g. harness "High") stay.

Hidden under `.openma-composer-toolbar-start`:
- `.openma-composer-chip-label` / `[data-openma-composer-chip-label]`
- `.openma-composer-chip > span.min-w-0.flex-1.truncate` (SelectMenu-style wrappers)

At **≤ 22rem** (panel squeezed below a host's natural side-panel width) the
icon-only start lane alone no longer fits beside the end lane, and would clip
its last chip under `overflow: hidden`. Common then also hides start-lane
trailing carets (`.openma-composer-chip > svg:last-child`) and collapses the
**toolbar-end** chip label to its leading icon (brand mark). End-lane children
never shrink (`flex-shrink: 0`), so mic + run action always stay inside the
shell.


## Non-goals

- Does not replace host menus, slash pickers, or auth flows.
- Does not replace `AgentChatView`'s `slots.composer` — hosts still pass the
  whole composer node; the shell + chrome are what that node is built from.
- Does not change `createComposerDraftStore` or transcript presentation.
