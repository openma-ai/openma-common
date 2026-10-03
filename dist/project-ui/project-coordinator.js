export const defaultCoordinatorConfig = (projectId) => ({
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
//# sourceMappingURL=project-coordinator.js.map