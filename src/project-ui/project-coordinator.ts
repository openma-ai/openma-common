import type { ProjectWorkConfig } from "./client.js";

export const defaultCoordinatorConfig = (projectId: string): ProjectWorkConfig => ({
  projectId,
  description: "",
  instructions: "",
  context: "",
  resources: [],
  coordinatorAgent: "",
  workerAgent: "",
  continuity: "per-scope",
  controls: ["delegate", "steer", "cancel", "complete"],
});
