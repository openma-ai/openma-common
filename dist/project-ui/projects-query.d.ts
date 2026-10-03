import type { ProjectClient, ProjectInfo, ProjectWorkView } from "./client.js";
export declare const PROJECTS_QUERY_KEY: readonly ["projects"];
export interface ProjectsQueryResult {
    data: readonly ProjectInfo[] | undefined;
    error: unknown;
    isPending: boolean;
    reload: () => Promise<void>;
}
export interface ProjectViewQueryResult {
    data: ProjectWorkView | undefined;
    error: unknown;
    isPending: boolean;
    reload: () => Promise<void>;
}
/** Loads `client.list()` and refreshes when the host calls `subscribe`. */
export declare function useProjects(client: ProjectClient): ProjectsQueryResult;
/** Loads one project view. `refreshIntervalMs` of `0` disables polling. */
export declare function useProjectView(client: ProjectClient, projectId: string | null, refreshIntervalMs?: number): ProjectViewQueryResult;
//# sourceMappingURL=projects-query.d.ts.map