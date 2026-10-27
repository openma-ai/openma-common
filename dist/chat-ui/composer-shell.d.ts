import type { ComponentProps, ReactNode } from "react";
import { type AgentChatDensity } from "./components.js";
/** Root column: body stack + bottom toolbar. */
export declare const COMPOSER_SHELL_CLASS = "openma-composer-shell";
/** Editable / content region above the toolbar. */
export declare const COMPOSER_BODY_CLASS = "openma-composer-body";
/** Bottom toolbar row: start (chips) | end (picker + run actions). */
export declare const COMPOSER_TOOLBAR_CLASS = "openma-composer-toolbar";
/** Left cluster: attach + host chips / accessories. */
export declare const COMPOSER_TOOLBAR_START_CLASS = "openma-composer-toolbar-start";
/** Right cluster: agent picker + mic / send / stop. */
export declare const COMPOSER_TOOLBAR_END_CLASS = "openma-composer-toolbar-end";
/** Opt-in clip box so focus rings are not shaved by overflow:hidden. */
export declare const COMPOSER_TOOLBAR_START_CLIP_CLASS = "openma-composer-toolbar-start--clip";
export type ComposerShellSlots = {
    /** Textarea / editor / attachment strips. */
    body?: ReactNode;
    /** Attach control + permission / config chips. */
    toolbarStart?: ReactNode;
    /** Agent picker + mic / send / stop. */
    toolbarEnd?: ReactNode;
};
export type ComposerToolbarProps = {
    start?: ReactNode;
    end?: ReactNode;
    className?: string;
    startClassName?: string;
    endClassName?: string;
    /**
     * Negative margin + matching padding so overflow:hidden still leaves room
     * for focus rings (Backchat `composer-toolbar-chip-row` pattern). Default true.
     */
    clipStart?: boolean;
};
/**
 * Shared bottom-toolbar topology: `start` grows and truncates; `end` stays
 * shrink-0. Hosts inject product widgets; appearance is token-driven.
 */
export declare function ComposerToolbar({ start, end, className, startClassName, endClassName, clipStart, }: ComposerToolbarProps): import("react").JSX.Element;
export type ComposerShellProps = Omit<ComponentProps<"div">, "children"> & {
    density?: AgentChatDensity;
    slots?: ComposerShellSlots;
    bodyClassName?: string;
    toolbarClassName?: string;
    toolbarStartClassName?: string;
    toolbarEndClassName?: string;
    /** See {@link ComposerToolbarProps.clipStart}. Default true. */
    clipToolbarStart?: boolean;
    /**
     * Optional trailing content after the toolbar (slash menus stay host-owned
     * siblings outside the shell in Backchat; prefer that when possible).
     */
    afterToolbar?: ReactNode;
};
/**
 * Product-agnostic composer chrome: body slot + bottom toolbar with
 * `start` | `end` flex topology. Hosts style via CSS custom properties
 * (see docs/chat-ui-composer-shell.md); widgets stay host-owned slots.
 */
export declare function ComposerShell({ density, slots, className, style, bodyClassName, toolbarClassName, toolbarStartClassName, toolbarEndClassName, clipToolbarStart, afterToolbar, ...rest }: ComposerShellProps): import("react").JSX.Element;
//# sourceMappingURL=composer-shell.d.ts.map