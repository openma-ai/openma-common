import { describe, expect, it } from "vitest";

import {
  OPENMA_EVENT_SCHEMA_VERSION,
  createOpenMAEvent,
  createRawEvent,
  createVendorEvent,
  finalizeWorkItems,
  reduceWorkItems,
  type OpenMAEvent,
} from "../src/session-events/openma.js";

const source = { kind: "harness" as const, harness: "claude-acp", adapter: "claude" };

const event = <TType extends string, TData>(
  type: TType,
  data: TData,
  fields: Partial<OpenMAEvent> = {},
) => createOpenMAEvent({
  event_id: fields.event_id ?? `${type}-1`,
  type,
  session_id: fields.session_id ?? "sess-1",
  source,
  occurred_at: fields.occurred_at ?? "2026-08-04T10:00:00.000Z",
  ...(fields.turn_id ? { turn_id: fields.turn_id } : {}),
  ...(fields.work_item_id ? { work_item_id: fields.work_item_id } : {}),
  ...(fields.seq ? { seq: fields.seq } : {}),
  data,
});

describe("OpenMA canonical events", () => {
  it("adds the stable schema version without changing the event payload", () => {
    const result = createOpenMAEvent({
      event_id: "evt-1",
      type: "user.message",
      session_id: "sess-1",
      source: { kind: "user" },
      occurred_at: "2026-08-04T10:00:00.000Z",
      data: { text: "hello" },
    });

    expect(result).toEqual({
      schema_version: OPENMA_EVENT_SCHEMA_VERSION,
      event_id: "evt-1",
      type: "user.message",
      session_id: "sess-1",
      source: { kind: "user" },
      occurred_at: "2026-08-04T10:00:00.000Z",
      data: { text: "hello" },
    });
  });

  it("models a Monitor delivery independently from background work lifecycle", () => {
    const monitor: OpenMAEvent = createOpenMAEvent({
      event_id: "monitor-event-1",
      type: "monitor.event",
      session_id: "sess-1",
      source,
      occurred_at: "2026-08-05T10:00:00.000Z",
      data: {
        description: "errors in deploy.log",
        text: "ERROR timeout",
      },
    });

    expect(monitor).toMatchObject({
      type: "monitor.event",
      data: {
        description: "errors in deploy.log",
        text: "ERROR timeout",
      },
    });
    expect(monitor).not.toHaveProperty("work_item_id");
  });

  it("keeps vendor facts separate from opaque raw records", () => {
    const vendor = createVendorEvent({
      event_id: "vendor-1",
      session_id: "sess-1",
      source,
      occurred_at: "2026-08-04T10:00:00.000Z",
      harness: "claude-acp",
      namespace: "claudeCode",
      name: "task_progress",
      version: "0.64.2",
      correlation: { work_item_id: "work-1" },
      data: { progress: 0.5 },
    });
    const raw = createRawEvent({
      event_id: "raw-1",
      session_id: "sess-1",
      source: { kind: "harness", harness: "unknown", adapter: "generic" },
      occurred_at: "2026-08-04T10:00:01.000Z",
      source_kind: "acp",
      method: "session/update",
      payload: { update: { sessionUpdate: "future_event" } },
      reason: "unknown",
    });

    expect(vendor.type).toBe("vendor.event");
    expect(vendor.data).toMatchObject({
      harness: "claude-acp",
      namespace: "claudeCode",
      name: "task_progress",
      correlation: { work_item_id: "work-1" },
    });
    expect(raw.type).toBe("raw.event");
    expect(raw.data).toMatchObject({
      source: "acp",
      method: "session/update",
      reason: "unknown",
    });
  });
});

