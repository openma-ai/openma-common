"use client";

import {
  ArrowLeftIcon,
  CheckIcon,
  CirclePauseIcon,
  CirclePlayIcon,
  FileTextIcon,
  FolderIcon,
  ListTodoIcon,
  PencilIcon,
  PlusIcon,
  SettingsIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type {
  ProjectClient,
  ProjectControl,
  ProjectExecution,
  ProjectInfo,
  ProjectWorkCommand,
  ProjectWorkConfig,
  ProjectWorktree,
  ProjectWorkView,
  ThreadGoal,
} from "./client.js";
import { normalizeProjectFolders } from "./client.js";
import { ProjectButton, ProjectDialog, projectErrorText } from "./controls.js";
import { CreateProjectDialog, ProjectFolderList } from "./CreateProjectDialog.js";
import { ProjectComposer } from "./ProjectComposer.js";
import { ProjectConversation } from "./ProjectConversation.js";
import { ProjectMessageAttachments } from "./ProjectMessageAttachments.js";
import { defaultCoordinatorConfig } from "./project-coordinator.js";
import {
  projectCoordinatorTurns,
  projectGoalPresentation,
  projectOutcomeLabel,
  projectResponseText,
  projectThreads,
} from "./project-goals.js";
import { useProjectView, useProjects } from "./projects-query.js";

const CONTROLS = ["delegate", "steer", "cancel", "complete"] as const;

export function ProjectsPage({
  client,
  projectId: controlledProjectId,
  onProjectIdChange,
  refreshIntervalMs = 1500,
}: {
  client: ProjectClient;
  /** With `onProjectIdChange`, the host owns which project is open. */
  projectId?: string | null;
  onProjectIdChange?: (projectId: string | null) => void;
  /** Refetch interval for an open project. `0` polls only after local actions. */
  refreshIntervalMs?: number;
}) {
  const projects = useProjects(client);
  const controlled = onProjectIdChange !== undefined;
  const [uncontrolledId, setUncontrolledId] = useState<string | null>(null);
  const projectId = controlled ? controlledProjectId ?? null : uncontrolledId;
  const setProjectId = (next: string | null) => {
    if (!controlled) setUncontrolledId(next);
    onProjectIdChange?.(next);
  };
  const workspace = useProjectView(client, projectId, refreshIntervalMs);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const project = workspace.data?.project;
  const visible = projects.data?.filter((item) => item.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="projects-page">
      {projectId && workspace.isPending ? (
        <div className="project-loading" role="status">Opening project…</div>
      ) : null}
      {workspace.error && projectId ? (
        <div role="alert" className="project-error">
          {projectErrorText(workspace.error)}{" "}
          <button type="button" onClick={() => setProjectId(null)}>Back to projects</button>
        </div>
      ) : null}
      {!projectId ? (
        <div className="projects-index">
          <header className="projects-list-header">
            <div>
              <h1>Projects</h1>
              <p>Keep your conversations, knowledge, and work together.</p>
            </div>
            <ProjectButton onClick={() => setCreating(true)}>
              <PlusIcon className="size-4" aria-hidden="true" />
              New project
            </ProjectButton>
          </header>
          <input
            className="projects-search"
            aria-label="Search projects"
            placeholder="Search projects"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {projects.error ? <p role="alert">{projectErrorText(projects.error)}</p> : null}
          {projects.isPending ? <p role="status">Loading projects…</p> : (
            <div className="projects-grid">
              {visible?.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-project-id={item.id}
                  className="project-card"
                  onClick={() => setProjectId(item.id)}
                >
                  <FolderIcon className="size-5" aria-hidden="true" />
                  <h2>{item.name}</h2>
                  <p>{item.primary_folder || "Conversations and project knowledge"}</p>
                  <span>Updated {new Date(item.updated_at).toLocaleDateString()}</span>
                </button>
              ))}
            </div>
          )}
          {!projects.isPending && !projects.data?.length ? (
            <div className="projects-empty">
              <FolderIcon className="size-9" aria-hidden="true" />
              <h2>A place for work that continues</h2>
              <p>Create a project, add what your agents should know, and start a conversation.</p>
              <ProjectButton variant="outline" onClick={() => setCreating(true)}>
                Create your first project
              </ProjectButton>
            </div>
          ) : null}
          {projects.data?.length && visible && !visible.length ? (
            <p className="projects-empty">No projects match “{search}”.</p>
          ) : null}
        </div>
      ) : workspace.data ? (
        <ProjectWorkspace
          key={projectId}
          client={client}
          view={workspace.data}
          refresh={async () => {
            await Promise.all([projects.reload(), workspace.reload()]);
          }}
          edit={() => setEditing(true)}
        />
      ) : null}
      <CreateProjectDialog
        client={client}
        open={creating && !projectId}
        onOpenChange={setCreating}
        onCreated={(created) => {
          void projects.reload();
          setProjectId(created.id);
        }}
      />
      {editing && project ? (
        <ProjectEditor
          client={client}
          project={project}
          config={workspace.data?.config ?? undefined}
          close={() => setEditing(false)}
          saved={async (id) => {
            setEditing(false);
            await projects.reload();
            await workspace.reload();
            setProjectId(id);
          }}
          removed={async () => {
            setEditing(false);
            setProjectId(null);
            await projects.reload();
          }}
        />
      ) : null}
    </div>
  );
}

