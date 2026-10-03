/**
 * Shared Projects surface.
 *
 * Hosts pass a `ProjectClient`. This module does not import Node, Electron,
 * or a product bridge. Styles ship separately as `@openma/common/project-ui/styles.css`.
 */

export type {
  ProjectAgentEvent,
  ProjectAttachment,
  ProjectClient,
  ProjectContextFact,
  ProjectContinuity,
  ProjectControl,
  ProjectExecution,
  ProjectExternalTask,
  ProjectFacts,
  ProjectGoalInput,
  ProjectInfo,
  ProjectReactionFact,
  ProjectRepository,
  ProjectResource,
  ProjectSaveParams,
  ProjectSessionFact,
  ProjectTurnFact,
  ProjectWorkCommand,
  ProjectWorkConfig,
  ProjectWorkEventFact,
  ProjectWorkspaceBinding,
  ProjectWorktree,
  ProjectWorktreeCreate,
  ProjectWorkView,
  ThreadGoal,
  ThreadGoalStatus,
} from "./client.js";
export { emptyProjectFacts, normalizeProjectFolders } from "./client.js";
export { defaultCoordinatorConfig } from "./project-coordinator.js";
export {
  projectCoordinatorTurns,
  projectGoalPresentation,
  projectOutcomeLabel,
  projectResponseText,
  projectThreads,
} from "./project-goals.js";
export type { ProjectChatTurn, ProjectThread } from "./project-goals.js";
export { PROJECTS_QUERY_KEY, useProjectView, useProjects } from "./projects-query.js";
export type { ProjectViewQueryResult, ProjectsQueryResult } from "./projects-query.js";
export { ProjectsPage, ProjectEditor } from "./Projects.js";
export { ProjectConversation } from "./ProjectConversation.js";
export { ProjectComposer } from "./ProjectComposer.js";
export { ProjectMessageAttachments } from "./ProjectMessageAttachments.js";
export { CreateProjectDialog, ProjectFolderList, folderName } from "./CreateProjectDialog.js";
export { ProjectSettings } from "./ProjectSettings.js";
