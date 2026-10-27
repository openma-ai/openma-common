"use client";

import type { ComponentProps, CSSProperties, ReactNode } from "react";

import {
  agentChatDensityAttributes,
  type AgentChatDensity,
} from "./components.js";
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
export const COMPOSER_TOOLBAR_START_CLIP_CLASS =
  "openma-composer-toolbar-start--clip";

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
export function ComposerToolbar({
  start,
  end,
  className,
  startClassName,
  endClassName,
  clipStart = true,
}: ComposerToolbarProps) {
  return (
    <div
      className={chatClassNames(COMPOSER_TOOLBAR_CLASS, className)}
      data-openma-composer-toolbar=""
    >
      <div
        className={chatClassNames(
          COMPOSER_TOOLBAR_START_CLASS,
          clipStart && COMPOSER_TOOLBAR_START_CLIP_CLASS,
          startClassName,
        )}
        data-openma-composer-toolbar-start=""
      >
        {start}
      </div>
      <div
        className={chatClassNames(COMPOSER_TOOLBAR_END_CLASS, endClassName)}
        data-openma-composer-toolbar-end=""
        data-composer-run-actions="true"
      >
        {end}
      </div>
    </div>
  );
}

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
export function ComposerShell({
  density,
  slots,
  className,
  style,
  bodyClassName,
  toolbarClassName,
  toolbarStartClassName,
  toolbarEndClassName,
  clipToolbarStart = true,
  afterToolbar,
  ...rest
}: ComposerShellProps) {
  const densityAttributes = density
    ? agentChatDensityAttributes(density)
    : undefined;
  const mergedStyle: CSSProperties | undefined = (() => {
    const fromDensity = densityAttributes?.style;
    if (!fromDensity && !style) return undefined;
    return { ...(fromDensity ?? {}), ...(style ?? {}) };
  })();

  const hasToolbar =
    slots?.toolbarStart != null || slots?.toolbarEnd != null;

  return (
    <div
      {...rest}
      {...(densityAttributes
        ? { "data-chat-density": densityAttributes["data-chat-density"] }
        : {})}
      className={chatClassNames(COMPOSER_SHELL_CLASS, className)}
      style={mergedStyle}
      data-openma-composer-shell=""
    >
      {slots?.body != null ? (
        <div
          className={chatClassNames(COMPOSER_BODY_CLASS, bodyClassName)}
          data-openma-composer-body=""
        >
          {slots.body}
        </div>
      ) : null}
      {hasToolbar ? (
        <ComposerToolbar
          start={slots?.toolbarStart}
          end={slots?.toolbarEnd}
          className={toolbarClassName}
          startClassName={toolbarStartClassName}
          endClassName={toolbarEndClassName}
          clipStart={clipToolbarStart}
        />
      ) : null}
      {afterToolbar}
    </div>
  );
}
