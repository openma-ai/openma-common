import type { ReactNode } from "react";
export type SessionTurnStatus = "queued" | "running" | "complete" | "completed" | "error" | "errored" | "cancelled" | "terminated";
export interface SessionTurnFrameLabels {
    queued?: string;
    cancelled?: string;
    terminated?: string;
    failed?: string;
}
export interface SessionTurnFrameProps {
    turnId: string;
    sessionId?: string;
    promptText?: string;
    status: SessionTurnStatus;
    errorMessage?: string;
    errorNotice?: ReactNode;
    labels?: SessionTurnFrameLabels;
    children?: ReactNode;
    className?: string;
}
/**
 * Shared DOM shell for a Backchat/OpenManaged session turn.
 *
 * Product adapters keep ownership of Markdown, tools, plans, subagents, and
 * stores; this component owns the stable prompt/response hierarchy and status
 * semantics so both products can evolve those slots without forking the
 * session-level GUI structure again.
 */
export declare function SessionTurnFrame({ turnId, sessionId, promptText, status, errorMessage, errorNotice, labels, children, className, }: SessionTurnFrameProps): import("react").JSX.Element;
//# sourceMappingURL=index.d.ts.map