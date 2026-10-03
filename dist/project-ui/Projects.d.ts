import type { ProjectClient, ProjectInfo, ProjectWorkConfig } from "./client.js";
export declare function ProjectsPage({ client, projectId: controlledProjectId, onProjectIdChange, refreshIntervalMs, }: {
    client: ProjectClient;
    /** With `onProjectIdChange`, the host owns which project is open. */
    projectId?: string | null;
    onProjectIdChange?: (projectId: string | null) => void;
    /** Refetch interval for an open project. `0` polls only after local actions. */
    refreshIntervalMs?: number;
}): import("react").JSX.Element;
export declare function ProjectEditor({ client, project, config, close, saved, removed, }: {
    client: ProjectClient;
    project?: ProjectInfo;
    config?: ProjectWorkConfig;
    close: () => void;
    saved: (id: string) => Promise<void>;
    removed: () => Promise<void>;
}): import("react").JSX.Element;
//# sourceMappingURL=Projects.d.ts.map