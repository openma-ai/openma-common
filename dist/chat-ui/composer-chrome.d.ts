import type { ComponentProps, ReactNode } from "react";
/** Backchat `composer-footer-trigger` chrome — transparent at rest, wash on hover/open. */
export declare const COMPOSER_CHIP_CLASS = "openma-composer-chip";
/** Square icon control (attach / mic / follow) inside the toolbar. */
export declare const COMPOSER_ICON_BUTTON_CLASS = "openma-composer-icon-button";
/** Enter / stop run affordance at toolbar end. */
export declare const COMPOSER_RUN_ACTION_CLASS = "openma-composer-run-action";
/** Stable data attribute for chip icon slot (Backchat `[data-control-icon]`). */
export declare const COMPOSER_CHIP_ICON_ATTR: "data-control-icon";
export declare function composerChipClass(...extra: Array<string | false | null | undefined>): string;
export declare function composerIconButtonClass(...extra: Array<string | false | null | undefined>): string;
export declare function composerRunActionClass(...extra: Array<string | false | null | undefined>): string;
/** Optional open-surface hint matching Backchat `composerFooterTriggerProps`. */
export declare function composerChipOpenSurfaceProps(openSurface?: "filled" | "none"): {
    "data-open-surface"?: "none";
};
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
export declare function ComposerChip({ className, icon, label, trailing, type, openSurface, ...rest }: ComposerChipProps): import("react").JSX.Element;
export type ComposerIconButtonProps = ComponentProps<"button">;
/** Attach / mic / follow square control — same height as chips. */
export declare function ComposerIconButton({ className, type, ...rest }: ComposerIconButtonProps): import("react").JSX.Element;
export type ComposerRunActionProps = ComponentProps<"button"> & {
    /** When true, marks stop primary (`data-composer-stop`); else submit. */
    stopPrimary?: boolean;
};
/**
 * Enter / stop affordance. One slot: glyph follows what Enter would do.
 * Hosts supply children (CornerDownLeft / square / spinner).
 */
export declare function ComposerRunAction({ className, type, stopPrimary, ...rest }: ComposerRunActionProps): import("react").JSX.Element;
//# sourceMappingURL=composer-chrome.d.ts.map