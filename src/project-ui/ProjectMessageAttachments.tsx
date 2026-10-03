"use client";

import { FileTextIcon } from "lucide-react";

import type { ProjectAttachment } from "./client.js";

export function ProjectMessageAttachments({ payload }: { payload: unknown }) {
  const files = attachmentsFrom(payload);
  if (!files.length) return null;
  return (
    <div className="project-attachment-row" aria-label="Message attachments">
      {files.map((file) => (
        <a
          key={file.id}
          download={file.name}
          href={`data:${file.mimeType};base64,${file.data}`}
          className="project-attachment"
          title={`Download ${file.name}`}
        >
          {file.kind === "image" ? (
            <img
              src={`data:${file.mimeType};base64,${file.data}`}
              alt={file.name}
              className="max-h-40 max-w-full rounded"
            />
          ) : (
            <span className="flex items-center gap-2">
              <FileTextIcon className="size-4" aria-hidden="true" />
              {file.name}
            </span>
          )}
        </a>
      ))}
    </div>
  );
}

function attachmentsFrom(payload: unknown): ProjectAttachment[] {
  if (!payload || typeof payload !== "object" || !("attachments" in payload)) return [];
  const attachments = payload.attachments;
  if (!Array.isArray(attachments)) return [];
  return attachments.filter(isAttachment);
}

function isAttachment(value: unknown): value is ProjectAttachment {
  if (!value || typeof value !== "object") return false;
  const file = value as Partial<ProjectAttachment>;
  return typeof file.id === "string"
    && typeof file.name === "string"
    && (file.kind === "image" || file.kind === "file")
    && typeof file.mimeType === "string"
    && typeof file.data === "string";
}
