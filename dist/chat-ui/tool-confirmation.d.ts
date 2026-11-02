import { type ReactNode } from "react";
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
/**
 * Allow / Deny controls for Managed `always_ask` tool confirmations.
 *
 * Ported from Backchat's composer ask pattern (`Allow once` / `Deny` →
 * `user.tool_confirmation`). Hosts submit through their session events API.
 */
export declare function ToolConfirmationAsk({ actions, onSubmit, disabled, showDenyMessage, className, labels, }: ToolConfirmationAskProps): ReactNode;
//# sourceMappingURL=tool-confirmation.d.ts.map