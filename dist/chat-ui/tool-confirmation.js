import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
const defaultLabels = {
    eyebrow: "Approval required",
    allow: "Allow",
    deny: "Deny",
    denyMessagePlaceholder: "Optional reason for deny",
    awaitingNamed: (name) => `Allow this tool to run? · ${name}`,
    awaitingGeneric: "Allow this tool to run?",
};
function toolName(action) {
    const name = action.event.name ?? action.event.tool_name;
    return typeof name === "string" && name.trim() ? name.trim() : "tool";
}
function formatInput(input) {
    if (input === undefined || input === null)
        return null;
    if (typeof input === "string")
        return input;
    try {
        return JSON.stringify(input, null, 2);
    }
    catch {
        return String(input);
    }
}
/**
 * Allow / Deny controls for Managed `always_ask` tool confirmations.
 *
 * Ported from Backchat's composer ask pattern (`Allow once` / `Deny` →
 * `user.tool_confirmation`). Hosts submit through their session events API.
 */
export function ToolConfirmationAsk({ actions, onSubmit, disabled = false, showDenyMessage = false, className, labels, }) {
    const copy = { ...defaultLabels, ...labels };
    const confirmations = actions.filter((action) => action.type === "confirmation");
    if (confirmations.length === 0)
        return null;
    return (_jsx("div", { className: ["oma-tool-confirmation", className].filter(Boolean).join(" "), "data-tool-confirmation": "true", role: "group", "aria-label": copy.eyebrow, children: confirmations.map((action) => (_jsx(ToolConfirmationCard, { action: action, copy: copy, disabled: disabled, showDenyMessage: showDenyMessage, onSubmit: onSubmit }, action.id))) }));
}
function ToolConfirmationCard({ action, copy, disabled, showDenyMessage, onSubmit, }) {
    const [pending, setPending] = useState(null);
    const [denyMessage, setDenyMessage] = useState("");
    const name = toolName(action);
    const inputText = formatInput(action.event.input);
    const busy = disabled || pending !== null;
    const submit = async (result) => {
        if (busy)
            return;
        setPending(result);
        try {
            await onSubmit({
                toolUseId: action.id,
                result,
                ...(result === "deny" && denyMessage.trim()
                    ? { denyMessage: denyMessage.trim() }
                    : {}),
            });
        }
        catch {
            // Host owns error presentation; reset so the user can retry.
            setPending(null);
        }
    };
    return (_jsxs("div", { className: "oma-tool-confirmation__card", "data-tool-confirmation-id": action.id, "data-tool-confirmation-name": name, children: [_jsx("div", { className: "oma-tool-confirmation__eyebrow", children: copy.eyebrow }), _jsx("p", { className: "oma-tool-confirmation__prompt", children: name ? copy.awaitingNamed(name) : copy.awaitingGeneric }), inputText ? (_jsx("pre", { className: "oma-tool-confirmation__input", "data-tool-confirmation-input": action.id, children: inputText })) : null, showDenyMessage ? (_jsxs("label", { className: "oma-tool-confirmation__deny-message", children: [_jsx("span", { className: "oma-tool-confirmation__deny-message-label", children: copy.denyMessagePlaceholder }), _jsx("input", { type: "text", value: denyMessage, disabled: busy, placeholder: copy.denyMessagePlaceholder, onChange: (event) => setDenyMessage(event.target.value) })] })) : null, _jsxs("div", { className: "oma-tool-confirmation__actions", "data-tool-confirmation-actions": "true", children: [_jsx("button", { type: "button", className: "oma-tool-confirmation__button oma-tool-confirmation__button--deny", "data-tool-confirmation-deny": "true", disabled: busy, onClick: () => {
                            void submit("deny");
                        }, children: copy.deny }), _jsx("button", { type: "button", className: "oma-tool-confirmation__button oma-tool-confirmation__button--allow", "data-tool-confirmation-allow": "true", disabled: busy, onClick: () => {
                            void submit("allow");
                        }, children: copy.allow })] })] }));
}
//# sourceMappingURL=tool-confirmation.js.map