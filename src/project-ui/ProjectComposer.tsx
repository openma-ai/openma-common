"use client";

import { CornerDownLeftIcon, LoaderCircleIcon, PlusIcon } from "lucide-react";
import { useRef, useState } from "react";

import type { ProjectAttachment } from "./client.js";
import { ProjectButton } from "./controls.js";

/** Presentational composer. Delivery stays with the host's `ProjectClient.submit`. */
export function ProjectComposer({
  agentId,
  agentLabel,
  placeholder,
  busy,
  onSubmit,
  onEditAgents,
  role = "Coordinator",
  label = "Message coordinator",
}: {
  agentId: string;
  agentLabel?: string;
  role?: string;
  label?: string;
  placeholder: string;
  busy: boolean;
  onSubmit: (text: string, attachments: ProjectAttachment[]) => Promise<boolean>;
  onEditAgents: () => void;
}) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ProjectAttachment[]>([]);
  const [error, setError] = useState("");
  const sending = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const send = async () => {
    if ((!text.trim() && attachments.length === 0) || busy || sending.current) return;
    sending.current = true;
    const submitted = text;
    const files = attachments;
    try {
      if (await onSubmit(submitted.trim(), files)) {
        setText((current) => (current === submitted ? "" : current));
        setAttachments([]);
        setError("");
      }
    } finally {
      sending.current = false;
      input.current?.focus();
    }
  };

  const addFiles = async (list: FileList | null) => {
    if (!list?.length || busy) return;
    setError("");
    const next: ProjectAttachment[] = [];
    for (const file of list) {
      if (file.size > 1_500_000) {
        setError("Choose a file under 1.5 MB.");
        continue;
      }
      next.push(await readAttachment(file));
    }
    if (next.length) setAttachments((current) => [...current, ...next]);
  };

  return (
    <div className="project-composer">
      {error ? <p role="alert" className="project-error">{error}</p> : null}
      <div className="project-composer-surface">
        {attachments.length ? (
          <ul className="project-attachment-row" aria-label="Pending attachments">
            {attachments.map((file) => (
              <li key={file.id}>
                <button
                  type="button"
                  className="project-attachment"
                  onClick={() => setAttachments((current) => current.filter((item) => item.id !== file.id))}
                >
                  Remove {file.name}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <textarea
          ref={input}
          aria-label={label}
          placeholder={placeholder}
          value={text}
          disabled={busy}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <div className="project-composer-bar">
          <ProjectButton
            variant="ghost"
            icon
            aria-label="Attach files"
            title="Attach files"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            <PlusIcon className="size-4" aria-hidden="true" />
          </ProjectButton>
          <input
            ref={fileInput}
            className="project-sr"
            type="file"
            multiple
            aria-label="Choose attachments"
            onChange={(event) => {
              void addFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={onEditAgents}
            aria-label="Edit project settings"
            className="project-button project-button-ghost"
            style={{ marginRight: "auto" }}
          >
            <span>{agentLabel ?? agentId}</span>
            <span aria-hidden="true">· {role}</span>
          </button>
          <ProjectButton
            icon
            aria-label="Send message"
            title="Send message"
            data-composer-submit="true"
            disabled={busy || (!text.trim() && attachments.length === 0)}
            onClick={() => void send()}
          >
            {busy ? (
              <LoaderCircleIcon className="size-4" aria-hidden="true" />
            ) : (
              <CornerDownLeftIcon className="size-4" aria-hidden="true" />
            )}
          </ProjectButton>
        </div>
      </div>
    </div>
  );
}

async function readAttachment(file: File): Promise<ProjectAttachment> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return {
    id: crypto.randomUUID(),
    name: file.name,
    kind: file.type.startsWith("image/") ? "image" : "file",
    mimeType: file.type || "application/octet-stream",
    data: btoa(binary),
  };
}
