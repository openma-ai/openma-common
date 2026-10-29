"use client";

import type { ComponentProps, ReactNode } from "react";

import { chatClassNames } from "./utils.js";

/** Backchat `composer-footer-trigger` chrome — transparent at rest, wash on hover/open. */
export const COMPOSER_CHIP_CLASS = "openma-composer-chip";
/** Square icon control (attach / mic / follow) inside the toolbar. */
export const COMPOSER_ICON_BUTTON_CLASS = "openma-composer-icon-button";
/** Enter / stop run affordance at toolbar end. */
export const COMPOSER_RUN_ACTION_CLASS = "openma-composer-run-action";
/** Stable data attribute for chip icon slot (Backchat `[data-control-icon]`). */
export const COMPOSER_CHIP_ICON_ATTR = "data-control-icon" as const;

export function composerChipClass(...extra: Array<string | false | null | undefined>) {
  return chatClassNames(COMPOSER_CHIP_CLASS, ...extra);
}

export function composerIconButtonClass(
  ...extra: Array<string | false | null | undefined>
) {
  return chatClassNames(COMPOSER_ICON_BUTTON_CLASS, ...extra);
}

export function composerRunActionClass(
  ...extra: Array<string | false | null | undefined>
) {
  return chatClassNames(COMPOSER_RUN_ACTION_CLASS, ...extra);
}

/** Optional open-surface hint matching Backchat `composerFooterTriggerProps`. */
export function composerChipOpenSurfaceProps(
  openSurface: "filled" | "none" = "filled",
): { "data-open-surface"?: "none" } {
  return openSurface === "none" ? { "data-open-surface": "none" } : {};
}

export type ComposerChipProps = Omit<ComponentProps<"button">, "children"> & {
  /** Leading icon (shield / preset / brand). Wrapped in `[data-control-icon]`. */
  icon?: ReactNode;
  /** Chip label text / nodes. */
  label?: ReactNode;
  /** Trailing chevron or accessory. */
  trailing?: ReactNode;
  openSurface?: "filled" | "none";
};

/**
 * Shared composer toolbar chip: icon + label + optional trailing.
 * Appearance is token-driven (see `.openma-composer-chip` in styles.css).
 * Hosts own menu/popover wiring; this is the trigger chrome only.
 */
export function ComposerChip({
  className,
  icon,
  label,
  trailing,
  type = "button",
  openSurface = "filled",
  ...rest
}: ComposerChipProps) {
  return (
    <button
      type={type}
      className={composerChipClass(className)}
      data-openma-composer-chip=""
      {...composerChipOpenSurfaceProps(openSurface)}
      {...rest}
    >
      {icon != null ? <span data-control-icon="">{icon}</span> : null}
      {label != null ? (
        <span data-openma-composer-chip-label="" className="openma-composer-chip-label">
          {label}
        </span>
      ) : null}
      {trailing}
    </button>
  );
}

export type ComposerIconButtonProps = ComponentProps<"button">;

/** Attach / mic / follow square control — same height as chips. */
export function ComposerIconButton({
  className,
  type = "button",
  ...rest
}: ComposerIconButtonProps) {
  return (
    <button
      type={type}
      className={composerIconButtonClass(className)}
      data-openma-composer-icon-button=""
      {...rest}
    />
  );
}

export type ComposerRunActionProps = ComponentProps<"button"> & {
  /** When true, marks stop primary (`data-composer-stop`); else submit. */
  stopPrimary?: boolean;
};

/**
 * Enter / stop affordance. One slot: glyph follows what Enter would do.
 * Hosts supply children (CornerDownLeft / square / spinner).
 */
export function ComposerRunAction({
  className,
  type = "button",
  stopPrimary = false,
  ...rest
}: ComposerRunActionProps) {
  return (
    <button
      type={type}
      className={composerRunActionClass(className)}
      data-openma-composer-run-action=""
      data-composer-submit={stopPrimary ? undefined : "true"}
      data-composer-stop={stopPrimary ? "true" : undefined}
      {...rest}
    />
  );
}
