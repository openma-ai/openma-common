"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { FileTextIcon } from "lucide-react";
export function ProjectMessageAttachments({ payload }) {
    const files = attachmentsFrom(payload);
    if (!files.length)
        return null;
    return (_jsx("div", { className: "project-attachment-row", "aria-label": "Message attachments", children: files.map((file) => (_jsx("a", { download: file.name, href: `data:${file.mimeType};base64,${file.data}`, className: "project-attachment", title: `Download ${file.name}`, children: file.kind === "image" ? (_jsx("img", { src: `data:${file.mimeType};base64,${file.data}`, alt: file.name, className: "max-h-40 max-w-full rounded" })) : (_jsxs("span", { className: "flex items-center gap-2", children: [_jsx(FileTextIcon, { className: "size-4", "aria-hidden": "true" }), file.name] })) }, file.id))) }));
}
function attachmentsFrom(payload) {
    if (!payload || typeof payload !== "object" || !("attachments" in payload))
        return [];
    const attachments = payload.attachments;
    if (!Array.isArray(attachments))
        return [];
    return attachments.filter(isAttachment);
}
function isAttachment(value) {
    if (!value || typeof value !== "object")
        return false;
    const file = value;
    return typeof file.id === "string"
        && typeof file.name === "string"
        && (file.kind === "image" || file.kind === "file")
        && typeof file.mimeType === "string"
        && typeof file.data === "string";
}
//# sourceMappingURL=ProjectMessageAttachments.js.map