"use client";

import { FolderIcon, FolderPlusIcon, StarIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";

import type { ProjectClient, ProjectInfo } from "./client.js";
import { normalizeProjectFolders } from "./client.js";
import { ProjectButton, ProjectDialog, projectErrorText } from "./controls.js";
import { defaultCoordinatorConfig } from "./project-coordinator.js";

export function folderName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) ?? path;
}

export function ProjectFolderList({
  folders,
  onAdd,
  onMakePrimary,
  onRemove,
}: {
  folders: readonly string[];
  onAdd?: () => void;
  onMakePrimary: (folder: string) => void;
  onRemove: (folder: string) => void;
}) {
  if (folders.length === 0) {
    if (!onAdd) {
      return <p className="project-note">This host does not pick local folders.</p>;
    }
    return (
      <button type="button" onClick={onAdd} className="projects-empty">
        <FolderPlusIcon className="size-6" aria-hidden="true" />
        <span>Add folders OpenMA can read and edit</span>
      </button>
    );
  }

  return (
    <div>
      <ul>
        {folders.map((folder, index) => (
          <li key={folder} className="project-worker">
            <span>
              <FolderIcon className="size-3.5" aria-hidden="true" />
              <span>{folderName(folder)}</span>
              <span title={folder}>{folder}</span>
            </span>
            {index === 0 ? (
              <span>
                <StarIcon className="size-3" aria-hidden="true" />
                Primary
              </span>
            ) : (
              <button type="button" onClick={() => onMakePrimary(folder)}>
                Make primary
              </button>
            )}
            <button
              type="button"
              onClick={() => onRemove(folder)}
              aria-label={`Remove folder: ${folderName(folder)}`}
              title="Remove folder"
            >
              <XIcon className="size-3.5" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {onAdd ? (
        <button type="button" onClick={onAdd}>
          <FolderPlusIcon className="size-3.5" aria-hidden="true" />
          Add more folders
        </button>
      ) : null}
    </div>
  );
}

export function CreateProjectDialog({
  client,
  open,
  onOpenChange,
  onCreated,
}: {
  client: ProjectClient;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (project: ProjectInfo) => void;
}) {
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [projectId, setProjectId] = useState(() => `proj-${crypto.randomUUID()}`);
  const [folders, setFolders] = useState<string[]>([]);
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
    if (!client.pickFolders) return;
    try {
      const picked = await client.pickFolders({ defaultPath: folders[0] });
      if (picked.length === 0) return;
      setFolders((current) => [...new Set([...current, ...picked])]);
    } catch (cause) {
      setError(projectErrorText(cause));
    }
  };

  const create = async () => {
    const trimmedName = name.trim();
    if (!trimmedName || saving) return;
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
    } catch (cause) {
      setError(projectErrorText(cause));
      setSaving(false);
    }
  };

  return (
    <ProjectDialog
      open={open}
      title="Create project"
      description="Name the project, and optionally add a goal and source folders."
      onClose={() => onOpenChange(false)}
    >
      <form
        className="project-form"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <label className="project-field">
          Project name
          <input
            autoFocus
            aria-label="Project name"
            value={name}
            placeholder="Project name"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="project-field">
          Goal
          <textarea
            aria-label="Goal"
            value={goal}
            rows={2}
            onChange={(event) => setGoal(event.target.value)}
          />
        </label>
        <div className="project-field">
          <span>Source folders</span>
          <ProjectFolderList
            folders={folders}
            onAdd={client.pickFolders ? () => void addFolders() : undefined}
            onMakePrimary={(folder) =>
              setFolders((current) => [folder, ...current.filter((candidate) => candidate !== folder)])
            }
            onRemove={(folder) =>
              setFolders((current) => current.filter((candidate) => candidate !== folder))
            }
          />
        </div>
        {error ? <p role="alert" className="project-error">{error}</p> : null}
        <div className="project-actions">
          <ProjectButton variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </ProjectButton>
          <ProjectButton type="submit" disabled={!name.trim() || saving}>
            {saving ? "Creating…" : "Create project"}
          </ProjectButton>
        </div>
      </form>
    </ProjectDialog>
  );
}
