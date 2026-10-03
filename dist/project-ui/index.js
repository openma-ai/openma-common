/**
 * Shared Projects surface.
 *
 * Hosts pass a `ProjectClient`. This module does not import Node, Electron,
 * or a product bridge. Styles ship separately as `@openma/common/project-ui/styles.css`.
 */
export { emptyProjectFacts, normalizeProjectFolders } from "./client.js";
export { defaultCoordinatorConfig } from "./project-coordinator.js";
export { projectCoordinatorTurns, projectGoalPresentation, projectOutcomeLabel, projectResponseText, projectThreads, } from "./project-goals.js";
export { PROJECTS_QUERY_KEY, useProjectView, useProjects } from "./projects-query.js";
export { ProjectsPage, ProjectEditor } from "./Projects.js";
export { ProjectConversation } from "./ProjectConversation.js";
export { ProjectComposer } from "./ProjectComposer.js";
export { ProjectMessageAttachments } from "./ProjectMessageAttachments.js";
export { CreateProjectDialog, ProjectFolderList, folderName } from "./CreateProjectDialog.js";
export { ProjectSettings } from "./ProjectSettings.js";
//# sourceMappingURL=index.js.map