"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { FolderIcon, FolderPlusIcon, StarIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { normalizeProjectFolders } from "./client.js";
import { ProjectButton, ProjectDialog, projectErrorText } from "./controls.js";
import { defaultCoordinatorConfig } from "./project-coordinator.js";
export function folderName(path) {
    const parts = path.split(/[\\/]+/).filter(Boolean);
    return parts.at(-1) ?? path;
}
export function ProjectFolderList({ folders, onAdd, onMakePrimary, onRemove, }) {
    if (folders.length === 0) {
        if (!onAdd) {
            return _jsx("p", { className: "project-note", children: "This host does not pick local folders." });
        }
        return (_jsxs("button", { type: "button", onClick: onAdd, className: "projects-empty", children: [_jsx(FolderPlusIcon, { className: "size-6", "aria-hidden": "true" }), _jsx("span", { children: "Add folders OpenMA can read and edit" })] }));
    }
    return (_jsxs("div", { children: [_jsx("ul", { children: folders.map((folder, index) => (_jsxs("li", { className: "project-worker", children: [_jsxs("span", { children: [_jsx(FolderIcon, { className: "size-3.5", "aria-hidden": "true" }), _jsx("span", { children: folderName(folder) }), _jsx("span", { title: folder, children: folder })] }), index === 0 ? (_jsxs("span", { children: [_jsx(StarIcon, { className: "size-3", "aria-hidden": "true" }), "Primary"] })) : (_jsx("button", { type: "button", onClick: () => onMakePrimary(folder), children: "Make primary" })), _jsx("button", { type: "button", onClick: () => onRemove(folder), "aria-label": `Remove folder: ${folderName(folder)}`, title: "Remove folder", children: _jsx(XIcon, { className: "size-3.5", "aria-hidden": "true" }) })] }, folder))) }), onAdd ? (_jsxs("button", { type: "button", onClick: onAdd, children: [_jsx(FolderPlusIcon, { className: "size-3.5", "aria-hidden": "true" }), "Add more folders"] })) : null] }));
}
export function CreateProjectDialog({ client, open, onOpenChange, onCreated, }) {
    const [name, setName] = useState("");
    const [goal, setGoal] = useState("");
    const [projectId, setProjectId] = useState(() => `proj-${crypto.randomUUID()}`);
    const [folders, setFolders] = useState([]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    useEffect(() => {
        if (!open) {
            setName("");
            setGoal("");
            setProjectId(`proj-${crypto.randomUUID()}`);
            setFolders([]);
            setSaving(false);
            setError("");
        }
    }, [open]);
    const addFolders = async () => {
        if (!client.pickFolders)
            return;
        try {
            const picked = await client.pickFolders({ defaultPath: folders[0] });
            if (picked.length === 0)
                return;
            setFolders((current) => [...new Set([...current, ...picked])]);
        }
        catch (cause) {
            setError(projectErrorText(cause));
        }
    };
    const create = async () => {
        const trimmedName = name.trim();
        if (!trimmedName || saving)
            return;
        setSaving(true);
        setError("");
        const normalized = normalizeProjectFolders({
            source_folders: folders,
            primary_folder: folders[0],
        });
        try {
            const project = await client.save({
                project_id: projectId,
                name: trimmedName,
                source_folders: [...normalized.source_folders],
                primary_folder: normalized.primary_folder,
            });
            if (goal.trim()) {
                await client.saveWork({
                    ...defaultCoordinatorConfig(project.id),
                    description: goal.trim(),
                });
            }
            onCreated(project);
            onOpenChange(false);
        }
        catch (cause) {
            setError(projectErrorText(cause));
            setSaving(false);
        }
    };
    return (_jsx(ProjectDialog, { open: open, title: "Create project", description: "Name the project, and optionally add a goal and source folders.", onClose: () => onOpenChange(false), children: _jsxs("form", { className: "project-form", onSubmit: (event) => {
                event.preventDefault();
                void create();
            }, children: [_jsxs("label", { className: "project-field", children: ["Project name", _jsx("input", { autoFocus: true, "aria-label": "Project name", value: name, placeholder: "Project name", onChange: (event) => setName(event.target.value) })] }), _jsxs("label", { className: "project-field", children: ["Goal", _jsx("textarea", { "aria-label": "Goal", value: goal, rows: 2, onChange: (event) => setGoal(event.target.value) })] }), _jsxs("div", { className: "project-field", children: [_jsx("span", { children: "Source folders" }), _jsx(ProjectFolderList, { folders: folders, onAdd: client.pickFolders ? () => void addFolders() : undefined, onMakePrimary: (folder) => setFolders((current) => [folder, ...current.filter((candidate) => candidate !== folder)]), onRemove: (folder) => setFolders((current) => current.filter((candidate) => candidate !== folder)) })] }), error ? _jsx("p", { role: "alert", className: "project-error", children: error }) : null, _jsxs("div", { className: "project-actions", children: [_jsx(ProjectButton, { variant: "ghost", onClick: () => onOpenChange(false), children: "Cancel" }), _jsx(ProjectButton, { type: "submit", disabled: !name.trim() || saving, children: saving ? "Creating…" : "Create project" })] })] }) }));
}
//# sourceMappingURL=CreateProjectDialog.js.map