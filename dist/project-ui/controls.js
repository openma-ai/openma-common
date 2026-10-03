"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function projectErrorText(error) {
    return error instanceof Error ? error.message : String(error);
}
export function ProjectButton({ variant = "primary", icon = false, className = "", type = "button", ...props }) {
    return (_jsx("button", { ...props, type: type, className: `project-button project-button-${variant}${icon ? " project-button-icon" : ""} ${className}`.trim() }));
}
export function ProjectDialog({ open, title, description, onClose, children, wide = false, }) {
    if (!open)
        return null;
    return (_jsx("div", { className: "project-dialog-backdrop", onMouseDown: (event) => {
            if (event.target === event.currentTarget)
                onClose();
        }, children: _jsxs("div", { role: "dialog", "aria-modal": "true", "aria-label": title, className: wide ? "project-dialog project-dialog-wide" : "project-dialog", children: [_jsxs("header", { className: "project-dialog-header", children: [_jsx("h2", { children: title }), description ? _jsx("p", { children: description }) : null] }), children] }) }));
}
//# sourceMappingURL=controls.js.map