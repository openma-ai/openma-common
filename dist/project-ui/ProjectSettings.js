"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { ArrowLeftIcon } from "lucide-react";
import { useState } from "react";
import { normalizeProjectFolders } from "./client.js";
import { ProjectButton, projectErrorText } from "./controls.js";
import { ProjectFolderList } from "./CreateProjectDialog.js";
import { ProjectEditor } from "./Projects.js";
import { useProjectView } from "./projects-query.js";
export function ProjectSettings({ client, projectId, onBack, onDeleted, }) {
    const query = useProjectView(client, projectId, 0);
    const [notice, setNotice] = useState("");
    if (query.isPending)
        return _jsx("p", { role: "status", className: "project-settings", children: "Loading\u2026" });
    if (query.error || !query.data) {
        return _jsx("p", { role: "alert", className: "project-settings", children: projectErrorText(query.error ?? "Project not found") });
    }
    return (_jsxs("div", { className: "project-settings", children: [notice ? _jsx("p", { role: "status", children: notice }) : null, _jsx(ProjectSettingsForm, { client: client, project: query.data.project, view: query.data, onBack: onBack, onDeleted: onDeleted, refresh: query.reload, onSaved: () => setNotice("Project settings saved.") }, `${projectId}:${query.data.project.updated_at}`)] }));
}
function ProjectSettingsForm({ client, project, view, onBack, onDeleted, refresh, onSaved, }) {
    const [name, setName] = useState(project.name);
    const [folders, setFolders] = useState(project.source_folders);
    const [coordinator, setCoordinator] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const save = async () => {
        setBusy(true);
        setError("");
        const normalized = normalizeProjectFolders({
            source_folders: folders,
            primary_folder: folders[0],
        });
        try {
            await client.save({
                project_id: project.id,
                name: name.trim(),
                source_folders: [...normalized.source_folders],
                primary_folder: normalized.primary_folder,
            });
            await refresh();
            onSaved();
        }
        catch (cause) {
            setError(projectErrorText(cause));
        }
        finally {
            setBusy(false);
        }
    };
    return (_jsxs(_Fragment, { children: [_jsxs("header", { children: [_jsx("h1", { children: "Project settings" }), onBack ? (_jsxs("button", { type: "button", onClick: onBack, children: [_jsx(ArrowLeftIcon, { className: "size-3.5", "aria-hidden": "true" }), _jsx("span", { children: project.name })] })) : null] }), _jsxs("form", { id: "project-settings-form", className: "project-form", onSubmit: (event) => {
                    event.preventDefault();
                    void save();
                }, children: [_jsxs("section", { children: [_jsx("h2", { children: "General" }), _jsxs("label", { className: "project-field", children: ["Name", _jsx("input", { "aria-label": "Project name", required: true, value: name, onChange: (event) => setName(event.target.value) })] })] }), _jsxs("section", { children: [_jsx("h2", { children: "Folders" }), _jsx(ProjectFolderList, { folders: folders, onAdd: client.pickFolders ? () => {
                                    void client.pickFolders?.().then((paths) => {
                                        setFolders((current) => [...new Set([...current, ...paths])]);
                                    }).catch((cause) => setError(projectErrorText(cause)));
                                } : undefined, onMakePrimary: (folder) => setFolders((current) => [folder, ...current.filter((path) => path !== folder)]), onRemove: (folder) => setFolders((current) => current.filter((path) => path !== folder)) })] }), error ? _jsx("p", { role: "alert", className: "project-error", children: error }) : null, _jsx("div", { className: "project-actions", children: _jsx(ProjectButton, { type: "submit", disabled: busy || !name.trim(), children: "Save" }) })] }), _jsxs("section", { children: [_jsx("h2", { children: "Execution" }), _jsx("p", { className: "project-note", children: "Choose the coordinator, worker, and where the project runs." }), _jsx(ProjectButton, { variant: "outline", onClick: () => setCoordinator(true), children: "Configure" })] }), coordinator ? (_jsx(ProjectEditor, { client: client, project: project, config: view.config ?? undefined, close: () => setCoordinator(false), saved: async () => {
                    setCoordinator(false);
                    await refresh();
                }, removed: async () => {
                    setCoordinator(false);
                    onDeleted?.();
                } })) : null] }));
}
//# sourceMappingURL=ProjectSettings.js.map