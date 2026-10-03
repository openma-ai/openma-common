import { describe, expect, it } from "vitest";

import {
  emptyProjectFacts,
  normalizeProjectFolders,
  type ProjectWorkView,
  type ThreadGoal,
} from "../src/project-ui/client.js";
import {
  projectCoordinatorTurns,
  projectGoalPresentation,
  projectOutcomeLabel,
  projectThreads,
} from "../src/project-ui/project-goals.js";

const goal = {
  id: "goal-1",
  scopeId: "p",
  workThreadId: "opaque-worker-thread",
  objective: "Ship a reviewed fix",
  status: "active",
  tokenBudget: 200000,
  tokensUsed: 12000,
  timeUsedSeconds: 30,
  revision: 1,
  createdAt: "2026-09-22T00:00:00Z",
  updatedAt: "2026-09-22T00:00:30Z",
} satisfies ThreadGoal;

function view(facts: Partial<ProjectWorkView["facts"]>, projectId = "p"): ProjectWorkView {
  return {
    project: {
      id: projectId,
      name: "Project",
      source_folders: [],
      primary_folder: "",
      created_at: 0,
      updated_at: 0,
    },
    config: null,
    facts: { ...emptyProjectFacts(), ...facts },
    pending: 0,
    error: null,
  };
}

describe("project thread goals", () => {
  it("projects only coordinator turns with the original prompt and full agent activity", () => {
    const at = "2026-09-22T00:00:00Z";
    const event = (id: string, type: string, sessionId: string, turnId: string, data: unknown) => ({
      event_id: id,
      type,
      session_id: sessionId,
      turn_id: turnId,
      occurred_at: at,
      data,
    });
    const projected = projectCoordinatorTurns(view({
      sessions: [
        { id: "coordinator-session", scopeId: "p", workThreadId: "p:coordinator", agentId: "coordinator" },
        { id: "worker-session", scopeId: "p", workThreadId: "p:worker", agentId: "worker" },
      ],
      turns: [
        { id: "coordinator-turn", sessionId: "coordinator-session", triggerEventId: "user-event", state: "completed", createdAt: at },
        { id: "worker-turn", sessionId: "worker-session", triggerEventId: "worker-event", state: "completed", createdAt: at },
      ],
      events: [
        { id: "user-event", type: "project.message", occurredAt: at, payload: { text: "Ship the fix" } },
        { id: "worker-event", type: "project.message", occurredAt: at, payload: { text: "Worker instruction" } },
      ],
      agentEvents: [
        event("start", "turn.started", "coordinator-session", "coordinator-turn", {}),
        event("tool-start", "tool.started", "coordinator-session", "coordinator-turn", { tool_call_id: "tool-1", title: "Read files" }),
        event("tool-done", "tool.completed", "coordinator-session", "coordinator-turn", { tool_call_id: "tool-1", title: "Read files" }),
        event("message", "agent.message", "coordinator-session", "coordinator-turn", { text: "Done", message_id: "message-1" }),
        event("done", "turn.completed", "coordinator-session", "coordinator-turn", {}),
        event("worker-message", "agent.message", "worker-session", "worker-turn", { text: "Private worker output" }),
      ],
    }));
    expect(projected).toHaveLength(1);
    expect(projected[0]).toMatchObject({ status: "complete", promptText: "Ship the fix", assistantText: "Done" });
    expect(projected[0]?.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "tool.started", data: expect.objectContaining({ title: "Read files" }) }),
    ]));
    expect(JSON.stringify(projected)).not.toContain("Private worker output");
  });

  it("keeps one worker and its active goal across replacement sessions and completed turns", () => {
    const projected = projectThreads(view({
      sessions: [
        { id: "new", scopeId: "p", workThreadId: "opaque-worker-thread", agentId: "worker", generation: 2, lastUsedAt: "2026-09-22T00:01:00Z" },
        { id: "old", scopeId: "p", workThreadId: "opaque-worker-thread", agentId: "worker", generation: 1, lastUsedAt: "2026-09-22T00:02:00Z" },
      ],
      contexts: [{
        scopeId: "p",
        workThreadId: "opaque-worker-thread",
        createdAt: "2026-09-22T00:00:00Z",
        items: [{ kind: "coordinator-association", value: { scopeId: "p", role: "worker", workerId: "fix/api", runId: "run-a" } }],
      }],
      turns: [
        { id: "old-turn", sessionId: "old", state: "completed", createdAt: "2026-09-22T00:00:00Z" },
        { id: "new-turn", sessionId: "new", state: "completed", createdAt: "2026-09-22T00:01:00Z" },
      ],
      goals: [goal],
    }), "run-a");
    expect(projected).toHaveLength(1);
    expect(projected[0]).toMatchObject({
      workThreadId: "opaque-worker-thread",
      workerId: "fix/api",
      session: { id: "new" },
      goal: { status: "active" },
    });
    expect(projected[0]?.turns.map((turn) => turn.id)).toEqual(["old-turn", "new-turn"]);
    expect(projectThreads(view({
      sessions: [
        { id: "new", scopeId: "p", workThreadId: "opaque-worker-thread", agentId: "worker", generation: 2, lastUsedAt: "2026-09-22T00:01:00Z" },
      ],
      contexts: [{
        workThreadId: "opaque-worker-thread",
        createdAt: "2026-09-22T00:00:00Z",
        items: [{ kind: "coordinator-association", value: { role: "worker", runId: "run-a" } }],
      }],
      goals: [goal],
    }), "run-b")).toEqual([]);
  });

  it.each([
    ["active", true, false, "neutral"],
    ["paused", false, true, "neutral"],
    ["blocked", false, true, "danger"],
    ["usage_limited", false, true, "danger"],
    ["budget_limited", false, false, "danger"],
    ["complete", false, false, "success"],
  ] as const)("keeps %s goal controls independent from native harness capabilities", (status, pause, resume, tone) => {
    const presentation = projectGoalPresentation({ ...goal, status });
    expect(presentation).toMatchObject({
      title: "Ship a reviewed fix",
      status,
      tone,
      elapsedSeconds: 30,
      budgetLabel: "12k/200k",
      actions: { pause, resume, dismiss: false },
    });
    expect(presentation.elapsedSince).toBeUndefined();
  });

  it("uses project outcome language", () => {
    expect(projectOutcomeLabel("active")).toBe("In progress");
    expect(projectOutcomeLabel("blocked")).toBe("Blocked");
    expect(projectOutcomeLabel("complete")).toBe("Complete");
  });
});

describe("project folders", () => {
  it("keeps the requested primary folder first and drops blanks", () => {
    expect(normalizeProjectFolders({
      source_folders: [" /work/docs ", "/work/app", "/work/docs"],
      primary_folder: "/work/app",
    })).toEqual({
      primary_folder: "/work/app",
      source_folders: ["/work/app", "/work/docs"],
    });
  });
});
