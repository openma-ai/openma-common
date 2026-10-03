import type { ProjectClient, ProjectInfo } from "./client.js";
export declare function folderName(path: string): string;
export declare function ProjectFolderList({ folders, onAdd, onMakePrimary, onRemove, }: {
    folders: readonly string[];
    onAdd?: () => void;
    onMakePrimary: (folder: string) => void;
    onRemove: (folder: string) => void;
}): import("react").JSX.Element;
export declare function CreateProjectDialog({ client, open, onOpenChange, onCreated, }: {
    client: ProjectClient;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCreated: (project: ProjectInfo) => void;
}): import("react").JSX.Element;
//# sourceMappingURL=CreateProjectDialog.d.ts.map