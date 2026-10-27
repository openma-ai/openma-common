"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { agentChatDensityAttributes, } from "./components.js";
import { chatClassNames } from "./utils.js";
/** Root column: body stack + bottom toolbar. */
export const COMPOSER_SHELL_CLASS = "openma-composer-shell";
/** Editable / content region above the toolbar. */
export const COMPOSER_BODY_CLASS = "openma-composer-body";
/** Bottom toolbar row: start (chips) | end (picker + run actions). */
export const COMPOSER_TOOLBAR_CLASS = "openma-composer-toolbar";
/** Left cluster: attach + host chips / accessories. */
export const COMPOSER_TOOLBAR_START_CLASS = "openma-composer-toolbar-start";
/** Right cluster: agent picker + mic / send / stop. */
export const COMPOSER_TOOLBAR_END_CLASS = "openma-composer-toolbar-end";
/** Opt-in clip box so focus rings are not shaved by overflow:hidden. */
export const COMPOSER_TOOLBAR_START_CLIP_CLASS = "openma-composer-toolbar-start--clip";
/**
 * Shared bottom-toolbar topology: `start` grows and truncates; `end` stays
 * shrink-0. Hosts inject product widgets; appearance is token-driven.
 */
export function ComposerToolbar({ start, end, className, startClassName, endClassName, clipStart = true, }) {
    return (_jsxs("div", { className: chatClassNames(COMPOSER_TOOLBAR_CLASS, className), "data-openma-composer-toolbar": "", children: [_jsx("div", { className: chatClassNames(COMPOSER_TOOLBAR_START_CLASS, clipStart && COMPOSER_TOOLBAR_START_CLIP_CLASS, startClassName), "data-openma-composer-toolbar-start": "", children: start }), _jsx("div", { className: chatClassNames(COMPOSER_TOOLBAR_END_CLASS, endClassName), "data-openma-composer-toolbar-end": "", "data-composer-run-actions": "true", children: end })] }));
}
/**
 * Product-agnostic composer chrome: body slot + bottom toolbar with
 * `start` | `end` flex topology. Hosts style via CSS custom properties
 * (see docs/chat-ui-composer-shell.md); widgets stay host-owned slots.
 */
export function ComposerShell({ density, slots, className, style, bodyClassName, toolbarClassName, toolbarStartClassName, toolbarEndClassName, clipToolbarStart = true, afterToolbar, ...rest }) {
    const densityAttributes = density
        ? agentChatDensityAttributes(density)
        : undefined;
    const mergedStyle = (() => {
        const fromDensity = densityAttributes?.style;
        if (!fromDensity && !style)
            return undefined;
        return { ...(fromDensity ?? {}), ...(style ?? {}) };
    })();
    const hasToolbar = slots?.toolbarStart != null || slots?.toolbarEnd != null;
    return (_jsxs("div", { ...rest, ...(densityAttributes
            ? { "data-chat-density": densityAttributes["data-chat-density"] }
            : {}), className: chatClassNames(COMPOSER_SHELL_CLASS, className), style: mergedStyle, "data-openma-composer-shell": "", children: [slots?.body != null ? (_jsx("div", { className: chatClassNames(COMPOSER_BODY_CLASS, bodyClassName), "data-openma-composer-body": "", children: slots.body })) : null, hasToolbar ? (_jsx(ComposerToolbar, { start: slots?.toolbarStart, end: slots?.toolbarEnd, className: toolbarClassName, startClassName: toolbarStartClassName, endClassName: toolbarEndClassName, clipStart: clipToolbarStart })) : null, afterToolbar] }));
}
//# sourceMappingURL=composer-shell.js.map