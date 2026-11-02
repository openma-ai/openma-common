import { useState, type ReactNode } from "react";

import type { PendingManagedAction } from "../session-events/pending-actions.js";

export type ToolConfirmationDecision = "allow" | "deny";

export type ToolConfirmationSubmit = {
  toolUseId: string;
  result: ToolConfirmationDecision;
  denyMessage?: string;
};

export type ToolConfirmationAskProps = {
  /** Pending confirmation actions (`type === "confirmation"`). */
  actions: readonly PendingManagedAction[];
  /** Called when the user chooses Allow or Deny for one tool. */
  onSubmit: (decision: ToolConfirmationSubmit) => void | Promise<void>;
  disabled?: boolean;
  /** Optional deny-reason field (API `deny_message`). Off by default. */
  showDenyMessage?: boolean;
  className?: string;
  labels?: Partial<{
    eyebrow: string;
    allow: string;
    deny: string;
    denyMessagePlaceholder: string;
    awaitingNamed: (name: string) => string;
    awaitingGeneric: string;
  }>;
};

const defaultLabels = {
  eyebrow: "Approval required",
  allow: "Allow",
  deny: "Deny",
  denyMessagePlaceholder: "Optional reason for deny",
  awaitingNamed: (name: string) => `Allow this tool to run? · ${name}`,
  awaitingGeneric: "Allow this tool to run?",
};

function toolName(action: PendingManagedAction): string {
  const name = action.event.name ?? action.event.tool_name;
  return typeof name === "string" && name.trim() ? name.trim() : "tool";
}

function formatInput(input: unknown): string | null {
  if (input === undefined || input === null) return null;
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

/**
 * Allow / Deny controls for Managed `always_ask` tool confirmations.
 *
 * Ported from Backchat's composer ask pattern (`Allow once` / `Deny` →
 * `user.tool_confirmation`). Hosts submit through their session events API.
 */
export function ToolConfirmationAsk({
  actions,
  onSubmit,
  disabled = false,
  showDenyMessage = false,
  className,
  labels,
}: ToolConfirmationAskProps): ReactNode {
  const copy = { ...defaultLabels, ...labels };
  const confirmations = actions.filter((action) => action.type === "confirmation");
  if (confirmations.length === 0) return null;

  return (
    <div
      className={["oma-tool-confirmation", className].filter(Boolean).join(" ")}
      data-tool-confirmation="true"
      role="group"
      aria-label={copy.eyebrow}
    >
      {confirmations.map((action) => (
        <ToolConfirmationCard
          key={action.id}
          action={action}
          copy={copy}
          disabled={disabled}
          showDenyMessage={showDenyMessage}
          onSubmit={onSubmit}
        />
      ))}
    </div>
  );
}

function ToolConfirmationCard({
  action,
  copy,
  disabled,
  showDenyMessage,
  onSubmit,
}: {
  action: PendingManagedAction;
  copy: typeof defaultLabels;
  disabled: boolean;
  showDenyMessage: boolean;
  onSubmit: (decision: ToolConfirmationSubmit) => void | Promise<void>;
}) {
  const [pending, setPending] = useState<ToolConfirmationDecision | null>(null);
  const [denyMessage, setDenyMessage] = useState("");
  const name = toolName(action);
  const inputText = formatInput(action.event.input);
  const busy = disabled || pending !== null;

  const submit = async (result: ToolConfirmationDecision) => {
    if (busy) return;
    setPending(result);
    try {
      await onSubmit({
        toolUseId: action.id,
        result,
        ...(result === "deny" && denyMessage.trim()
          ? { denyMessage: denyMessage.trim() }
          : {}),
      });
    } catch {
      // Host owns error presentation; reset so the user can retry.
      setPending(null);
    }
  };

  return (
    <div
      className="oma-tool-confirmation__card"
      data-tool-confirmation-id={action.id}
      data-tool-confirmation-name={name}
    >
      <div className="oma-tool-confirmation__eyebrow">{copy.eyebrow}</div>
      <p className="oma-tool-confirmation__prompt">
        {name ? copy.awaitingNamed(name) : copy.awaitingGeneric}
      </p>
      {inputText ? (
        <pre
          className="oma-tool-confirmation__input"
          data-tool-confirmation-input={action.id}
        >
          {inputText}
        </pre>
      ) : null}
      {showDenyMessage ? (
        <label className="oma-tool-confirmation__deny-message">
          <span className="oma-tool-confirmation__deny-message-label">
            {copy.denyMessagePlaceholder}
          </span>
          <input
            type="text"
            value={denyMessage}
            disabled={busy}
            placeholder={copy.denyMessagePlaceholder}
            onChange={(event) => setDenyMessage(event.target.value)}
          />
        </label>
      ) : null}
      <div
        className="oma-tool-confirmation__actions"
        data-tool-confirmation-actions="true"
      >
        <button
          type="button"
          className="oma-tool-confirmation__button oma-tool-confirmation__button--deny"
          data-tool-confirmation-deny="true"
          disabled={busy}
          onClick={() => {
            void submit("deny");
          }}
        >
          {copy.deny}
        </button>
        <button
          type="button"
          className="oma-tool-confirmation__button oma-tool-confirmation__button--allow"
          data-tool-confirmation-allow="true"
          disabled={busy}
          onClick={() => {
            void submit("allow");
          }}
        >
          {copy.allow}
        </button>
      </div>
    </div>
  );
}
