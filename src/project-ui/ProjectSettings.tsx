"use client";

import { ArrowLeftIcon } from "lucide-react";
import { useState } from "react";

import type { ProjectClient, ProjectInfo, ProjectWorkView } from "./client.js";
import { normalizeProjectFolders } from "./client.js";
import { ProjectButton, projectErrorText } from "./controls.js";
import { ProjectFolderList } from "./CreateProjectDialog.js";
import { ProjectEditor } from "./Projects.js";
import { useProjectView } from "./projects-query.js";

export function ProjectSettings({
  client,
  projectId,
  onBack,
  onDeleted,
}: {
  client: ProjectClient;
  projectId: string;
  onBack?: () => void;
  onDeleted?: () => void;
}) {
  const query = useProjectView(client, projectId, 0);
  const [notice, setNotice] = useState("");
  if (query.isPending) return <p role="status" className="project-settings">Loading…</p>;
  if (query.error || !query.data) {
    return <p role="alert" className="project-settings">{projectErrorText(query.error ?? "Project not found")}</p>;
  }
  return (
    <div className="project-settings">
      {notice ? <p role="status">{notice}</p> : null}
      <ProjectSettingsForm
        key={`${projectId}:${query.data.project.updated_at}`}
        client={client}
        project={query.data.project}
        view={query.data}
        onBack={onBack}
        onDeleted={onDeleted}
        refresh={query.reload}
        onSaved={() => setNotice("Project settings saved.")}
      />
    </div>
  );
}

function ProjectSettingsForm({
  client,
  project,
  view,
  onBack,
  onDeleted,
  refresh,
  onSaved,
}: {
  client: ProjectClient;
  project: ProjectInfo;
  view: ProjectWorkView;
  onBack?: () => void;
  onDeleted?: () => void;
  refresh: () => Promise<void>;
  onSaved: () => void;
}) {
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
    } catch (cause) {
      setError(projectErrorText(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header>
        <h1>Project settings</h1>
        {onBack ? (
          <button type="button" onClick={onBack}>
            <ArrowLeftIcon className="size-3.5" aria-hidden="true" />
            <span>{project.name}</span>
          </button>
        ) : null}
      </header>
      <form
        id="project-settings-form"
        className="project-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <section>
          <h2>General</h2>
          <label className="project-field">
            Name
            <input aria-label="Project name" required value={name} onChange={(event) => setName(event.target.value)} />
          </label>
        </section>
        <section>
          <h2>Folders</h2>
          <ProjectFolderList
            folders={folders}
            onAdd={client.pickFolders ? () => {
              void client.pickFolders?.().then((paths) => {
                setFolders((current) => [...new Set([...current, ...paths])]);
              }).catch((cause: unknown) => setError(projectErrorText(cause)));
            } : undefined}
            onMakePrimary={(folder) => setFolders((current) => [folder, ...current.filter((path) => path !== folder)])}
            onRemove={(folder) => setFolders((current) => current.filter((path) => path !== folder))}
          />
        </section>
        {error ? <p role="alert" className="project-error">{error}</p> : null}
        <div className="project-actions">
          <ProjectButton type="submit" disabled={busy || !name.trim()}>Save</ProjectButton>
        </div>
      </form>
      <section>
        <h2>Execution</h2>
        <p className="project-note">Choose the coordinator, worker, and where the project runs.</p>
        <ProjectButton variant="outline" onClick={() => setCoordinator(true)}>Configure</ProjectButton>
      </section>
      {coordinator ? (
        <ProjectEditor
          client={client}
          project={project}
          config={view.config ?? undefined}
          close={() => setCoordinator(false)}
          saved={async () => {
            setCoordinator(false);
            await refresh();
          }}
          removed={async () => {
            setCoordinator(false);
            onDeleted?.();
          }}
        />
      ) : null}
    </>
  );
}
