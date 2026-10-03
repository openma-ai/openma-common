"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { AgentChatView } from "../chat-ui/index.js";
import { SessionTurnFrame } from "../session-ui/index.js";
import { ProjectMessageAttachments } from "./ProjectMessageAttachments.js";
/** Project delivery stays on the host client. The visible column is the shared chat shell. */
export function ProjectConversation({ turns, composer, promptPayloads, cwd = null, }) {
    const chatTurns = turns.map((turn) => ({
        id: turn.id,
        status: turn.status === "complete"
            ? "completed"
            : turn.status === "error"
                ? "failed"
                : turn.status,
        items: [],
    }));
    const turnsById = new Map(turns.map((turn) => [turn.id, turn]));
    return (_jsx(AgentChatView, { surface: "project", sessionId: turns.at(-1)?.sessionId, phase: "active", className: "flex-1 text-sm", turns: chatTurns, renderTurn: ({ turn }) => {
            const source = turnsById.get(turn.id);
            if (!source)
                return null;
            return (_jsxs("div", { "data-project-cwd": cwd ?? undefined, children: [_jsx(ProjectMessageAttachments, { payload: promptPayloads?.get(turn.id) }), _jsxs(SessionTurnFrame, { turnId: source.id, sessionId: source.sessionId, promptText: source.promptText, status: source.status, errorMessage: source.errorMessage, children: [source.assistantText ? _jsx("p", { className: "project-answer", children: source.assistantText }) : null, source.thoughtText ? _jsx("p", { className: "project-note", children: source.thoughtText }) : null] })] }));
        }, slots: {
            empty: null,
            composer,
        } }));
}
//# sourceMappingURL=ProjectConversation.js.map