export function ProjectEditor({
  client,
  project,
  config,
  close,
  saved,
  removed,
}: {
  client: ProjectClient;
  project?: ProjectInfo;
  config?: ProjectWorkConfig;
  close: () => void;
  saved: (id: string) => Promise<void>;
  removed: () => Promise<void>;
}) {
  const creating = !project;
  const [draft, setDraft] = useState<ProjectWorkConfig>(
    () => config ?? defaultCoordinatorConfig(project?.id ?? `proj-${crypto.randomUUID()}`),
  );
  const [name, setName] = useState(project?.name ?? "");
  const [folders, setFolders] = useState<string[]>(() => uniqueFolders(project));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [section, setSection] = useState<"general" | "context" | "agents">("general");
  const cloud = draft.execution?.kind === "cloud";
  const field = <K extends keyof ProjectWorkConfig>(key: K, value: ProjectWorkConfig[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const addFolders = async () => {
    if (!client.pickFolders) return;
    try {
      const selected = await client.pickFolders();
      setFolders((current) => [...new Set([...current, ...selected])]);
    } catch (cause) {
      setError(projectErrorText(cause));
    }
  };

  const save = async () => {
    if (busy || !name.trim()) return;
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
    } catch (cause) {
      setError(projectErrorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const folderPicker = (
    <ProjectFolderList
      folders={folders}
      onAdd={client.pickFolders ? () => void addFolders() : undefined}
      onMakePrimary={(folder) => setFolders((current) => [folder, ...current.filter((path) => path !== folder)])}
      onRemove={(folder) => setFolders((current) => current.filter((path) => path !== folder))}
    />
  );

  return (
    <ProjectDialog
      open
      wide
      title={creating ? "New project" : "Coordinator settings"}
      description={creating
        ? "Start with a goal. You can configure your agents later."
        : "Manage your project’s context and execution."}
      onClose={close}
    >
      <form
        className="project-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {creating ? (
          <div className="space-y-5">
            <Basics name={name} setName={setName} draft={draft} field={field} />
            <details>
              <summary>Add context (optional)</summary>
              <div>
                {folderPicker}
                <label className="project-field">
                  Context
                  <textarea
                    aria-label="Context"
                    rows={3}
                    value={draft.context}
                    onChange={(event) => field("context", event.target.value)}
                  />
                </label>
              </div>
            </details>
          </div>
        ) : (
          <>
            <div className="project-tabs" role="tablist" aria-label="Project settings sections">
              {(["general", "context", "agents"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  role="tab"
                  aria-selected={section === item}
                  onClick={() => setSection(item)}
                >
                  {item === "general" ? "General" : item === "context" ? "Context" : "Agents"}
                </button>
              ))}
            </div>
            {section === "general" ? (
              <div>
                <Basics name={name} setName={setName} draft={draft} field={field} />
                <details>
                  <summary>Advanced</summary>
                  <label className="project-field">
                    Conversation continuity
                    <select
                      aria-label="Conversation continuity"
                      value={draft.continuity}
                      onChange={(event) => field("continuity", event.target.value as ProjectWorkConfig["continuity"])}
                    >
                      <option value="per-scope">Continue across this project</option>
                      <option value="per-run">Separate conversations for each run</option>
                    </select>
                  </label>
                  <fieldset>
                    <legend>Coordinator controls</legend>
                    <div>
                      {CONTROLS.map((control) => (
                        <label key={control} className="project-check">
                          <input
                            type="checkbox"
                            checked={draft.controls.includes(control)}
                            onChange={(event) => field("controls", toggleControl(draft.controls, control, event.target.checked))}
                          />
                          {control}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </details>
              </div>
            ) : null}
            {section === "context" ? (
              <div>
                {cloud ? (
                  <RepositoryFields draft={draft} field={field} />
                ) : (
                  <div>
                    <p>Source folders</p>
                    {folderPicker}
                    <label className="project-field">
                      Base branch or commit
                      <input
                        aria-label="Base branch or commit"
                        value={draft.baseRef ?? ""}
                        onChange={(event) => field("baseRef", event.target.value)}
                      />
                    </label>
                    <p className="project-note">New threads start from committed code. Existing threads keep their workspace.</p>
                  </div>
                )}
                <label className="project-field">
                  Instructions
                  <textarea
                    aria-label="Instructions"
                    rows={3}
                    value={draft.instructions}
                    onChange={(event) => field("instructions", event.target.value)}
                  />
                </label>
                <label className="project-field">
                  Context
                  <textarea
                    aria-label="Context"
                    rows={3}
                    value={draft.context}
                    onChange={(event) => field("context", event.target.value)}
                  />
                </label>
              </div>
            ) : null}
            {section === "agents" ? (
              <div>
                <label className="project-field">
                  Execution location
                  <select
                    aria-label="Execution location"
                    value={cloud ? "cloud" : "local"}
                    disabled={Boolean(config?.coordinatorAgent)}
                    onChange={(event) => {
                      const execution: ProjectExecution = event.target.value === "cloud"
                        ? { kind: "cloud", ...(draft.execution?.kind === "cloud" ? draft.execution : {}) }
                        : { kind: "local" };
                      setDraft((current) => ({ ...current, execution }));
                    }}
                  >
                    <option value="local">This computer</option>
                    <option value="cloud">Cloud</option>
                  </select>
                </label>
                <p className="project-note">
                  {cloud
                    ? "Runs through the host’s Projects worker."
                    : "The host needs to stay available while agents work."}
                </p>
                <label className="project-field">
                  Coordinator agent
                  <input
                    aria-label="Coordinator agent"
                    value={draft.coordinatorAgent}
                    onChange={(event) => field("coordinatorAgent", event.target.value)}
                  />
                </label>
                <label className="project-field">
                  Worker agent
                  <input
                    aria-label="Worker agent"
                    value={draft.workerAgent}
                    onChange={(event) => field("workerAgent", event.target.value)}
                  />
                </label>
                {cloud ? (
                  <>
                    <label className="project-field">
                      Coordinator environment
                      <input
                        aria-label="Coordinator environment"
                        value={draft.coordinatorEnvironment ?? ""}
                        onChange={(event) => field("coordinatorEnvironment", event.target.value)}
                      />
                    </label>
                    <label className="project-field">
                      Worker environment
                      <input
                        aria-label="Worker environment"
                        value={draft.workerEnvironment ?? ""}
                        onChange={(event) => field("workerEnvironment", event.target.value)}
                      />
                    </label>
                  </>
                ) : null}
              </div>
            ) : null}
          </>
        )}
        {error ? <p role="alert" className="project-error">{error}</p> : null}
        <div className="project-actions">
          {!creating && project ? (
            <ProjectButton
              variant="ghost"
              disabled={busy}
              style={{ marginRight: "auto" }}
              onClick={() => {
                setBusy(true);
                setError("");
                void client.delete(project.id).then(removed).catch((cause: unknown) => {
                  setError(projectErrorText(cause));
                }).finally(() => setBusy(false));
              }}
            >
              Delete project
            </ProjectButton>
          ) : null}
          <ProjectButton variant="ghost" disabled={busy} onClick={close}>Cancel</ProjectButton>
          <ProjectButton type="submit" disabled={busy || !name.trim()}>
            {creating ? "Create project" : "Save project"}
          </ProjectButton>
        </div>
      </form>
    </ProjectDialog>
  );
}

function Basics({
  name,
  setName,
  draft,
  field,
}: {
  name: string;
  setName: (name: string) => void;
  draft: ProjectWorkConfig;
  field: <K extends keyof ProjectWorkConfig>(key: K, value: ProjectWorkConfig[K]) => void;
}) {
  return (
    <div>
      <label className="project-field">
        Project name
        <input required value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Improve checkout" />
      </label>
      <label className="project-field">
        Goal <span className="project-note">(optional)</span>
        <textarea
          aria-label="Goal"
          rows={3}
          value={draft.description}
          onChange={(event) => field("description", event.target.value)}
        />
      </label>
    </div>
  );
}

function RepositoryFields({
  draft,
  field,
}: {
  draft: ProjectWorkConfig;
  field: <K extends keyof ProjectWorkConfig>(key: K, value: ProjectWorkConfig[K]) => void;
}) {
  const repositories = draft.repositories ?? [];
  return (
    <div>
      <p>Repositories</p>
      {repositories.map((repo, index) => (
        <div key={index}>
          <input
            aria-label={`Repository ${index + 1}`}
            value={repo.url}
            placeholder="https://github.com/owner/repo"
            onChange={(event) => field("repositories", repositories.map((item, itemIndex) => itemIndex === index ? { ...item, url: event.target.value } : item))}
          />
          <input
            aria-label={`Base reference ${index + 1}`}
            value={repo.baseRef ?? ""}
            placeholder="Default branch"
            onChange={(event) => field("repositories", repositories.map((item, itemIndex) => itemIndex === index ? { ...item, baseRef: event.target.value } : item))}
          />
          <ProjectButton
            variant="ghost"
            onClick={() => field("repositories", repositories.filter((_, itemIndex) => itemIndex !== index))}
          >
            Remove
          </ProjectButton>
        </div>
      ))}
      <ProjectButton
        variant="outline"
        disabled={repositories.length >= 8}
        onClick={() => field("repositories", [...repositories, { url: "" }])}
      >
        <PlusIcon className="size-4" aria-hidden="true" />
        Add repository
      </ProjectButton>
    </div>
  );
}

function ProjectOutcomeBar({
  goal,
  busy,
  onPause,
  onResume,
}: {
  goal: ThreadGoal;
  busy: boolean;
  onPause: () => void;
  onResume: () => void;
}) {
  const presentation = projectGoalPresentation(goal);
  return (
    <section className={`project-outcome project-outcome-${presentation.tone}`} aria-label="Project outcome">
      <div className="project-outcome-copy">
        <span className="project-outcome-label">Outcome</span>
        <strong title={presentation.title}>{presentation.title}</strong>
        <span className="project-outcome-status">
          {projectOutcomeLabel(goal.status)}
          {presentation.budgetLabel ? ` · ${presentation.budgetLabel} tokens` : ""}
        </span>
      </div>
      <div className="project-outcome-actions">
        {presentation.actions.pause ? (
          <ProjectButton variant="outline" disabled={busy} onClick={onPause}>
            <CirclePauseIcon className="size-3.5" aria-hidden="true" />
            Pause
          </ProjectButton>
        ) : null}
        {presentation.actions.resume ? (
          <ProjectButton variant="outline" disabled={busy} onClick={onResume}>
            <CirclePlayIcon className="size-3.5" aria-hidden="true" />
            Resume
          </ProjectButton>
        ) : null}
      </div>
    </section>
  );
}

function ProjectWorkspace({
  client,
  view,
  refresh,
  edit,
}: {
  client: ProjectClient;
  view: ProjectWorkView;
  refresh: () => Promise<void>;
  edit: () => void;
}) {
  const { project, config, facts } = view;
  const [tab, setTab] = useState<"conversation" | "workers" | "activity" | "overview">("conversation");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [action, setAction] = useState<{ type: ProjectWorkCommand["type"]; workerId?: string } | null>(null);
  const [resource, setResource] = useState(false);
  const [selectedWorker, setSelectedWorker] = useState<string | null>(null);
  const [runId, setRunId] = useState(() => {
    const last = facts.events.at(-1)?.payload;
    const saved = payloadRecord(last).runId;
    return typeof saved === "string" ? saved : crypto.randomUUID();
  });
  const uncertainSubmission = useRef<{ fingerprint: string; id: string } | null>(null);
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
    return [turn.id, payload] as const;
  }));
  const runs = [...new Set(facts.events.map((event) => {
    const id = payloadRecord(event.payload).runId;
    return typeof id === "string" ? id : "";
  }).filter(Boolean))];

  const setCoordinatorOutcome = async (status: "active" | "paused") => {
    if (!coordinatorOutcome) return;
    setBusy(true);
    setError("");
    try {
      await client.goal({
        projectId: project.id,
        workThreadId: coordinatorOutcome.workThreadId,
        status,
      });
      await refresh();
    } catch (cause) {
      setError(projectErrorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (
    type: ProjectWorkCommand["type"],
    message: string,
    workerId?: string,
    attachments?: ProjectWorkCommand["attachments"],
  ) => {
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
    } catch (cause) {
      setError(projectErrorText(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const ready = Boolean(config?.coordinatorAgent && config.workerAgent);

  return (
    <>
      <header className="project-topbar">
        <button type="button" className="project-title" title={project.name} onClick={edit}>
          {project.name}
        </button>
        <ProjectButton
          variant={tab !== "conversation" ? "outline" : "ghost"}
          aria-pressed={tab !== "conversation"}
          onClick={() => {
            setSelectedWorker(null);
            setTab(tab === "conversation" ? "workers" : "conversation");
          }}
        >
          <ListTodoIcon className="size-3.5" aria-hidden="true" />
          Tasks
        </ProjectButton>
        <ProjectButton variant="ghost" icon aria-label="Project settings" onClick={edit}>
          <SettingsIcon className="size-4" aria-hidden="true" />
        </ProjectButton>
      </header>
      <div className={`project-columns${tab !== "conversation" ? " project-panel-open" : ""}`}>
        <section className="project-main">
          {runScoped ? (
            <div className="project-runs">
              <select aria-label="Select run" value={runId} onChange={(event) => setRunId(event.target.value)}>
                {[...new Set([...runs, runId])].map((id, index) => (
                  <option key={id} value={id}>Run {index + 1} · {id.slice(0, 8)}</option>
                ))}
              </select>
              <ProjectButton variant="ghost" onClick={() => setRunId(crypto.randomUUID())}>
                <PlusIcon className="size-4" aria-hidden="true" />
                New run
              </ProjectButton>
            </div>
          ) : null}
          {coordinatorOutcome ? (
            <ProjectOutcomeBar
              goal={coordinatorOutcome}
              busy={busy}
              onPause={() => void setCoordinatorOutcome("paused")}
              onResume={() => void setCoordinatorOutcome("active")}
            />
          ) : null}
          {ready && config ? (
            <ProjectConversation
              turns={coordinatorTurns}
              cwd={project.primary_folder || null}
              promptPayloads={promptPayloads}
              composer={
                <ProjectComposer
                  key={`${project.id}:${runId}`}
                  agentId={config.coordinatorAgent}
                  placeholder={`Message ${project.name}…`}
                  busy={busy}
                  onSubmit={(message, attachments) => submit("message", message, undefined, attachments)}
                  onEditAgents={edit}
                />
              }
            />
          ) : (
            <div className="projects-empty">
              <h2>Make this project your own</h2>
              <p>Choose your agents and add instructions to begin.</p>
              <ProjectButton onClick={edit}>Set up coordinator</ProjectButton>
            </div>
          )}
          {error || view.error ? <p role="alert" className="project-error">{error || view.error}</p> : null}
        </section>
        {tab !== "conversation" ? (
          <aside
            className="project-side-panel"
            aria-label={tab === "overview" ? "Project overview" : tab === "workers" ? "Project workers" : "Project activity"}
          >
            <div className="project-side-heading">
              {selectedWorker && tab === "workers" ? (
                <ProjectButton variant="ghost" onClick={() => setSelectedWorker(null)}>
                  <ArrowLeftIcon className="size-4" aria-hidden="true" />
                  Threads
                </ProjectButton>
              ) : (
                <div className="project-tabs" role="tablist" aria-label="Project views">
                  {(["workers", "overview", "activity"] as const).map((item) => (
                    <button
                      key={item}
                      type="button"
                      role="tab"
                      aria-selected={tab === item}
                      onClick={() => {
                        setSelectedWorker(null);
                        setTab(item);
                      }}
                    >
                      {item === "workers" ? "Threads" : item === "overview" ? "Library" : "Activity"}
                    </button>
                  ))}
                </div>
              )}
              <ProjectButton variant="ghost" icon aria-label="Close panel" onClick={() => setTab("conversation")}>
                <XIcon className="size-4" aria-hidden="true" />
              </ProjectButton>
            </div>
            <div className="project-panel-content">
              {selectedWorker && tab === "workers" ? (
                <ProjectWorkerDetail
                  view={view}
                  workerId={selectedWorker}
                  busy={busy}
                  submit={(message, attachments) => submit("steer", message, selectedWorker, attachments)}
                  edit={edit}
                />
              ) : null}
              {tab === "overview" && !selectedWorker ? (
                <ProjectLibrary
                  client={client}
                  view={view}
                  edit={edit}
                  refresh={refresh}
                  onError={setError}
                  onAddResource={() => setResource(true)}
                />
              ) : null}
              {tab === "workers" && !selectedWorker ? (
                <ProjectWorkers
                  view={view}
                  workers={workers}
                  threads={threads}
                  config={config}
                  onOpen={setSelectedWorker}
                  onDelegate={() => setAction({ type: "delegate" })}
                  onSteer={(workerId) => setAction({ type: "steer", workerId })}
                  onCancel={(workerId) => void submit("cancel", "Cancelled by user", workerId)}
                />
              ) : null}
              {tab === "activity" ? (
                <ProjectActivity
                  view={view}
                  canComplete={Boolean(config?.controls.includes("complete"))}
                  onComplete={() => setAction({ type: "complete" })}
                />
              ) : null}
            </div>
          </aside>
        ) : null}
        {action ? (
          <ProjectAction
            error={error}
            action={action}
            close={() => setAction(null)}
            submit={async (message, id) => {
              if (await submit(action.type, message, id)) setAction(null);
            }}
          />
        ) : null}
        {resource && config ? (
          <ResourceEditor
            close={() => setResource(false)}
            save={async (item) => {
              await client.saveWork({ ...config, resources: [...config.resources, item] });
              setResource(false);
              await refresh();
            }}
          />
        ) : null}
      </div>
    </>
  );
}

function ProjectLibrary({
  client,
  view,
  edit,
  refresh,
  onError,
  onAddResource,
}: {
  client: ProjectClient;
  view: ProjectWorkView;
  edit: () => void;
  refresh: () => Promise<void>;
  onError: (message: string) => void;
  onAddResource: () => void;
}) {
  const config = view.config;
  return (
    <div className="project-knowledge" aria-label="Project knowledge">
      <div className="project-knowledge-heading">
        <h2>Project knowledge</h2>
        <ProjectButton variant="ghost" icon aria-label="Edit knowledge" onClick={edit}>
          <PencilIcon className="size-4" aria-hidden="true" />
        </ProjectButton>
      </div>
      <section>
        <h3>Instructions</h3>
        <p>{config?.instructions || "No instructions yet."}</p>
        {!config?.instructions ? <button type="button" onClick={edit}>Add instructions</button> : null}
      </section>
      <section>
        <h3>Context</h3>
        {config?.description ? <p>{config.description}</p> : null}
        <p>{config?.context || "No additional context."}</p>
      </section>
      <section>
        <div className="project-knowledge-heading">
          <h3>Resources</h3>
          {config ? (
            <ProjectButton variant="ghost" icon aria-label="Add resource" onClick={onAddResource}>
              <PlusIcon className="size-4" aria-hidden="true" />
            </ProjectButton>
          ) : null}
        </div>
        {config?.resources.map((resource) => (
          <details className="project-resource" key={resource.id}>
            <summary>
              <FileTextIcon className="size-4" aria-hidden="true" />
              {resource.name}
            </summary>
            <p>{resource.text}</p>
            <ProjectButton
              variant="ghost"
              onClick={() => {
                void client.saveWork({
                  ...config,
                  resources: config.resources.filter((item) => item.id !== resource.id),
                }).then(refresh).catch((cause: unknown) => onError(projectErrorText(cause)));
              }}
            >
              <XIcon className="size-4" aria-hidden="true" />
              Remove
            </ProjectButton>
          </details>
        ))}
        {!config?.resources.length ? <p>No resources yet.</p> : null}
      </section>
      <section className="project-runtime-summary">
        <h3>Agents</h3>
        <dl>
          <dt>Coordinator</dt>
          <dd>{config?.coordinatorAgent || "Not configured"}</dd>
          <dt>Workers</dt>
          <dd>{config?.workerAgent || "Not configured"}</dd>
        </dl>
      </section>
      <Worktrees client={client} projectId={view.project.id} onError={onError} />
    </div>
  );
}

function Worktrees({
  client,
  projectId,
  onError,
}: {
  client: ProjectClient;
  projectId: string;
  onError: (message: string) => void;
}) {
  const [trees, setTrees] = useState<readonly ProjectWorktree[] | null>(null);
  const [name, setName] = useState("");
  useEffect(() => {
    if (!client.listWorktrees) return;
    let active = true;
    void client.listWorktrees(projectId).then(
      (next) => {
        if (active) setTrees(next);
      },
      (cause: unknown) => {
        if (active) onError(projectErrorText(cause));
      },
    );
    return () => {
      active = false;
    };
  }, [client, onError, projectId]);
  if (!client.listWorktrees) return null;
  return (
    <section aria-label="Worktrees">
      <h3>Worktrees</h3>
      {trees?.map((tree) => (
        <article key={tree.id} className="project-worker">
          <div>
            <strong>{tree.name}</strong>
            <p>{tree.branch ?? "Detached"} · {tree.paths.join(", ") || "No checkout path"}</p>
          </div>
          {client.deleteWorktree ? (
            <ProjectButton
              variant="ghost"
              onClick={() => {
                void client.deleteWorktree?.(tree.id).then(async () => {
                  setTrees(await client.listWorktrees?.(projectId) ?? []);
                }).catch((cause: unknown) => onError(projectErrorText(cause)));
              }}
            >
              Remove worktree
            </ProjectButton>
          ) : null}
        </article>
      ))}
      {!trees?.length ? <p>No worktrees yet.</p> : null}
      {client.createWorktree ? (
        <form
          className="project-form"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = name.trim();
            if (!trimmed) return;
            void client.createWorktree?.({ projectId, name: trimmed }).then(async () => {
              setName("");
              setTrees(await client.listWorktrees?.(projectId) ?? []);
            }).catch((cause: unknown) => onError(projectErrorText(cause)));
          }}
        >
          <label className="project-field">
            New worktree
            <input aria-label="New worktree" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <ProjectButton type="submit" variant="outline" disabled={!name.trim()}>Create worktree</ProjectButton>
        </form>
      ) : null}
    </section>
  );
}

function ProjectWorkers({
  view,
  workers,
  threads,
  config,
  onOpen,
  onDelegate,
  onSteer,
  onCancel,
}: {
  view: ProjectWorkView;
  workers: ProjectWorkView["facts"]["sessions"];
  threads: ReturnType<typeof projectThreads>;
  config: ProjectWorkConfig | null;
  onOpen: (workerId: string) => void;
  onDelegate: () => void;
  onSteer: (workerId: string) => void;
  onCancel: (workerId: string) => void;
}) {
  const count = workers.length + (view.external_tasks?.length ?? 0);
  return (
    <div className="project-work-list">
      <div className="project-panel-summary">
        <span>{count ? `${count} threads` : "No tasks yet"}</span>
        {config?.controls.includes("delegate") ? (
          <ProjectButton variant="ghost" icon aria-label="Delegate task" title="Delegate task" onClick={onDelegate}>
            <PlusIcon className="size-3.5" aria-hidden="true" />
          </ProjectButton>
        ) : null}
      </div>
      {!workers.length && !view.external_tasks?.length ? (
        <div className="project-workers-empty">
          <h3>Tasks appear here</h3>
          <p>Delegated work shows up as its own thread.</p>
        </div>
      ) : null}
      {["running", "queued", "failed", "completed", "cancelled", "other"].map((state) => {
        const group = workers.filter((worker) => {
          const status = view.facts.turns.filter((turn) => turn.sessionId === worker.id).at(-1)?.state ?? "other";
          return status === state;
        });
        if (!group.length) return null;
        const labels: Record<string, string> = {
          running: "Working",
          queued: "Queued",
          failed: "Failed",
          completed: "Completed",
          cancelled: "Cancelled",
          other: "No turns yet",
        };
        return (
          <section key={state} className="project-worker-group">
            <h3>{labels[state]} <span>{group.length}</span></h3>
            {group.map((session) => {
              const workerId = workerIdFromThread(session.workThreadId);
              const turns = view.facts.turns.filter((turn) => turn.sessionId === session.id);
              const last = turns.at(-1);
              const workspace = view.workspaces?.find((item) => item.workThreadId === session.workThreadId);
              const outcome = threads.find((thread) => thread.workThreadId === session.workThreadId)?.goal;
              const preview = projectResponseText(view.facts.agentEvents.filter((event) => event.turn_id === last?.id)).slice(0, 160);
              return (
                <article className="project-worker" key={session.id}>
                  <div>
                    <button type="button" className="project-worker-title" onClick={() => onOpen(workerId)}>
                      {workerId}
                    </button>
                    <p className="project-worker-attribution">Built-in coordinator</p>
                    <p className="project-worker-preview">{preview || "Waiting for output…"}</p>
                    {workspace?.location ? (
                      <p>
                        {workspace.location.branch ? `${workspace.location.branch} · ` : ""}
                        {workspace.location.cwd ?? `OpenMA session ${workspace.location.remoteSessionId ?? ""}`}
                      </p>
                    ) : null}
                    <span>{last?.state ?? session.state ?? "open"} · {config?.workerAgent}</span>
                    {outcome ? <span className="project-worker-outcome">Outcome: {projectOutcomeLabel(outcome.status)}</span> : null}
                  </div>
                  <div className="project-worker-actions">
                    {config?.controls.includes("steer") ? (
                      <ProjectButton variant="outline" onClick={() => onSteer(workerId)}>Steer</ProjectButton>
                    ) : null}
                    {config?.controls.includes("cancel") && last && ["queued", "running"].includes(last.state) ? (
                      <ProjectButton variant="ghost" onClick={() => onCancel(workerId)}>Cancel</ProjectButton>
                    ) : null}
                    <ProjectButton variant="ghost" onClick={() => onOpen(workerId)}>View thread</ProjectButton>
                  </div>
                </article>
              );
            })}
          </section>
        );
      })}
      {view.external_tasks?.map((task) => (
        <article className="project-worker" key={task.id} data-external-task="true">
          <p className="project-worker-title">{task.text}</p>
          {task.status === "cancelled" ? <span>Cancelled</span> : null}
          {task.coordinator_name ? <span>{task.coordinator_name}</span> : null}
        </article>
      ))}
    </div>
  );
}

function ProjectActivity({
  view,
  canComplete,
  onComplete,
}: {
  view: ProjectWorkView;
  canComplete: boolean;
  onComplete: () => void;
}) {
  return (
    <div className="project-work-list">
      <div className="project-section-heading">
        <h2>Activity history</h2>
        {canComplete ? (
          <ProjectButton variant="outline" onClick={onComplete}>
            <CheckIcon className="size-4" aria-hidden="true" />
            Complete project
          </ProjectButton>
        ) : null}
      </div>
      {!view.facts.events.length ? (
        <p className="project-help">Activity appears when you send a message or delegate work.</p>
      ) : null}
      {[...view.facts.events].reverse().map((event) => {
        const reaction = view.facts.reactions.find((item) => item.eventId === event.id);
        return (
          <details key={event.id} className="project-activity">
            <summary>
              <span>{event.type.replace("backchat.project.", "").replace("project.", "").replaceAll(".", " ")}</span>
              <span>{reaction?.status ?? "Processing"}</span>
              <time>{new Date(event.occurredAt).toLocaleTimeString()}</time>
            </summary>
            <pre>{JSON.stringify(event.payload, null, 2)}</pre>
            {reaction?.reason ? <p>{reaction.reason}</p> : null}
          </details>
        );
      })}
    </div>
  );
}

function ProjectWorkerDetail({
  view,
  workerId,
  busy,
  submit,
  edit,
}: {
  view: ProjectWorkView;
  workerId: string;
  busy: boolean;
  submit: (text: string, attachments: ProjectWorkCommand["attachments"]) => Promise<boolean>;
  edit: () => void;
}) {
  const sessions = view.facts.sessions.filter((session) =>
    session.agentId === "worker" && session.workThreadId.endsWith(`:worker:${workerId}`),
  );
  const turns = view.facts.turns.filter((turn) => sessions.some((session) => session.id === turn.sessionId));
  return (
    <div className="project-thread-detail">
      <div className="project-thread-transcript">
        <h2>{workerId}</h2>
        {turns.map((turn) => {
          const trigger = view.facts.events.find((event) => event.id === turn.triggerEventId);
          const payload = payloadRecord(trigger?.payload);
          const prompt = stringField(payload, "text") || stringField(payload, "task") || stringField(payload, "instruction");
          const text = projectResponseText(view.facts.agentEvents.filter((event) => event.turn_id === turn.id));
          return (
            <article className="project-turn" key={turn.id}>
              {prompt ? <div className="project-user-message">{prompt}</div> : null}
              <ProjectMessageAttachments payload={trigger?.payload} />
              <p className="project-answer">{text || (turn.state === "running" ? "Working…" : "No output yet.")}</p>
              <p className="project-turn-state">{turn.state}</p>
            </article>
          );
        })}
      </div>
      {view.config?.controls.includes("steer") ? (
        <ProjectComposer
          agentId={view.config.workerAgent}
          role="Worker"
          label="Message worker"
          placeholder="Follow up with this worker…"
          busy={busy}
          onSubmit={(message, attachments) => submit(message, attachments)}
          onEditAgents={edit}
        />
      ) : null}
    </div>
  );
}

function ProjectAction({
  action,
  close,
  submit,
  error,
}: {
  error: string;
  action: { type: ProjectWorkCommand["type"]; workerId?: string };
  close: () => void;
  submit: (text: string, id?: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [workerId, setWorkerId] = useState(action.workerId ?? "");
  const [busy, setBusy] = useState(false);
  const label = action.type === "delegate" ? "Delegate" : action.type === "steer" ? "Steer" : "Complete";
  return (
    <ProjectDialog
      open
      title={`${label}${action.type === "complete" ? " project" : " task"}`}
      description={action.type === "steer"
        ? "Queue a follow-up instruction for this worker."
        : action.type === "complete"
          ? "Record a reviewed summary of this project’s work."
          : "Give this independent task a stable name and a clear brief."}
      onClose={close}
    >
      <form
        className="project-form"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          void submit(text, workerId).finally(() => setBusy(false));
        }}
      >
        {action.type !== "complete" ? (
          <label className="project-field">
            Worker ID
            <input required value={workerId} readOnly={Boolean(action.workerId)} onChange={(event) => setWorkerId(event.target.value)} />
          </label>
        ) : null}
        <label className="project-field">
          {action.type === "complete" ? "Summary" : action.type === "steer" ? "Instruction" : "Task"}
          <textarea required rows={5} value={text} onChange={(event) => setText(event.target.value)} />
        </label>
        {error ? <p role="alert" className="project-error">{error}</p> : null}
        <div className="project-actions">
          <ProjectButton variant="ghost" onClick={close}>Cancel</ProjectButton>
          <ProjectButton type="submit" disabled={busy}>{label}</ProjectButton>
        </div>
      </form>
    </ProjectDialog>
  );
}

function ResourceEditor({
  close,
  save,
}: {
  close: () => void;
  save: (resource: ProjectWorkConfig["resources"][number]) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <ProjectDialog
      open
      title="Add project resource"
      description="Add a note or a text file. It is included in project context."
      onClose={close}
    >
      <form
        className="project-form"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          void save({ id: crypto.randomUUID(), name, text })
            .catch((cause: unknown) => setError(projectErrorText(cause)))
            .finally(() => setBusy(false));
        }}
      >
        <label className="project-field">
          Text file
          <input
            type="file"
            accept=".txt,.md,.csv,.json,text/plain"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              if (file.size > 200_000) {
                setError("Choose a text file under 200 KB.");
                return;
              }
              setName(file.name);
              void file.text().then(setText);
            }}
          />
        </label>
        <label className="project-field">
          Resource name
          <input required value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="project-field">
          Content
          <textarea required rows={7} value={text} onChange={(event) => setText(event.target.value)} />
        </label>
        {error ? <p role="alert" className="project-error">{error}</p> : null}
        <div className="project-actions">
          <ProjectButton variant="ghost" onClick={close}>Cancel</ProjectButton>
          <ProjectButton type="submit" disabled={busy}>Add resource</ProjectButton>
        </div>
      </form>
    </ProjectDialog>
  );
}

function uniqueFolders(project: ProjectInfo | undefined): string[] {
  return [...new Set(
    [project?.primary_folder, ...(project?.source_folders ?? [])].filter((path): path is string => Boolean(path)),
  )];
}

function toggleControl(controls: readonly ProjectControl[], control: ProjectControl, checked: boolean): ProjectControl[] {
  return checked
    ? [...new Set([...controls, control])]
    : controls.filter((item) => item !== control);
}

function workerIdFromThread(workThreadId: string): string {
  return workThreadId.split(":worker:").slice(1).join(":worker:");
}

function payloadRecord(payload: unknown): { [key: string]: unknown } {
  return payload && typeof payload === "object" ? payload as { [key: string]: unknown } : {};
}

function stringField(record: { [key: string]: unknown }, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}
