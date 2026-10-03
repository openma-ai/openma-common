"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export function projectErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function ProjectButton({
  variant = "primary",
  icon = false,
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "outline";
  icon?: boolean;
}) {
  return (
    <button
      {...props}
      type={type}
      className={`project-button project-button-${variant}${icon ? " project-button-icon" : ""} ${className}`.trim()}
    />
  );
}

export function ProjectDialog({
  open,
  title,
  description,
  onClose,
  children,
  wide = false,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div
      className="project-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={wide ? "project-dialog project-dialog-wide" : "project-dialog"}
      >
        <header className="project-dialog-header">
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </header>
        {children}
      </div>
    </div>
  );
}
