// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  emptyProjectFacts,
  type ProjectClient,
  type ProjectFacts,
  type ProjectGoalInput,
  type ProjectInfo,
  type ProjectSaveParams,
  type ProjectWorkCommand,
  type ProjectWorkConfig,
  type ProjectWorkView,
  type ThreadGoal,
} from "../src/project-ui/client.js";
import { defaultCoordinatorConfig } from "../src/project-ui/project-coordinator.js";
import { ProjectSettings, ProjectsPage } from "../src/project-ui/index.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function project(id: string, name: string, updatedAt = 1_700_000_000_000): ProjectInfo {
  return {
    id,
    name,
    source_folders: ["/work/app"],
    primary_folder: "/work/app",
    created_at: updatedAt,
    updated_at: updatedAt,
  };
}

function configuredView(
  info: ProjectInfo,
  facts: Partial<ProjectFacts> = {},
  config: Partial<ProjectWorkConfig> = {},
): ProjectWorkView {
  return {
    project: info,
    config: {
      ...defaultCoordinatorConfig(info.id),
      coordinatorAgent: "pi",
      workerAgent: "pi",
      ...config,
    },
    facts: { ...emptyProjectFacts(), ...facts },
    pending: 0,
    error: null,
  };
}

function createFakeClient(views: ProjectWorkView[] = []) {
  const projects = views.map((view) => ({ ...view.project, source_folders: [...view.project.source_folders] }));
  const stored = new Map(views.map((view) => [view.project.id, view]));
  const calls = {
    save: [] as ProjectSaveParams[],
    saveWork: [] as ProjectWorkConfig[],
    submit: [] as ProjectWorkCommand[],
    goal: [] as ProjectGoalInput[],
    delete: [] as string[],
  };
  const client: ProjectClient = {
    async list() {
      return projects.map((item) => ({ ...item, source_folders: [...item.source_folders] }));
    },
    async view(projectId) {
      const current = stored.get(projectId);
      if (!current) throw new Error(`Unknown project ${projectId}`);
      return structuredClone(current);
    },
    async save(input) {
      calls.save.push(structuredClone(input));
      const now = 1_800_000_000_000;
      const next = project(input.project_id, input.name, now);
      next.source_folders = [...input.source_folders];
      next.primary_folder = input.primary_folder ?? input.source_folders[0] ?? "";
      const existing = projects.findIndex((item) => item.id === next.id);
      if (existing >= 0) projects[existing] = next;
      else projects.push(next);
      const current = stored.get(next.id);
      if (current) current.project = { ...next, source_folders: [...next.source_folders] };
      else {
        stored.set(next.id, {
          project: { ...next, source_folders: [...next.source_folders] },
          config: null,
          facts: emptyProjectFacts(),
          pending: 0,
          error: null,
        });
      }
      return { ...next, source_folders: [...next.source_folders] };
    },
    async saveWork(config) {
      calls.saveWork.push(structuredClone(config));
      const current = stored.get(config.projectId);
      if (!current) throw new Error(`Unknown project ${config.projectId}`);
      current.config = structuredClone(config);
      return structuredClone(config);
    },
    async submit(command) {
      calls.submit.push(structuredClone(command));
      const current = stored.get(command.projectId);
      if (!current) throw new Error(`Unknown project ${command.projectId}`);
      const sessionId = "coordinator-session";
      const turnId = `turn-${calls.submit.length}`;
      const eventId = `event-${calls.submit.length}`;
      current.facts = {
        ...current.facts,
        sessions: current.facts.sessions.some((session) => session.id === sessionId)
          ? current.facts.sessions
          : [...current.facts.sessions, {
              id: sessionId,
              scopeId: command.projectId,
              workThreadId: `${command.projectId}:coordinator`,
              agentId: "coordinator",
            }],
        events: [...current.facts.events, {
          id: eventId,
          type: "project.message",
          occurredAt: "2026-10-03T00:00:00.000Z",
          payload: { text: command.text, ...(command.attachments ? { attachments: command.attachments } : {}) },
        }],
        turns: [...current.facts.turns, {
          id: turnId,
          sessionId,
          triggerEventId: eventId,
          state: "completed",
          createdAt: "2026-10-03T00:00:00.000Z",
        }],
        agentEvents: [...current.facts.agentEvents, {
          type: "agent.message",
          turn_id: turnId,
          data: { text: "Acknowledged.", message_id: turnId },
        }],
      };
    },
    async goal(input) {
      calls.goal.push(structuredClone(input));
      const current = stored.get(input.projectId);
      if (!current) throw new Error(`Unknown project ${input.projectId}`);
      let updated: ThreadGoal | null = null;
      current.facts = {
        ...current.facts,
        goals: current.facts.goals.map((item) => {
          if (item.workThreadId !== input.workThreadId) return item;
          updated = {
            ...item,
            ...(input.status ? { status: input.status } : {}),
            ...(input.objective ? { objective: input.objective } : {}),
            revision: item.revision + 1,
          };
          return updated;
        }),
      };
      return updated;
    },
    async delete(projectId) {
      calls.delete.push(projectId);
      const index = projects.findIndex((item) => item.id === projectId);
      if (index >= 0) projects.splice(index, 1);
      stored.delete(projectId);
    },
  };
  return { client, calls };
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root: Root = createRoot(host);
  await act(async () => {
    root.render(node);
  });
  await flush();
  return {
    host,
    async unmount() {
      await act(async () => {
        root.unmount();
      });
    },
  };
}

