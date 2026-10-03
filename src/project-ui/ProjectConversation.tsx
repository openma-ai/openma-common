"use client";

import type { ReactNode } from "react";

import type { AgentUITurnState } from "../agent-ui/index.js";
import { AgentChatView } from "../chat-ui/index.js";
import { SessionTurnFrame } from "../session-ui/index.js";
import type { ProjectChatTurn } from "./project-goals.js";
import { ProjectMessageAttachments } from "./ProjectMessageAttachments.js";

/** Project delivery stays on the host client. The visible column is the shared chat shell. */
export function ProjectConversation({
  turns,
  composer,
  promptPayloads,
  cwd = null,
}: {
  turns: readonly ProjectChatTurn[];
  composer: ReactNode;
  promptPayloads?: ReadonlyMap<string, unknown>;
  cwd?: string | null;
}) {
  const chatTurns: AgentUITurnState[] = turns.map((turn) => ({
    id: turn.id,
    status: turn.status === "complete"
      ? "completed"
      : turn.status === "error"
        ? "failed"
        : turn.status,
    items: [],
  }));
  const turnsById = new Map(turns.map((turn) => [turn.id, turn] as const));
  return (
    <AgentChatView
      surface="project"
      sessionId={turns.at(-1)?.sessionId}
      phase="active"
      className="flex-1 text-sm"
      turns={chatTurns}
      renderTurn={({ turn }) => {
        const source = turnsById.get(turn.id);
        if (!source) return null;
        return (
          <div data-project-cwd={cwd ?? undefined}>
            <ProjectMessageAttachments payload={promptPayloads?.get(turn.id)} />
            <SessionTurnFrame
              turnId={source.id}
              sessionId={source.sessionId}
              promptText={source.promptText}
              status={source.status}
              errorMessage={source.errorMessage}
            >
              {source.assistantText ? <p className="project-answer">{source.assistantText}</p> : null}
              {source.thoughtText ? <p className="project-note">{source.thoughtText}</p> : null}
            </SessionTurnFrame>
          </div>
        );
      }}
      slots={{
        empty: null,
        composer,
      }}
    />
  );
}
