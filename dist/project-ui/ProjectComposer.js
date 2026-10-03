"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { CornerDownLeftIcon, LoaderCircleIcon, PlusIcon } from "lucide-react";
import { useRef, useState } from "react";
import { ProjectButton } from "./controls.js";
/** Presentational composer. Delivery stays with the host's `ProjectClient.submit`. */
export function ProjectComposer({ agentId, agentLabel, placeholder, busy, onSubmit, onEditAgents, role = "Coordinator", label = "Message coordinator", }) {
    const [text, setText] = useState("");
    const [attachments, setAttachments] = useState([]);
    const [error, setError] = useState("");
    const sending = useRef(false);
    const input = useRef(null);
    const fileInput = useRef(null);
    const send = async () => {
        if ((!text.trim() && attachments.length === 0) || busy || sending.current)
            return;
        sending.current = true;
        const submitted = text;
        const files = attachments;
        try {
            if (await onSubmit(submitted.trim(), files)) {
                setText((current) => (current === submitted ? "" : current));
                setAttachments([]);
                setError("");
            }
        }
        finally {
            sending.current = false;
            input.current?.focus();
        }
    };
    const addFiles = async (list) => {
        if (!list?.length || busy)
            return;
        setError("");
        const next = [];
        for (const file of list) {
            if (file.size > 1_500_000) {
                setError("Choose a file under 1.5 MB.");
                continue;
            }
            next.push(await readAttachment(file));
        }
        if (next.length)
            setAttachments((current) => [...current, ...next]);
    };
    return (_jsxs("div", { className: "project-composer", children: [error ? _jsx("p", { role: "alert", className: "project-error", children: error }) : null, _jsxs("div", { className: "project-composer-surface", children: [attachments.length ? (_jsx("ul", { className: "project-attachment-row", "aria-label": "Pending attachments", children: attachments.map((file) => (_jsx("li", { children: _jsxs("button", { type: "button", className: "project-attachment", onClick: () => setAttachments((current) => current.filter((item) => item.id !== file.id)), children: ["Remove ", file.name] }) }, file.id))) })) : null, _jsx("textarea", { ref: input, "aria-label": label, placeholder: placeholder, value: text, disabled: busy, onChange: (event) => setText(event.target.value), onKeyDown: (event) => {
                            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                                event.preventDefault();
                                void send();
                            }
                        } }), _jsxs("div", { className: "project-composer-bar", children: [_jsx(ProjectButton, { variant: "ghost", icon: true, "aria-label": "Attach files", title: "Attach files", disabled: busy, onClick: () => fileInput.current?.click(), children: _jsx(PlusIcon, { className: "size-4", "aria-hidden": "true" }) }), _jsx("input", { ref: fileInput, className: "project-sr", type: "file", multiple: true, "aria-label": "Choose attachments", onChange: (event) => {
                                    void addFiles(event.target.files);
                                    event.target.value = "";
                                } }), _jsxs("button", { type: "button", onClick: onEditAgents, "aria-label": "Edit project settings", className: "project-button project-button-ghost", style: { marginRight: "auto" }, children: [_jsx("span", { children: agentLabel ?? agentId }), _jsxs("span", { "aria-hidden": "true", children: ["\u00B7 ", role] })] }), _jsx(ProjectButton, { icon: true, "aria-label": "Send message", title: "Send message", "data-composer-submit": "true", disabled: busy || (!text.trim() && attachments.length === 0), onClick: () => void send(), children: busy ? (_jsx(LoaderCircleIcon, { className: "size-4", "aria-hidden": "true" })) : (_jsx(CornerDownLeftIcon, { className: "size-4", "aria-hidden": "true" })) })] })] })] }));
}
async function readAttachment(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (const byte of bytes)
        binary += String.fromCharCode(byte);
    return {
        id: crypto.randomUUID(),
        name: file.name,
        kind: file.type.startsWith("image/") ? "image" : "file",
        mimeType: file.type || "application/octet-stream",
        data: btoa(binary),
    };
}
//# sourceMappingURL=ProjectComposer.js.map