function buttonNamed(host: ParentNode, name: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((element) => {
    const label = element.getAttribute("aria-label") ?? element.textContent ?? "";
    return label.replace(/\s+/g, " ").includes(name);
  });
  if (!(found instanceof HTMLButtonElement)) {
    throw new Error(`Missing button ${name}. Visible text: ${host.textContent}`);
  }
  return found;
}

function fieldNamed(host: ParentNode, name: string): HTMLInputElement | HTMLTextAreaElement {
  const found = host.querySelector(`[aria-label="${name}"]`);
  if (found instanceof HTMLInputElement || found instanceof HTMLTextAreaElement) return found;
  throw new Error(`Missing field ${name}`);
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
  });
  await flush();
}

async function fill(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
}

describe("Projects surface", () => {
  it("lists projects and filters them without calling the network", async () => {
    const alpha = configuredView(project("alpha", "Alpha"));
    const beta = configuredView(project("beta", "Beta"));
    const { client, calls } = createFakeClient([alpha, beta]);
    const page = await mount(<ProjectsPage client={client} refreshIntervalMs={0} />);

    expect(page.host.textContent).toContain("Alpha");
    expect(page.host.textContent).toContain("Beta");
    expect(calls.save).toHaveLength(0);
    expect(calls.submit).toHaveLength(0);

    await fill(fieldNamed(page.host, "Search projects"), "alp");
    expect(page.host.textContent).toContain("Alpha");
    expect(page.host.textContent).not.toContain("Beta");
    await page.unmount();
  });

  it("creates a project through the client, including an optional goal", async () => {
    const picked = vi.fn(async () => ["/work/app"]);
    const { client, calls } = createFakeClient();
    client.pickFolders = picked;
    const page = await mount(<ProjectsPage client={client} refreshIntervalMs={0} />);

    expect(page.host.textContent).toContain("A place for work that continues");
    await click(buttonNamed(page.host, "New project"));
    const create = buttonNamed(page.host, "Create project");
    expect(create.disabled).toBe(true);
    await fill(fieldNamed(page.host, "Project name"), "Checkout");
    await fill(fieldNamed(page.host, "Goal"), "Ship checkout");
    await click(buttonNamed(page.host, "Add folders OpenMA can read and edit"));
    expect(picked).toHaveBeenCalledOnce();
    expect(page.host.textContent).toContain("app");
    await click(buttonNamed(page.host, "Create project"));

    expect(calls.save).toEqual([expect.objectContaining({
      name: "Checkout",
      source_folders: ["/work/app"],
      primary_folder: "/work/app",
    })]);
    expect(calls.saveWork[0]).toMatchObject({ description: "Ship checkout", coordinatorAgent: "" });
    expect(page.host.textContent).toContain("Checkout");
    expect(page.host.textContent).toContain("Make this project your own");
    await page.unmount();
  });

  it("sends a coordinator message through the open conversation", async () => {
    const info = project("checkout", "Checkout");
    const { client, calls } = createFakeClient([configuredView(info)]);
    const page = await mount(<ProjectsPage client={client} refreshIntervalMs={0} />);

    await click(page.host.querySelector("[data-project-id='checkout']") as HTMLButtonElement);
    const composer = fieldNamed(page.host, "Message coordinator");
    await fill(composer, "Ship the fix");
    await click(buttonNamed(page.host, "Send message"));

    expect(calls.submit).toEqual([expect.objectContaining({
      projectId: "checkout",
      type: "message",
      text: "Ship the fix",
    })]);
    expect(page.host.textContent).toContain("Ship the fix");
    expect(page.host.textContent).toContain("Acknowledged.");
    expect(page.host.querySelector('[data-chat-surface="project"]')).not.toBeNull();
    await page.unmount();
  });

  it("pauses the coordinator goal through the client", async () => {
    const info = project("checkout", "Checkout");
    const goal: ThreadGoal = {
      id: "goal-1",
      scopeId: info.id,
      workThreadId: `${info.id}:coordinator`,
      objective: "Ship a reviewed fix",
      status: "active",
      tokenBudget: 200_000,
      tokensUsed: 12_000,
      timeUsedSeconds: 30,
      revision: 1,
      createdAt: "2026-09-22T00:00:00Z",
      updatedAt: "2026-09-22T00:00:30Z",
    };
    const { client, calls } = createFakeClient([configuredView(info, {
      sessions: [{
        id: "coordinator-session",
        scopeId: info.id,
        workThreadId: `${info.id}:coordinator`,
        agentId: "coordinator",
      }],
      goals: [goal],
    })]);
    const page = await mount(<ProjectsPage client={client} refreshIntervalMs={0} />);
    await click(page.host.querySelector("[data-project-id='checkout']") as HTMLButtonElement);

    expect(page.host.textContent).toContain("Ship a reviewed fix");
    expect(page.host.textContent).toContain("In progress");
    expect(page.host.textContent).toContain("12k/200k");
    await click(buttonNamed(page.host, "Pause"));

    expect(calls.goal).toEqual([expect.objectContaining({
      projectId: "checkout",
      workThreadId: "checkout:coordinator",
      status: "paused",
    })]);
    expect(buttonNamed(page.host, "Resume")).toBeInstanceOf(HTMLButtonElement);
    expect(page.host.textContent).toContain("Paused");
    await page.unmount();
  });

  it("deletes a project and returns to the list", async () => {
    const { client, calls } = createFakeClient([
      configuredView(project("checkout", "Checkout")),
      configuredView(project("other", "Other")),
    ]);
    const page = await mount(<ProjectsPage client={client} refreshIntervalMs={0} />);
    await click(page.host.querySelector("[data-project-id='checkout']") as HTMLButtonElement);
    await click(buttonNamed(page.host, "Project settings"));
    expect(page.host.textContent).toContain("Coordinator settings");
    await click(buttonNamed(page.host, "Delete project"));

    expect(calls.delete).toEqual(["checkout"]);
    expect(page.host.textContent).not.toContain("Checkout");
    expect(page.host.textContent).toContain("Other");
    expect(page.host.textContent).toContain("Projects");
    await page.unmount();
  });

  it("hides folder picking and worktrees when the host omits those callbacks", async () => {
    const info = project("checkout", "Checkout");
    const { client } = createFakeClient([configuredView(info)]);
    const page = await mount(<ProjectsPage client={client} refreshIntervalMs={0} />);
    await click(page.host.querySelector("[data-project-id='checkout']") as HTMLButtonElement);
    await click(buttonNamed(page.host, "Tasks"));
    await click(buttonNamed(page.host, "Library"));

    expect(page.host.textContent).not.toContain("Worktrees");
    expect(page.host.textContent).not.toContain("Add folders OpenMA can read and edit");
    expect(client.pickFolders).toBeUndefined();
    expect(client.listWorktrees).toBeUndefined();
    await page.unmount();
  });

  it("saves project settings against the same client", async () => {
    const info = project("checkout", "Checkout");
    const { client, calls } = createFakeClient([configuredView(info)]);
    const page = await mount(
      <ProjectSettings client={client} projectId="checkout" onBack={() => undefined} />,
    );
    await fill(fieldNamed(page.host, "Project name"), "Checkout renamed");
    await click(buttonNamed(page.host, "Save"));
    expect(calls.save[0]).toMatchObject({
      project_id: "checkout",
      name: "Checkout renamed",
      primary_folder: "/work/app",
    });
    expect(page.host.textContent).toContain("Project settings saved.");
    await page.unmount();
  });
});

describe("project-ui package boundary", () => {
  it("publishes a browser entry and does not import Node, Electron, or window.backchat", () => {
    const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8")) as {
      exports?: Record<string, unknown>;
    };
    expect(pkg.exports?.["./project-ui"]).toEqual({
      types: "./dist/project-ui/index.d.ts",
      import: "./dist/project-ui/index.js",
    });
    expect(pkg.exports?.["./project-ui/styles.css"]).toBe("./dist/project-ui/styles.css");

    const directory = resolve(import.meta.dirname, "../src/project-ui");
    const source = readdirSync(directory)
      .filter((name) => name.endsWith(".ts") || name.endsWith(".tsx"))
      .map((name) => readFileSync(resolve(directory, name), "utf8"))
      .join("\n");
    expect(source).not.toMatch(/from\s+["']node:/);
    expect(source).not.toMatch(/from\s+["']electron["']/);
    expect(source).not.toContain("window.backchat");
    expect(source).toContain("export interface ProjectClient");
  });
});
