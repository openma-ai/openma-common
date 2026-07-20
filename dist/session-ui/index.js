import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Shared DOM shell for a Backchat/OpenManaged session turn.
 *
 * Product adapters keep ownership of Markdown, tools, plans, subagents, and
 * stores; this component owns the stable prompt/response hierarchy and status
 * semantics so both products can evolve those slots without forking the
 * session-level GUI structure again.
 */
export function SessionTurnFrame({ turnId, sessionId, promptText, status, errorMessage, errorNotice, labels, children, className = "", }) {
    const isStreaming = status === "running";
    const statusNode = (status === "error" || status === "errored") && errorNotice !== undefined
        ? errorNotice
        : renderStatus(status, errorMessage, labels);
    return (_jsxs("article", { className: `group/turn reveal-in mb-6 space-y-2 ${className}`.trim(), "data-turn-id": turnId, "data-session-turn-status": status, children: [promptText ? (_jsx("div", { className: "group is-user ml-auto flex w-full max-w-[95%] flex-col items-end gap-2", "data-session-turn-prompt": "true", children: _jsx("div", { className: "is-user:dark ml-auto flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden rounded-lg bg-secondary px-4 py-3 text-sm text-foreground", children: _jsx("p", { className: "whitespace-pre-wrap", children: promptText }) }) })) : null, _jsx("div", { className: "min-w-0", "data-annotatable-response": true, "data-annotation-ready": !isStreaming, "data-source-session-id": sessionId, "data-source-turn-id": turnId, children: _jsxs("div", { className: "min-w-0 space-y-2", "data-session-turn-response": "true", children: [children, statusNode] }) })] }));
}
function renderStatus(status, errorMessage, labels) {
    if (status === "error" || status === "errored") {
        return (_jsx("p", { className: "rounded-md bg-danger-subtle px-3 py-2 text-sm text-danger", "data-session-turn-status-message": "error", role: "alert", children: errorMessage ?? labels?.failed ?? "Turn failed." }));
    }
    if (status === "queued") {
        return (_jsx("p", { className: "text-xs italic text-fg-subtle", "data-session-turn-status-message": "queued", children: labels?.queued ?? "queued" }));
    }
    if (status === "cancelled") {
        return (_jsx("p", { className: "text-xs italic text-fg-subtle", "data-session-turn-status-message": "cancelled", children: labels?.cancelled ?? "cancelled" }));
    }
    if (status === "terminated") {
        return (_jsx("p", { className: "text-xs italic text-fg-subtle", "data-session-turn-status-message": "terminated", children: labels?.terminated ?? "terminated" }));
    }
    return null;
}
//# sourceMappingURL=index.js.map