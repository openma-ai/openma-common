import type { ReactNode } from "react";

export type SessionTurnStatus =
  | "queued"
  | "running"
  | "complete"
  | "completed"
  | "error"
  | "errored"
  | "cancelled"
  | "terminated";

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
export function SessionTurnFrame({
  turnId,
  sessionId,
  promptText,
  status,
  errorMessage,
  errorNotice,
  labels,
  children,
  className = "",
}: SessionTurnFrameProps) {
  const isStreaming = status === "running";
  const statusNode =
    (status === "error" || status === "errored") && errorNotice !== undefined
      ? errorNotice
      : renderStatus(status, errorMessage, labels);

  return (
    <article
      className={`group/turn reveal-in mb-6 space-y-2 ${className}`.trim()}
      data-turn-id={turnId}
      data-session-turn-status={status}
    >
      {promptText ? (
        <div
          className="group is-user ml-auto flex w-full max-w-[95%] flex-col items-end gap-2"
          data-session-turn-prompt="true"
        >
          <div className="is-user:dark ml-auto flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden rounded-lg bg-secondary px-4 py-3 text-sm text-foreground">
            <p className="whitespace-pre-wrap">{promptText}</p>
          </div>
        </div>
      ) : null}

      <div
        className="min-w-0"
        data-annotatable-response
        data-annotation-ready={!isStreaming}
        data-source-session-id={sessionId}
        data-source-turn-id={turnId}
      >
        <div className="min-w-0 space-y-2" data-session-turn-response="true">
          {children}
          {statusNode}
        </div>
      </div>
    </article>
  );
}

function renderStatus(
  status: SessionTurnStatus,
  errorMessage: string | undefined,
  labels: SessionTurnFrameLabels | undefined,
): ReactNode {
  if (status === "error" || status === "errored") {
    return (
      <p
        className="rounded-md bg-danger-subtle px-3 py-2 text-sm text-danger"
        data-session-turn-status-message="error"
        role="alert"
      >
        {errorMessage ?? labels?.failed ?? "Turn failed."}
      </p>
    );
  }
  if (status === "queued") {
    return (
      <p className="text-xs italic text-fg-subtle" data-session-turn-status-message="queued">
        {labels?.queued ?? "queued"}
      </p>
    );
  }
  if (status === "cancelled") {
    return (
      <p className="text-xs italic text-fg-subtle" data-session-turn-status-message="cancelled">
        {labels?.cancelled ?? "cancelled"}
      </p>
    );
  }
  if (status === "terminated") {
    return (
      <p className="text-xs italic text-fg-subtle" data-session-turn-status-message="terminated">
        {labels?.terminated ?? "terminated"}
      </p>
    );
  }
  return null;
}