describe("OpenMA WorkItem reducer", () => {
  it("reduces start, progress, output, and completion into one snapshot", () => {
    const registry = reduceWorkItems([
      event("work_item.started", { kind: "agent", title: "Research" }, { event_id: "w-start", work_item_id: "work-1", seq: 1 }),
      event("work_item.progress", { progress: 0.5 }, { event_id: "w-progress", work_item_id: "work-1", seq: 2 }),
      event("work_item.output", { output: "halfway" }, { event_id: "w-output", work_item_id: "work-1", seq: 3 }),
      event("work_item.completed", { result: "done" }, { event_id: "w-complete", work_item_id: "work-1", seq: 4 }),
    ]);

    expect(registry.items.get("work-1")).toMatchObject({
      id: "work-1",
      kind: "agent",
      title: "Research",
      status: "completed",
      progress: 0.5,
      output: ["halfway"],
      result: "done",
      started_at: "2026-08-04T10:00:00.000Z",
      ended_at: "2026-08-04T10:00:00.000Z",
    });
  });

  it("deduplicates events, ignores late updates after a terminal event, and exposes missing bookends", () => {
    const registry = reduceWorkItems([
      event("work_item.started", { kind: "bash" }, { event_id: "w-start", work_item_id: "work-2", seq: 1 }),
      event("work_item.completed", { result: 0 }, { event_id: "w-complete", work_item_id: "work-2", seq: 2 }),
      event("work_item.progress", { progress: 1 }, { event_id: "w-late", work_item_id: "work-2", seq: 3 }),
      event("work_item.completed", { result: 0 }, { event_id: "w-complete", work_item_id: "work-2", seq: 2 }),
      event("work_item.progress", { progress: 0.2 }, { event_id: "w-running-progress", work_item_id: "work-3", seq: 4 }),
    ]);

    const completed = registry.items.get("work-2");
    expect(completed).toMatchObject({
      status: "completed",
      result: 0,
    });
    expect(completed?.progress).toBeUndefined();
    expect(finalizeWorkItems(registry).items.get("work-3")).toMatchObject({
      status: "unknown",
      missing_start: true,
      missing_terminal: true,
    });
  });

  it("records an observed missing terminal without pretending the work completed", () => {
    const registry = reduceWorkItems([
      event(
        "work_item.started",
        { kind: "agent", title: "Async research" },
        { event_id: "async-start", work_item_id: "agent-1", seq: 1 },
      ),
      event(
        "work_item.missing_terminal",
        { reason: "parent_turn_completed" },
        { event_id: "async-missing-terminal", work_item_id: "agent-1", seq: 2 },
      ),
    ]);

    expect(registry.items.get("agent-1")).toMatchObject({
      status: "unknown",
      title: "Async research",
      reason: "parent_turn_completed",
      missing_terminal: true,
    });
    expect(registry.items.get("agent-1")?.ended_at).toBeUndefined();
  });

  it("preserves identity evidence when the first observed work-item event is terminal", () => {
    const registry = reduceWorkItems([
      event(
        "work_item.completed",
        {
          kind: "bash",
          title: "build project",
          result: { exit_code: 0 },
        },
        {
          event_id: "terminal-only-completion",
          work_item_id: "background-1",
        },
      ),
    ]);

    expect(registry.items.get("background-1")).toMatchObject({
      id: "background-1",
      kind: "bash",
      title: "build project",
      status: "completed",
      missing_start: true,
      result: { exit_code: 0 },
    });
  });

  it("reidentifies a provisional work item without leaving a duplicate", () => {
    const registry = reduceWorkItems([
      event(
        "work_item.started",
        { kind: "agent", title: "Audit adapters" },
        { event_id: "provisional-start", work_item_id: "claude:tool-1", seq: 1 },
      ),
      event(
        "work_item.reidentified",
        { previous_work_item_id: "claude:tool-1" },
        { event_id: "agent-id-known", work_item_id: "agent-1", seq: 2 },
      ),
    ]);

    expect([...registry.items.keys()]).toEqual(["agent-1"]);
    expect(registry.items.get("agent-1")).toMatchObject({
      id: "agent-1",
      kind: "agent",
      title: "Audit adapters",
      status: "running",
    });
  });

  it("classifies an existing generic work item without restarting it", () => {
    const registry = reduceWorkItems([
      event(
        "work_item.started",
        { kind: "other", title: "Watch deployment status" },
        {
          event_id: "generic-start",
          work_item_id: "monitor-task-1",
          occurred_at: "2026-08-05T01:00:00.000Z",
          seq: 1,
        },
      ),
      event(
        "work_item.classified",
        { kind: "monitor" },
        {
          event_id: "monitor-identity-known",
          work_item_id: "monitor-task-1",
          occurred_at: "2026-08-05T01:00:05.000Z",
          seq: 2,
        },
      ),
    ]);

    expect(registry.items.get("monitor-task-1")).toMatchObject({
      id: "monitor-task-1",
      kind: "monitor",
      title: "Watch deployment status",
      status: "running",
      started_at: "2026-08-05T01:00:00.000Z",
    });
  });
});
