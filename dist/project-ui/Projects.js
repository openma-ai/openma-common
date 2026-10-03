"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { ArrowLeftIcon, CheckIcon, CirclePauseIcon, CirclePlayIcon, FileTextIcon, FolderIcon, ListTodoIcon, PencilIcon, PlusIcon, SettingsIcon, XIcon, } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { normalizeProjectFolders } from "./client.js";
import { ProjectButton, ProjectDialog, projectErrorText } from "./controls.js";
import { CreateProjectDialog, ProjectFolderList } from "./CreateProjectDialog.js";
import { ProjectComposer } from "./ProjectComposer.js";
import { ProjectConversation } from "./ProjectConversation.js";
import { ProjectMessageAttachments } from "./ProjectMessageAttachments.js";
import { defaultCoordinatorConfig } from "./project-coordinator.js";
import { projectCoordinatorTurns, projectGoalPresentation, projectOutcomeLabel, projectResponseText, projectThreads, } from "./project-goals.js";
import { useProjectView, useProjects } from "./projects-query.js";
const CONTROLS = ["delegate", "steer", "cancel", "complete"];
export function ProjectsPage({ client, projectId: controlledProjectId, onProjectIdChange, refreshIntervalMs = 1500, }) {
    const projects = useProjects(client);
    const controlled = onProjectIdChange !== undefined;
    const [uncontrolledId, setUncontrolledId] = useState(null);
    const projectId = controlled ? controlledProjectId ?? null : uncontrolledId;
    const setProjectId = (next) => {
        if (!controlled)
            setUncontrolledId(next);
        onProjectIdChange?.(next);
    };
    const workspace = useProjectView(client, projectId, refreshIntervalMs);
    const [search, setSearch] = useState("");
    const [creating, setCreating] = useState(false);
    const [editing, setEditing] = useState(false);
    const project = workspace.data?.project;
    const visible = projects.data?.filter((item) => item.name.toLowerCase().includes(search.toLowerCase()));
    return (_jsxs("div", { className: "projects-page", children: [projectId && workspace.isPending ? (_jsx("div", { className: "project-loading", role: "status", children: "Opening project\u2026" })) : null, workspace.error && projectId ? (_jsxs("div", { role: "alert", className: "project-error", children: [projectErrorText(workspace.error), " ", _jsx("button", { type: "button", onClick: () => setProjectId(null), children: "Back to projects" })] })) : null, !projectId ? (_jsxs("div", { className: "projects-index", children: [_jsxs("header", { className: "projects-list-header", children: [_jsxs("div", { children: [_jsx("h1", { children: "Projects" }), _jsx("p", { children: "Keep your conversations, knowledge, and work together." })] }), _jsxs(ProjectButton, { onClick: () => setCreating(true), children: [_jsx(PlusIcon, { className: "size-4", "aria-hidden": "true" }), "New project"] })] }), _jsx("input", { className: "projects-search", "aria-label": "Search projects", placeholder: "Search projects", value: search, onChange: (event) => setSearch(event.target.value) }), projects.error ? _jsx("p", { role: "alert", children: projectErrorText(projects.error) }) : null, projects.isPending ? _jsx("p", { role: "status", children: "Loading projects\u2026" }) : (_jsx("div", { className: "projects-grid", children: visible?.map((item) => (_jsxs("button", { type: "button", "data-project-id": item.id, className: "project-card", onClick: () => setProjectId(item.id), children: [_jsx(FolderIcon, { className: "size-5", "aria-hidden": "true" }), _jsx("h2", { children: item.name }), _jsx("p", { children: item.primary_folder || "Conversations and project knowledge" }), _jsxs("span", { children: ["Updated ", new Date(item.updated_at).toLocaleDateString()] })] }, item.id))) })), !projects.isPending && !projects.data?.length ? (_jsxs("div", { className: "projects-empty", children: [_jsx(FolderIcon, { className: "size-9", "aria-hidden": "true" }), _jsx("h2", { children: "A place for work that continues" }), _jsx("p", { children: "Create a project, add what your agents should know, and start a conversation." }), _jsx(ProjectButton, { variant: "outline", onClick: () => setCreating(true), children: "Create your first project" })] })) : null, projects.data?.length && visible && !visible.length ? (_jsxs("p", { className: "projects-empty", children: ["No projects match \u201C", search, "\u201D."] })) : null] })) : workspace.data ? (_jsx(ProjectWorkspace, { client: client, view: workspace.data, refresh: async () => {
                    await Promise.all([projects.reload(), workspace.reload()]);
                }, edit: () => setEditing(true) }, projectId)) : null, _jsx(CreateProjectDialog, { client: client, open: creating && !projectId, onOpenChange: setCreating, onCreated: (created) => {
                    void projects.reload();
                    setProjectId(created.id);
                } }), editing && project ? (_jsx(ProjectEditor, { client: client, project: project, config: workspace.data?.config ?? undefined, close: () => setEditing(false), saved: async (id) => {
                    setEditing(false);
                    await projects.reload();
                    await workspace.reload();
                    setProjectId(id);
                }, removed: async () => {
                    setEditing(false);
                    setProjectId(null);
                    await projects.reload();
                } })) : null] }));
}
export function ProjectEditor({ client, project, config, close, saved, removed, }) {
    const creating = !project;
    const [draft, setDraft] = useState(() => config ?? defaultCoordinatorConfig(project?.id ?? `proj-${crypto.randomUUID()}`));
    const [name, setName] = useState(project?.name ?? "");
    const [folders, setFolders] = useState(() => uniqueFolders(project));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [section, setSection] = useState("general");
    const cloud = draft.execution?.kind === "cloud";
    const field = (key, value) => {
        setDraft((current) => ({ ...current, [key]: value }));
    };
    const addFolders = async () => {
        if (!client.pickFolders)
            return;
        try {
            const selected = await client.pickFolders();
            setFolders((current) => [...new Set([...current, ...selected])]);
        }
        catch (cause) {
            setError(projectErrorText(cause));
        }
    };
    const save = async () => {
        if (busy || !name.trim())
            return;
        setBusy(true);
        setError("");
        try {
            if (!creating && (!draft.coordinatorAgent.trim() || !draft.workerAgent.trim())) {
                setSection("agents");
                throw new Error("Choose a coordinator and worker agent to finish setup.");
            }
            if (cloud && (!draft.coordinatorEnvironment?.trim() || !draft.workerEnvironment?.trim())) {
                setSection("agents");
                throw new Error("Choose an environment for both agents.");
            }
            const normalized = normalizeProjectFolders({
                source_folders: folders,
                primary_folder: folders[0],
            });
            await client.save({
                project_id: draft.projectId,
                name: name.trim(),
                source_folders: [...normalized.source_folders],
                primary_folder: normalized.primary_folder,
            });
            await client.saveWork(draft);
            await saved(draft.projectId);
        }
        catch (cause) {
            setError(projectErrorText(cause));
        }
        finally {
            setBusy(false);
        }
    };
    const folderPicker = (_jsx(ProjectFolderList, { folders: folders, onAdd: client.pickFolders ? () => void addFolders() : undefined, onMakePrimary: (folder) => setFolders((current) => [folder, ...current.filter((path) => path !== folder)]), onRemove: (folder) => setFolders((current) => current.filter((path) => path !== folder)) }));
    return (_jsx(ProjectDialog, { open: true, wide: true, title: creating ? "New project" : "Coordinator settings", description: creating
            ? "Start with a goal. You can configure your agents later."
            : "Manage your project’s context and execution.", onClose: close, children: _jsxs("form", { className: "project-form", onSubmit: (event) => {
                event.preventDefault();
                void save();
            }, children: [creating ? (_jsxs("div", { className: "space-y-5", children: [_jsx(Basics, { name: name, setName: setName, draft: draft, field: field }), _jsxs("details", { children: [_jsx("summary", { children: "Add context (optional)" }), _jsxs("div", { children: [folderPicker, _jsxs("label", { className: "project-field", children: ["Context", _jsx("textarea", { "aria-label": "Context", rows: 3, value: draft.context, onChange: (event) => field("context", event.target.value) })] })] })] })] })) : (_jsxs(_Fragment, { children: [_jsx("div", { className: "project-tabs", role: "tablist", "aria-label": "Project settings sections", children: ["general", "context", "agents"].map((item) => (_jsx("button", { type: "button", role: "tab", "aria-selected": section === item, onClick: () => setSection(item), children: item === "general" ? "General" : item === "context" ? "Context" : "Agents" }, item))) }), section === "general" ? (_jsxs("div", { children: [_jsx(Basics, { name: name, setName: setName, draft: draft, field: field }), _jsxs("details", { children: [_jsx("summary", { children: "Advanced" }), _jsxs("label", { className: "project-field", children: ["Conversation continuity", _jsxs("select", { "aria-label": "Conversation continuity", value: draft.continuity, onChange: (event) => field("continuity", event.target.value), children: [_jsx("option", { value: "per-scope", children: "Continue across this project" }), _jsx("option", { value: "per-run", children: "Separate conversations for each run" })] })] }), _jsxs("fieldset", { children: [_jsx("legend", { children: "Coordinator controls" }), _jsx("div", { children: CONTROLS.map((control) => (_jsxs("label", { className: "project-check", children: [_jsx("input", { type: "checkbox", checked: draft.controls.includes(control), onChange: (event) => field("controls", toggleControl(draft.controls, control, event.target.checked)) }), control] }, control))) })] })] })] })) : null, section === "context" ? (_jsxs("div", { children: [cloud ? (_jsx(RepositoryFields, { draft: draft, field: field })) : (_jsxs("div", { children: [_jsx("p", { children: "Source folders" }), folderPicker, _jsxs("label", { className: "project-field", children: ["Base branch or commit", _jsx("input", { "aria-label": "Base branch or commit", value: draft.baseRef ?? "", onChange: (event) => field("baseRef", event.target.value) })] }), _jsx("p", { className: "project-note", children: "New threads start from committed code. Existing threads keep their workspace." })] })), _jsxs("label", { className: "project-field", children: ["Instructions", _jsx("textarea", { "aria-label": "Instructions", rows: 3, value: draft.instructions, onChange: (event) => field("instructions", event.target.value) })] }), _jsxs("label", { className: "project-field", children: ["Context", _jsx("textarea", { "aria-label": "Context", rows: 3, value: draft.context, onChange: (event) => field("context", event.target.value) })] })] })) : null, section === "agents" ? (_jsxs("div", { children: [_jsxs("label", { className: "project-field", children: ["Execution location", _jsxs("select", { "aria-label": "Execution location", value: cloud ? "cloud" : "local", disabled: Boolean(config?.coordinatorAgent), onChange: (event) => {
                                                const execution = event.target.value === "cloud"
                                                    ? { kind: "cloud", ...(draft.execution?.kind === "cloud" ? draft.execution : {}) }
                                                    : { kind: "local" };
                                                setDraft((current) => ({ ...current, execution }));
                                            }, children: [_jsx("option", { value: "local", children: "This computer" }), _jsx("option", { value: "cloud", children: "Cloud" })] })] }), _jsx("p", { className: "project-note", children: cloud
                                        ? "Runs through the host’s Projects worker."
                                        : "The host needs to stay available while agents work." }), _jsxs("label", { className: "project-field", children: ["Coordinator agent", _jsx("input", { "aria-label": "Coordinator agent", value: draft.coordinatorAgent, onChange: (event) => field("coordinatorAgent", event.target.value) })] }), _jsxs("label", { className: "project-field", children: ["Worker agent", _jsx("input", { "aria-label": "Worker agent", value: draft.workerAgent, onChange: (event) => field("workerAgent", event.target.value) })] }), cloud ? (_jsxs(_Fragment, { children: [_jsxs("label", { className: "project-field", children: ["Coordinator environment", _jsx("input", { "aria-label": "Coordinator environment", value: draft.coordinatorEnvironment ?? "", onChange: (event) => field("coordinatorEnvironment", event.target.value) })] }), _jsxs("label", { className: "project-field", children: ["Worker environment", _jsx("input", { "aria-label": "Worker environment", value: draft.workerEnvironment ?? "", onChange: (event) => field("workerEnvironment", event.target.value) })] })] })) : null] })) : null] })), error ? _jsx("p", { role: "alert", className: "project-error", children: error }) : null, _jsxs("div", { className: "project-actions", children: [!creating && project ? (_jsx(ProjectButton, { variant: "ghost", disabled: busy, style: { marginRight: "auto" }, onClick: () => {
                                setBusy(true);
                                setError("");
                                void client.delete(project.id).then(removed).catch((cause) => {
                                    setError(projectErrorText(cause));
                                }).finally(() => setBusy(false));
                            }, children: "Delete project" })) : null, _jsx(ProjectButton, { variant: "ghost", disabled: busy, onClick: close, children: "Cancel" }), _jsx(ProjectButton, { type: "submit", disabled: busy || !name.trim(), children: creating ? "Create project" : "Save project" })] })] }) }));
}
function Basics({ name, setName, draft, field, }) {
    return (_jsxs("div", { children: [_jsxs("label", { className: "project-field", children: ["Project name", _jsx("input", { required: true, value: name, onChange: (event) => setName(event.target.value), placeholder: "e.g. Improve checkout" })] }), _jsxs("label", { className: "project-field", children: ["Goal ", _jsx("span", { className: "project-note", children: "(optional)" }), _jsx("textarea", { "aria-label": "Goal", rows: 3, value: draft.description, onChange: (event) => field("description", event.target.value) })] })] }));
}
function RepositoryFields({ draft, field, }) {
    const repositories = draft.repositories ?? [];
    return (_jsxs("div", { children: [_jsx("p", { children: "Repositories" }), repositories.map((repo, index) => (_jsxs("div", { children: [_jsx("input", { "aria-label": `Repository ${index + 1}`, value: repo.url, placeholder: "https://github.com/owner/repo", onChange: (event) => field("repositories", repositories.map((item, itemIndex) => itemIndex === index ? { ...item, url: event.target.value } : item)) }), _jsx("input", { "aria-label": `Base reference ${index + 1}`, value: repo.baseRef ?? "", placeholder: "Default branch", onChange: (event) => field("repositories", repositories.map((item, itemIndex) => itemIndex === index ? { ...item, baseRef: event.target.value } : item)) }), _jsx(ProjectButton, { variant: "ghost", onClick: () => field("repositories", repositories.filter((_, itemIndex) => itemIndex !== index)), children: "Remove" })] }, index))), _jsxs(ProjectButton, { variant: "outline", disabled: repositories.length >= 8, onClick: () => field("repositories", [...repositories, { url: "" }]), children: [_jsx(PlusIcon, { className: "size-4", "aria-hidden": "true" }), "Add repository"] })] }));
}
function ProjectOutcomeBar({ goal, busy, onPause, onResume, }) {
    const presentation = projectGoalPresentation(goal);
    return (_jsxs("section", { className: `project-outcome project-outcome-${presentation.tone}`, "aria-label": "Project outcome", children: [_jsxs("div", { className: "project-outcome-copy", children: [_jsx("span", { className: "project-outcome-label", children: "Outcome" }), _jsx("strong", { title: presentation.title, children: presentation.title }), _jsxs("span", { className: "project-outcome-status", children: [projectOutcomeLabel(goal.status), presentation.budgetLabel ? ` · ${presentation.budgetLabel} tokens` : ""] })] }), _jsxs("div", { className: "project-outcome-actions", children: [presentation.actions.pause ? (_jsxs(ProjectButton, { variant: "outline", disabled: busy, onClick: onPause, children: [_jsx(CirclePauseIcon, { className: "size-3.5", "aria-hidden": "true" }), "Pause"] })) : null, presentation.actions.resume ? (_jsxs(ProjectButton, { variant: "outline", disabled: busy, onClick: onResume, children: [_jsx(CirclePlayIcon, { className: "size-3.5", "aria-hidden": "true" }), "Resume"] })) : null] })] }));
}
function ProjectWorkspace({ client, view, refresh, edit, }) {
    const { project, config, facts } = view;
    const [tab, setTab] = useState("conversation");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [action, setAction] = useState(null);
    const [resource, setResource] = useState(false);
    const [selectedWorker, setSelectedWorker] = useState(null);
    const [runId, setRunId] = useState(() => {
        const last = facts.events.at(-1)?.payload;
        const saved = payloadRecord(last).runId;
        return typeof saved === "string" ? saved : crypto.randomUUID();
    });
    const uncertainSubmission = useRef(null);
    const runScoped = config?.continuity === "per-run";
    const sessions = facts.sessions.filter((session) => !runScoped || session.workThreadId.includes(`:run:${runId}:`));
    const coordinator = sessions.filter((session) => session.agentId === "coordinator");
    const workers = sessions.filter((session) => session.agentId === "worker");
    const threads = projectThreads(view, runScoped ? runId : undefined);
    const coordinatorOutcome = threads.find((thread) => thread.role === "coordinator")?.goal;
    const coordinatorTurns = projectCoordinatorTurns(view, runScoped ? runId : undefined);
    const promptPayloads = new Map(coordinatorTurns.map((turn) => {
        const source = facts.turns.find((item) => item.id === turn.id);
        const payload = facts.events.find((event) => event.id === source?.triggerEventId)?.payload;
        return [turn.id, payload];
    }));
    const runs = [...new Set(facts.events.map((event) => {
            const id = payloadRecord(event.payload).runId;
            return typeof id === "string" ? id : "";
        }).filter(Boolean))];
    const setCoordinatorOutcome = async (status) => {
        if (!coordinatorOutcome)
            return;
        setBusy(true);
        setError("");
        try {
            await client.goal({
                projectId: project.id,
                workThreadId: coordinatorOutcome.workThreadId,
                status,
            });
            await refresh();
        }
        catch (cause) {
            setError(projectErrorText(cause));
        }
        finally {
            setBusy(false);
        }
    };
    const submit = async (type, message, workerId, attachments) => {
        setBusy(true);
        setError("");
        const fingerprint = JSON.stringify([type, message, workerId, runId, attachments]);
        const pending = uncertainSubmission.current?.fingerprint === fingerprint
            ? uncertainSubmission.current
            : { fingerprint, id: crypto.randomUUID() };
        uncertainSubmission.current = pending;
        try {
            await client.submit({
                projectId: project.id,
                commandId: pending.id,
                type,
                text: message,
                ...(attachments?.length ? { attachments } : {}),
                ...(workerId ? { workerId } : {}),
                ...(runScoped ? { runId } : {}),
            });
            uncertainSubmission.current = null;
            await refresh();
            return true;
        }
        catch (cause) {
            setError(projectErrorText(cause));
            return false;
        }
        finally {
            setBusy(false);
        }
    };
    const ready = Boolean(config?.coordinatorAgent && config.workerAgent);
    return (_jsxs(_Fragment, { children: [_jsxs("header", { className: "project-topbar", children: [_jsx("button", { type: "button", className: "project-title", title: project.name, onClick: edit, children: project.name }), _jsxs(ProjectButton, { variant: tab !== "conversation" ? "outline" : "ghost", "aria-pressed": tab !== "conversation", onClick: () => {
                            setSelectedWorker(null);
                            setTab(tab === "conversation" ? "workers" : "conversation");
                        }, children: [_jsx(ListTodoIcon, { className: "size-3.5", "aria-hidden": "true" }), "Tasks"] }), _jsx(ProjectButton, { variant: "ghost", icon: true, "aria-label": "Project settings", onClick: edit, children: _jsx(SettingsIcon, { className: "size-4", "aria-hidden": "true" }) })] }), _jsxs("div", { className: `project-columns${tab !== "conversation" ? " project-panel-open" : ""}`, children: [_jsxs("section", { className: "project-main", children: [runScoped ? (_jsxs("div", { className: "project-runs", children: [_jsx("select", { "aria-label": "Select run", value: runId, onChange: (event) => setRunId(event.target.value), children: [...new Set([...runs, runId])].map((id, index) => (_jsxs("option", { value: id, children: ["Run ", index + 1, " \u00B7 ", id.slice(0, 8)] }, id))) }), _jsxs(ProjectButton, { variant: "ghost", onClick: () => setRunId(crypto.randomUUID()), children: [_jsx(PlusIcon, { className: "size-4", "aria-hidden": "true" }), "New run"] })] })) : null, coordinatorOutcome ? (_jsx(ProjectOutcomeBar, { goal: coordinatorOutcome, busy: busy, onPause: () => void setCoordinatorOutcome("paused"), onResume: () => void setCoordinatorOutcome("active") })) : null, ready && config ? (_jsx(ProjectConversation, { turns: coordinatorTurns, cwd: project.primary_folder || null, promptPayloads: promptPayloads, composer: _jsx(ProjectComposer, { agentId: config.coordinatorAgent, placeholder: `Message ${project.name}…`, busy: busy, onSubmit: (message, attachments) => submit("message", message, undefined, attachments), onEditAgents: edit }, `${project.id}:${runId}`) })) : (_jsxs("div", { className: "projects-empty", children: [_jsx("h2", { children: "Make this project your own" }), _jsx("p", { children: "Choose your agents and add instructions to begin." }), _jsx(ProjectButton, { onClick: edit, children: "Set up coordinator" })] })), error || view.error ? _jsx("p", { role: "alert", className: "project-error", children: error || view.error }) : null] }), tab !== "conversation" ? (_jsxs("aside", { className: "project-side-panel", "aria-label": tab === "overview" ? "Project overview" : tab === "workers" ? "Project workers" : "Project activity", children: [_jsxs("div", { className: "project-side-heading", children: [selectedWorker && tab === "workers" ? (_jsxs(ProjectButton, { variant: "ghost", onClick: () => setSelectedWorker(null), children: [_jsx(ArrowLeftIcon, { className: "size-4", "aria-hidden": "true" }), "Threads"] })) : (_jsx("div", { className: "project-tabs", role: "tablist", "aria-label": "Project views", children: ["workers", "overview", "activity"].map((item) => (_jsx("button", { type: "button", role: "tab", "aria-selected": tab === item, onClick: () => {
                                                setSelectedWorker(null);
                                                setTab(item);
                                            }, children: item === "workers" ? "Threads" : item === "overview" ? "Library" : "Activity" }, item))) })), _jsx(ProjectButton, { variant: "ghost", icon: true, "aria-label": "Close panel", onClick: () => setTab("conversation"), children: _jsx(XIcon, { className: "size-4", "aria-hidden": "true" }) })] }), _jsxs("div", { className: "project-panel-content", children: [selectedWorker && tab === "workers" ? (_jsx(ProjectWorkerDetail, { view: view, workerId: selectedWorker, busy: busy, submit: (message, attachments) => submit("steer", message, selectedWorker, attachments), edit: edit })) : null, tab === "overview" && !selectedWorker ? (_jsx(ProjectLibrary, { client: client, view: view, edit: edit, refresh: refresh, onError: setError, onAddResource: () => setResource(true) })) : null, tab === "workers" && !selectedWorker ? (_jsx(ProjectWorkers, { view: view, workers: workers, threads: threads, config: config, onOpen: setSelectedWorker, onDelegate: () => setAction({ type: "delegate" }), onSteer: (workerId) => setAction({ type: "steer", workerId }), onCancel: (workerId) => void submit("cancel", "Cancelled by user", workerId) })) : null, tab === "activity" ? (_jsx(ProjectActivity, { view: view, canComplete: Boolean(config?.controls.includes("complete")), onComplete: () => setAction({ type: "complete" }) })) : null] })] })) : null, action ? (_jsx(ProjectAction, { error: error, action: action, close: () => setAction(null), submit: async (message, id) => {
                            if (await submit(action.type, message, id))
                                setAction(null);
                        } })) : null, resource && config ? (_jsx(ResourceEditor, { close: () => setResource(false), save: async (item) => {
                            await client.saveWork({ ...config, resources: [...config.resources, item] });
                            setResource(false);
                            await refresh();
                        } })) : null] })] }));
}
function ProjectLibrary({ client, view, edit, refresh, onError, onAddResource, }) {
    const config = view.config;
    return (_jsxs("div", { className: "project-knowledge", "aria-label": "Project knowledge", children: [_jsxs("div", { className: "project-knowledge-heading", children: [_jsx("h2", { children: "Project knowledge" }), _jsx(ProjectButton, { variant: "ghost", icon: true, "aria-label": "Edit knowledge", onClick: edit, children: _jsx(PencilIcon, { className: "size-4", "aria-hidden": "true" }) })] }), _jsxs("section", { children: [_jsx("h3", { children: "Instructions" }), _jsx("p", { children: config?.instructions || "No instructions yet." }), !config?.instructions ? _jsx("button", { type: "button", onClick: edit, children: "Add instructions" }) : null] }), _jsxs("section", { children: [_jsx("h3", { children: "Context" }), config?.description ? _jsx("p", { children: config.description }) : null, _jsx("p", { children: config?.context || "No additional context." })] }), _jsxs("section", { children: [_jsxs("div", { className: "project-knowledge-heading", children: [_jsx("h3", { children: "Resources" }), config ? (_jsx(ProjectButton, { variant: "ghost", icon: true, "aria-label": "Add resource", onClick: onAddResource, children: _jsx(PlusIcon, { className: "size-4", "aria-hidden": "true" }) })) : null] }), config?.resources.map((resource) => (_jsxs("details", { className: "project-resource", children: [_jsxs("summary", { children: [_jsx(FileTextIcon, { className: "size-4", "aria-hidden": "true" }), resource.name] }), _jsx("p", { children: resource.text }), _jsxs(ProjectButton, { variant: "ghost", onClick: () => {
                                    void client.saveWork({
                                        ...config,
                                        resources: config.resources.filter((item) => item.id !== resource.id),
                                    }).then(refresh).catch((cause) => onError(projectErrorText(cause)));
                                }, children: [_jsx(XIcon, { className: "size-4", "aria-hidden": "true" }), "Remove"] })] }, resource.id))), !config?.resources.length ? _jsx("p", { children: "No resources yet." }) : null] }), _jsxs("section", { className: "project-runtime-summary", children: [_jsx("h3", { children: "Agents" }), _jsxs("dl", { children: [_jsx("dt", { children: "Coordinator" }), _jsx("dd", { children: config?.coordinatorAgent || "Not configured" }), _jsx("dt", { children: "Workers" }), _jsx("dd", { children: config?.workerAgent || "Not configured" })] })] }), _jsx(Worktrees, { client: client, projectId: view.project.id, onError: onError })] }));
}
function Worktrees({ client, projectId, onError, }) {
    const [trees, setTrees] = useState(null);
    const [name, setName] = useState("");
    useEffect(() => {
        if (!client.listWorktrees)
            return;
        let active = true;
        void client.listWorktrees(projectId).then((next) => {
            if (active)
                setTrees(next);
        }, (cause) => {
            if (active)
                onError(projectErrorText(cause));
        });
        return () => {
            active = false;
        };
    }, [client, onError, projectId]);
    if (!client.listWorktrees)
        return null;
    return (_jsxs("section", { "aria-label": "Worktrees", children: [_jsx("h3", { children: "Worktrees" }), trees?.map((tree) => (_jsxs("article", { className: "project-worker", children: [_jsxs("div", { children: [_jsx("strong", { children: tree.name }), _jsxs("p", { children: [tree.branch ?? "Detached", " \u00B7 ", tree.paths.join(", ") || "No checkout path"] })] }), client.deleteWorktree ? (_jsx(ProjectButton, { variant: "ghost", onClick: () => {
                            void client.deleteWorktree?.(tree.id).then(async () => {
                                setTrees(await client.listWorktrees?.(projectId) ?? []);
                            }).catch((cause) => onError(projectErrorText(cause)));
                        }, children: "Remove worktree" })) : null] }, tree.id))), !trees?.length ? _jsx("p", { children: "No worktrees yet." }) : null, client.createWorktree ? (_jsxs("form", { className: "project-form", onSubmit: (event) => {
                    event.preventDefault();
                    const trimmed = name.trim();
                    if (!trimmed)
                        return;
                    void client.createWorktree?.({ projectId, name: trimmed }).then(async () => {
                        setName("");
                        setTrees(await client.listWorktrees?.(projectId) ?? []);
                    }).catch((cause) => onError(projectErrorText(cause)));
                }, children: [_jsxs("label", { className: "project-field", children: ["New worktree", _jsx("input", { "aria-label": "New worktree", value: name, onChange: (event) => setName(event.target.value) })] }), _jsx(ProjectButton, { type: "submit", variant: "outline", disabled: !name.trim(), children: "Create worktree" })] })) : null] }));
}
function ProjectWorkers({ view, workers, threads, config, onOpen, onDelegate, onSteer, onCancel, }) {
    const count = workers.length + (view.external_tasks?.length ?? 0);
    return (_jsxs("div", { className: "project-work-list", children: [_jsxs("div", { className: "project-panel-summary", children: [_jsx("span", { children: count ? `${count} threads` : "No tasks yet" }), config?.controls.includes("delegate") ? (_jsx(ProjectButton, { variant: "ghost", icon: true, "aria-label": "Delegate task", title: "Delegate task", onClick: onDelegate, children: _jsx(PlusIcon, { className: "size-3.5", "aria-hidden": "true" }) })) : null] }), !workers.length && !view.external_tasks?.length ? (_jsxs("div", { className: "project-workers-empty", children: [_jsx("h3", { children: "Tasks appear here" }), _jsx("p", { children: "Delegated work shows up as its own thread." })] })) : null, ["running", "queued", "failed", "completed", "cancelled", "other"].map((state) => {
                const group = workers.filter((worker) => {
                    const status = view.facts.turns.filter((turn) => turn.sessionId === worker.id).at(-1)?.state ?? "other";
                    return status === state;
                });
                if (!group.length)
                    return null;
                const labels = {
                    running: "Working",
                    queued: "Queued",
                    failed: "Failed",
                    completed: "Completed",
                    cancelled: "Cancelled",
                    other: "No turns yet",
                };
                return (_jsxs("section", { className: "project-worker-group", children: [_jsxs("h3", { children: [labels[state], " ", _jsx("span", { children: group.length })] }), group.map((session) => {
                            const workerId = workerIdFromThread(session.workThreadId);
                            const turns = view.facts.turns.filter((turn) => turn.sessionId === session.id);
                            const last = turns.at(-1);
                            const workspace = view.workspaces?.find((item) => item.workThreadId === session.workThreadId);
                            const outcome = threads.find((thread) => thread.workThreadId === session.workThreadId)?.goal;
                            const preview = projectResponseText(view.facts.agentEvents.filter((event) => event.turn_id === last?.id)).slice(0, 160);
                            return (_jsxs("article", { className: "project-worker", children: [_jsxs("div", { children: [_jsx("button", { type: "button", className: "project-worker-title", onClick: () => onOpen(workerId), children: workerId }), _jsx("p", { className: "project-worker-attribution", children: "Built-in coordinator" }), _jsx("p", { className: "project-worker-preview", children: preview || "Waiting for output…" }), workspace?.location ? (_jsxs("p", { children: [workspace.location.branch ? `${workspace.location.branch} · ` : "", workspace.location.cwd ?? `OpenMA session ${workspace.location.remoteSessionId ?? ""}`] })) : null, _jsxs("span", { children: [last?.state ?? session.state ?? "open", " \u00B7 ", config?.workerAgent] }), outcome ? _jsxs("span", { className: "project-worker-outcome", children: ["Outcome: ", projectOutcomeLabel(outcome.status)] }) : null] }), _jsxs("div", { className: "project-worker-actions", children: [config?.controls.includes("steer") ? (_jsx(ProjectButton, { variant: "outline", onClick: () => onSteer(workerId), children: "Steer" })) : null, config?.controls.includes("cancel") && last && ["queued", "running"].includes(last.state) ? (_jsx(ProjectButton, { variant: "ghost", onClick: () => onCancel(workerId), children: "Cancel" })) : null, _jsx(ProjectButton, { variant: "ghost", onClick: () => onOpen(workerId), children: "View thread" })] })] }, session.id));
                        })] }, state));
            }), view.external_tasks?.map((task) => (_jsxs("article", { className: "project-worker", "data-external-task": "true", children: [_jsx("p", { className: "project-worker-title", children: task.text }), task.status === "cancelled" ? _jsx("span", { children: "Cancelled" }) : null, task.coordinator_name ? _jsx("span", { children: task.coordinator_name }) : null] }, task.id)))] }));
}
function ProjectActivity({ view, canComplete, onComplete, }) {
    return (_jsxs("div", { className: "project-work-list", children: [_jsxs("div", { className: "project-section-heading", children: [_jsx("h2", { children: "Activity history" }), canComplete ? (_jsxs(ProjectButton, { variant: "outline", onClick: onComplete, children: [_jsx(CheckIcon, { className: "size-4", "aria-hidden": "true" }), "Complete project"] })) : null] }), !view.facts.events.length ? (_jsx("p", { className: "project-help", children: "Activity appears when you send a message or delegate work." })) : null, [...view.facts.events].reverse().map((event) => {
                const reaction = view.facts.reactions.find((item) => item.eventId === event.id);
                return (_jsxs("details", { className: "project-activity", children: [_jsxs("summary", { children: [_jsx("span", { children: event.type.replace("backchat.project.", "").replace("project.", "").replaceAll(".", " ") }), _jsx("span", { children: reaction?.status ?? "Processing" }), _jsx("time", { children: new Date(event.occurredAt).toLocaleTimeString() })] }), _jsx("pre", { children: JSON.stringify(event.payload, null, 2) }), reaction?.reason ? _jsx("p", { children: reaction.reason }) : null] }, event.id));
            })] }));
}
function ProjectWorkerDetail({ view, workerId, busy, submit, edit, }) {
    const sessions = view.facts.sessions.filter((session) => session.agentId === "worker" && session.workThreadId.endsWith(`:worker:${workerId}`));
    const turns = view.facts.turns.filter((turn) => sessions.some((session) => session.id === turn.sessionId));
    return (_jsxs("div", { className: "project-thread-detail", children: [_jsxs("div", { className: "project-thread-transcript", children: [_jsx("h2", { children: workerId }), turns.map((turn) => {
                        const trigger = view.facts.events.find((event) => event.id === turn.triggerEventId);
                        const payload = payloadRecord(trigger?.payload);
                        const prompt = stringField(payload, "text") || stringField(payload, "task") || stringField(payload, "instruction");
                        const text = projectResponseText(view.facts.agentEvents.filter((event) => event.turn_id === turn.id));
                        return (_jsxs("article", { className: "project-turn", children: [prompt ? _jsx("div", { className: "project-user-message", children: prompt }) : null, _jsx(ProjectMessageAttachments, { payload: trigger?.payload }), _jsx("p", { className: "project-answer", children: text || (turn.state === "running" ? "Working…" : "No output yet.") }), _jsx("p", { className: "project-turn-state", children: turn.state })] }, turn.id));
                    })] }), view.config?.controls.includes("steer") ? (_jsx(ProjectComposer, { agentId: view.config.workerAgent, role: "Worker", label: "Message worker", placeholder: "Follow up with this worker\u2026", busy: busy, onSubmit: (message, attachments) => submit(message, attachments), onEditAgents: edit })) : null] }));
}
function ProjectAction({ action, close, submit, error, }) {
    const [text, setText] = useState("");
    const [workerId, setWorkerId] = useState(action.workerId ?? "");
    const [busy, setBusy] = useState(false);
    const label = action.type === "delegate" ? "Delegate" : action.type === "steer" ? "Steer" : "Complete";
    return (_jsx(ProjectDialog, { open: true, title: `${label}${action.type === "complete" ? " project" : " task"}`, description: action.type === "steer"
            ? "Queue a follow-up instruction for this worker."
            : action.type === "complete"
                ? "Record a reviewed summary of this project’s work."
                : "Give this independent task a stable name and a clear brief.", onClose: close, children: _jsxs("form", { className: "project-form", onSubmit: (event) => {
                event.preventDefault();
                setBusy(true);
                void submit(text, workerId).finally(() => setBusy(false));
            }, children: [action.type !== "complete" ? (_jsxs("label", { className: "project-field", children: ["Worker ID", _jsx("input", { required: true, value: workerId, readOnly: Boolean(action.workerId), onChange: (event) => setWorkerId(event.target.value) })] })) : null, _jsxs("label", { className: "project-field", children: [action.type === "complete" ? "Summary" : action.type === "steer" ? "Instruction" : "Task", _jsx("textarea", { required: true, rows: 5, value: text, onChange: (event) => setText(event.target.value) })] }), error ? _jsx("p", { role: "alert", className: "project-error", children: error }) : null, _jsxs("div", { className: "project-actions", children: [_jsx(ProjectButton, { variant: "ghost", onClick: close, children: "Cancel" }), _jsx(ProjectButton, { type: "submit", disabled: busy, children: label })] })] }) }));
}
function ResourceEditor({ close, save, }) {
    const [text, setText] = useState("");
    const [name, setName] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    return (_jsx(ProjectDialog, { open: true, title: "Add project resource", description: "Add a note or a text file. It is included in project context.", onClose: close, children: _jsxs("form", { className: "project-form", onSubmit: (event) => {
                event.preventDefault();
                setBusy(true);
                void save({ id: crypto.randomUUID(), name, text })
                    .catch((cause) => setError(projectErrorText(cause)))
                    .finally(() => setBusy(false));
            }, children: [_jsxs("label", { className: "project-field", children: ["Text file", _jsx("input", { type: "file", accept: ".txt,.md,.csv,.json,text/plain", onChange: (event) => {
                                const file = event.target.files?.[0];
                                if (!file)
                                    return;
                                if (file.size > 200_000) {
                                    setError("Choose a text file under 200 KB.");
                                    return;
                                }
                                setName(file.name);
                                void file.text().then(setText);
                            } })] }), _jsxs("label", { className: "project-field", children: ["Resource name", _jsx("input", { required: true, value: name, onChange: (event) => setName(event.target.value) })] }), _jsxs("label", { className: "project-field", children: ["Content", _jsx("textarea", { required: true, rows: 7, value: text, onChange: (event) => setText(event.target.value) })] }), error ? _jsx("p", { role: "alert", className: "project-error", children: error }) : null, _jsxs("div", { className: "project-actions", children: [_jsx(ProjectButton, { variant: "ghost", onClick: close, children: "Cancel" }), _jsx(ProjectButton, { type: "submit", disabled: busy, children: "Add resource" })] })] }) }));
}
function uniqueFolders(project) {
    return [...new Set([project?.primary_folder, ...(project?.source_folders ?? [])].filter((path) => Boolean(path)))];
}
function toggleControl(controls, control, checked) {
    return checked
        ? [...new Set([...controls, control])]
        : controls.filter((item) => item !== control);
}
function workerIdFromThread(workThreadId) {
    return workThreadId.split(":worker:").slice(1).join(":worker:");
}
function payloadRecord(payload) {
    return payload && typeof payload === "object" ? payload : {};
}
function stringField(record, key) {
    const value = record[key];
    return typeof value === "string" ? value : "";
}
//# sourceMappingURL=Projects.js.map