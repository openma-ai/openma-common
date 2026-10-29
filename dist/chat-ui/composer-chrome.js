"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { chatClassNames } from "./utils.js";
/** Backchat `composer-footer-trigger` chrome — transparent at rest, wash on hover/open. */
export const COMPOSER_CHIP_CLASS = "openma-composer-chip";
/** Backchat alias — same chrome class as `COMPOSER_CHIP_CLASS`. */
export const COMPOSER_TOOLBAR_CHIP_CLASS = COMPOSER_CHIP_CLASS;
/** Square icon control (attach / mic / follow) inside the toolbar. */
export const COMPOSER_ICON_BUTTON_CLASS = "openma-composer-icon-button";
/** Enter / stop run affordance at toolbar end. */
export const COMPOSER_RUN_ACTION_CLASS = "openma-composer-run-action";
/** Stable data attribute for chip icon slot (Backchat `[data-control-icon]`). */
export const COMPOSER_CHIP_ICON_ATTR = "data-control-icon";
export function composerChipClass(...extra) {
    return chatClassNames(COMPOSER_CHIP_CLASS, ...extra);
}
export function composerIconButtonClass(...extra) {
    return chatClassNames(COMPOSER_ICON_BUTTON_CLASS, ...extra);
}
export function composerRunActionClass(...extra) {
    return chatClassNames(COMPOSER_RUN_ACTION_CLASS, ...extra);
}
/** Optional open-surface hint matching Backchat `composerFooterTriggerProps`. */
export function composerChipOpenSurfaceProps(openSurface = "filled") {
    return openSurface === "none" ? { "data-open-surface": "none" } : {};
}
/**
 * Shared composer toolbar chip: icon + label + optional trailing.
 * Appearance is token-driven (see `.openma-composer-chip` in styles.css).
 * Hosts own menu/popover wiring; this is the trigger chrome only.
 */
export function ComposerChip({ className, icon, label, trailing, type = "button", openSurface = "filled", ...rest }) {
    return (_jsxs("button", { type: type, className: composerChipClass(className), "data-openma-composer-chip": "", ...composerChipOpenSurfaceProps(openSurface), ...rest, children: [icon != null ? _jsx("span", { "data-control-icon": "", children: icon }) : null, label != null ? (_jsx("span", { "data-openma-composer-chip-label": "", className: "openma-composer-chip-label", children: label })) : null, trailing] }));
}
/** Attach / mic / follow square control — same height as chips. */
export function ComposerIconButton({ className, type = "button", ...rest }) {
    return (_jsx("button", { type: type, className: composerIconButtonClass(className), "data-openma-composer-icon-button": "", ...rest }));
}
/**
 * Enter / stop affordance. One slot: glyph follows what Enter would do.
 * Hosts supply children (CornerDownLeft / square / spinner).
 */
export function ComposerRunAction({ className, type = "button", stopPrimary = false, ...rest }) {
    return (_jsx("button", { type: type, className: composerRunActionClass(className), "data-openma-composer-run-action": "", "data-composer-submit": stopPrimary ? undefined : "true", "data-composer-stop": stopPrimary ? "true" : undefined, ...rest }));
}
//# sourceMappingURL=composer-chrome.js.map