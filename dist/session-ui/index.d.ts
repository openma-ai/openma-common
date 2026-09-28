import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { type ReactNode } from "react";
export interface SessionRunHarness {
    id: string;
    label: string;
}
export interface SessionRunControlsProps {
    activeHarnessId: string;
    harnesses: readonly SessionRunHarness[];
    configOptions: readonly SessionConfigOption[];
    disabled?: boolean;
    className?: string;
    onSelectHarness(harnessId: string): void;
    onSetConfigOption(configId: string, value: string | boolean): void;
}
export interface SessionHistoryItem {
    id: string;
    title: string;
}
export interface SessionHistoryMenuProps {
    activeSessionId: string;
    sessions: readonly SessionHistoryItem[];
    className?: string;
    onSelectSession(sessionId: string): void;
}
export declare function OpenMAMark({ className }: {
    className?: string;
}): import("react").JSX.Element;
/** Shared Backchat session switcher. Hosts own placement; common owns the
 * accessible menu behavior and visual vocabulary so it never falls back to a
 * platform-native select. */
export declare function SessionHistoryMenu({ activeSessionId, sessions, className, onSelectSession, }: SessionHistoryMenuProps): import("react").JSX.Element;
export declare function HarnessIcon({ harnessId, label, className, size, }: {
    harnessId: string;
    label?: string;
    className?: string;
    size?: number | string;
}): import("react").JSX.Element;
export declare function SessionRunControls({ activeHarnessId, harnesses, configOptions, disabled, className, onSelectHarness, onSetConfigOption, }: SessionRunControlsProps): import("react").JSX.Element;
export declare function flattenSessionConfigSelectOptions(options: Extract<SessionConfigOption, {
    type: "select";
}>["options"]): Array<{
    value: string;
    name: string;
    group?: string;
}>;
export type SessionTurnStatus = "queued" | "running" | "complete" | "completed" | "error" | "errored" | "cancelled" | "unknown" | "terminated";
export interface SessionTurnFrameLabels {
    queued?: ReactNode;
    cancelled?: ReactNode;
    unknown?: ReactNode;
    terminated?: ReactNode;
    failed?: ReactNode;
}
export interface SessionTurnFrameProps {
    turnId: string;
    sessionId?: string;
    promptText?: string;
    /** Product-owned prompt body when mentions or attachments need richer UI. */
    promptNode?: ReactNode;
    status: SessionTurnStatus;
    errorMessage?: string;
    errorNotice?: ReactNode;
    labels?: SessionTurnFrameLabels;
    hideStatusMessage?: boolean;
    children?: ReactNode;
    className?: string;
}
export interface SessionTurnFooterLabels {
    copyAnswer: string;
    answerCopied: string;
    continueInNewChat: string;
}
export interface SessionTurnFooterProps {
    status: SessionTurnStatus;
    timestamp?: number | string;
    copyText: string;
    labels: SessionTurnFooterLabels;
    onFork?: () => void;
    /** Host override for desktop bridges and deterministic interaction tests. */
    writeClipboard?: (text: string) => void | Promise<void>;
    /** Host override when product locale formatting differs from the browser. */
    formatTimestamp?: (timestamp: number | string) => ReactNode;
}
/**
 * Shared DOM shell for a Backchat/OpenManaged session turn.
 *
 * Product adapters keep ownership of Markdown, tools, plans, subagents, and
 * stores; this component owns the stable prompt/response hierarchy and status
 * semantics so both products can evolve those slots without forking the
 * session-level GUI structure again.
 */
export declare function SessionTurnFrame({ turnId, sessionId, promptText, promptNode, status, errorMessage, errorNotice, labels, hideStatusMessage, children, className, }: SessionTurnFrameProps): import("react").JSX.Element;
/** Backchat-compatible metadata and actions for the end of a session turn. */
export declare function SessionTurnFooter({ status, timestamp, copyText, labels, onFork, writeClipboard, formatTimestamp, }: SessionTurnFooterProps): import("react").JSX.Element;
//# sourceMappingURL=index.d.ts.map