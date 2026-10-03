import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  decodeCursorCloudRunStreamEvent,
  type CursorCloudSseEvent,
} from "../../src/protocol/cursor-cloud/index.js";

const NOW = "2026-04-13T18:30:00.000Z";
const SESSION = "bc-00000000-0000-0000-0000-000000000001";
const RUN = "run-00000000-0000-0000-0000-000000000001";
const context = { sessionId: SESSION, turnId: RUN, now: () => NOW };

function decode(event: CursorCloudSseEvent) {
  return decodeCursorCloudRunStreamEvent(event, context);
}

function canonical(type: string, eventId: string, data: unknown) {
  return {
    schema: "oma.event.v1",
    schema_version: "oma.event.v1",
    event_id: eventId,
    type,
    session_id: SESSION,
    turn_id: RUN,
    source: { kind: "harness", harness: "cursor-cloud" },
    occurred_at: NOW,
    data,
  };
}

function vendor(name: string, eventId: string, payload: unknown, sseId?: string) {
  return {
    schema: "oma.event.v1",
    schema_version: "oma.event.v1",
    event_id: eventId,
    type: "vendor.event",
    session_id: SESSION,
    turn_id: RUN,
    source: { kind: "harness", harness: "cursor-cloud" },
    occurred_at: NOW,
    data: {
      kind: "vendor",
      harness: "cursor-cloud",
      namespace: "runs",
      name,
      correlation: { session_id: SESSION, turn_id: RUN },
      data: {
        ...(sseId ? { sse_id: sseId } : {}),
        payload,
      },
    },
  };
}

function expectNoSeq(events: readonly { seq?: unknown; ingested_at?: unknown }[]) {
  for (const event of events) {
    expect(event).not.toHaveProperty("seq");
    expect(event).not.toHaveProperty("ingested_at");
  }
}

describe("Cursor Cloud run SSE decoder", () => {
  it("publishes ./protocol/cursor-cloud the same way as ./protocol/managed", () => {
    const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../package.json"), "utf8")) as {
      exports?: Record<string, unknown>;
    };
    expect(pkg.exports?.["./protocol/cursor-cloud"]).toEqual({
      types: "./dist/protocol/cursor-cloud/index.d.ts",
      import: "./dist/protocol/cursor-cloud/index.js",
    });
  });

  it("maps the documented example stream without using the SSE id as seq", () => {
    const readResult = {
      success: { content: "# Project", totalLines: 1, fileSize: 9, path: "README.md" },
    };
    const git = {
      branches: [{ repoUrl: "github.com/your-org/your-repo", branch: "cursor/add-readme-a1b2" }],
    };
    const frames: CursorCloudSseEvent[] = [
      { event: "status", data: { runId: RUN, status: "RUNNING" } },
      { event: "assistant", id: "1713033000000-0", data: { text: "I'll update the README now." } },
      {
        event: "tool_call",
        id: "1713033005000-0",
        data: { callId: "call-1", name: "read_file", status: "running", args: { path: "README.md" } },
      },
      {
        event: "tool_call",
        id: "1713033006000-0",
        data: {
          callId: "call-1",
          name: "read_file",
          status: "completed",
          args: { path: "README.md" },
          result: readResult,
        },
      },
      {
        event: "result",
        id: "1713033010000-0",
        data: {
          runId: RUN,
          status: "FINISHED",
          text: "Added README.md with installation instructions.",
          durationMs: 12357,
          git,
        },
      },
      { event: "done", id: "1713033010000-0", data: {} },
    ];
    const events = frames.flatMap(decode);
    expectNoSeq(events);
    expect(events.map((event) => event.type)).toEqual([
      "turn.started",
      "agent.message_chunk",
      "tool.started",
      "tool.completed",
      "turn.completed",
      "vendor.event",
    ]);
    expect(events[0]).toEqual(canonical("turn.started", `status:${RUN}:RUNNING`, {
      adapter_meta: {
        cursor_event: "status",
        run_status: "RUNNING",
        run_id: RUN,
      },
    }));
    expect(events[1]).toEqual(canonical("agent.message_chunk", "assistant:1713033000000-0", {
      message_id: `${RUN}:assistant`,
      text: "I'll update the README now.",
      adapter_meta: { cursor_event: "assistant", sse_id: "1713033000000-0" },
    }));
    expect(events[2]).toEqual(canonical("tool.started", "tool_call:1713033005000-0", {
      tool_call_id: "call-1",
      tool_name: "read_file",
      title: "read_file",
      status: "in_progress",
      raw_input: { path: "README.md" },
      adapter_meta: { cursor_event: "tool_call", sse_id: "1713033005000-0" },
    }));
    expect(events[3]).toEqual(canonical("tool.completed", "tool_call:1713033006000-0", {
      tool_call_id: "call-1",
      tool_name: "read_file",
      title: "read_file",
      status: "completed",
      raw_input: { path: "README.md" },
      raw_output: readResult,
      adapter_meta: { cursor_event: "tool_call", sse_id: "1713033006000-0" },
    }));
    expect(events[4]).toEqual(canonical("turn.completed", "result:1713033010000-0", {
      stop_reason: "FINISHED",
      adapter_meta: {
        cursor_event: "result",
        sse_id: "1713033010000-0",
        text: "Added README.md with installation instructions.",
        durationMs: 12357,
        run_id: RUN,
      },
    }));
    expect(events[5]).toEqual(vendor("git", "result:1713033010000-0:git", git, "1713033010000-0"));
    expect(events.some((event) => event.type === "agent.message")).toBe(false);
  });

  it("maps CREATING to turn.queued and keeps an id-less status event id stable", () => {
    const data = { runId: RUN, status: "CREATING" };
    const first = decode({ event: "status", data });
    const resent = decode({ event: "status", data });
    expect(first).toEqual(resent);
    expect(first).toEqual([canonical("turn.queued", `status:${RUN}:CREATING`, {
      adapter_meta: { cursor_event: "status", run_status: "CREATING", run_id: RUN },
    })]);
    expectNoSeq(first);
  });

  it("gives a later status event its own id when the SSE id is present", () => {
    const data = { runId: RUN, status: "RUNNING" };
    const events = decode({ event: "status", id: "1713033001000-0", data });
    expect(events).toEqual([canonical(
      "turn.started",
      `status:${RUN}:RUNNING:1713033001000-0`,
      {
        adapter_meta: {
          cursor_event: "status",
          sse_id: "1713033001000-0",
          run_status: "RUNNING",
          run_id: RUN,
        },
      },
    )]);
  });

  it.each(["FINISHED", "ERROR", "CANCELLED", "EXPIRED"] as const)(
    "keeps terminal status %s as a vendor event so result owns the turn",
    (status) => {
      const data = { runId: RUN, status };
      expect(decode({ event: "status", data })).toEqual([
        vendor("status", `status:${RUN}:${status}`, data),
      ]);
    },
  );

  it("keeps an unknown or malformed status payload as a vendor event", () => {
    expect(decode({ event: "status", data: { runId: RUN, status: "PAUSED" } })).toEqual([
      vendor("status", `status:${RUN}:PAUSED`, { runId: RUN, status: "PAUSED" }),
    ]);
    expect(decode({ event: "status", data: { runId: RUN } })).toEqual([
      vendor("status", `status:${RUN}`, { runId: RUN }),
    ]);
    expect(decode({ event: "status", data: "RUNNING" })).toEqual([
      vendor("status", `status:${RUN}`, "RUNNING"),
    ]);
  });

  it("shares one assistant message id across deltas and vendors a non-string payload", () => {
    const first = decode({ event: "assistant", id: "a-1", data: { text: "Hello" } });
    const second = decode({ event: "assistant", id: "a-2", data: { text: " there" } });
    expect(first[0]).toMatchObject({
      type: "agent.message_chunk",
      event_id: "assistant:a-1",
      data: { message_id: `${RUN}:assistant`, text: "Hello" },
    });
    expect(second[0]).toMatchObject({
      event_id: "assistant:a-2",
      data: { message_id: `${RUN}:assistant`, text: " there" },
    });
    expect(decode({ event: "assistant", data: { text: 1 } })).toEqual([
      vendor("assistant", `assistant:${RUN}`, { text: 1 }),
    ]);
  });

  it("maps a thinking delta onto agent.thinking without inventing a chunk type", () => {
    const events = decode({ event: "thinking", id: "th-1", data: { text: "Checking the README." } });
    expect(events).toEqual([canonical("agent.thinking", "thinking:th-1", {
      message_id: `${RUN}:thinking`,
      text: "Checking the README.",
      adapter_meta: {
        cursor_event: "thinking",
        sse_id: "th-1",
        text_role: "delta",
      },
    })]);
    expect(decode({ event: "thinking", data: {} })).toEqual([
      vendor("thinking", `thinking:${RUN}`, {}),
    ]);
  });

  it("preserves truncated tool args and result flags as documented", () => {
    const truncated = { args: true, result: true };
    const events = decode({
      event: "tool_call",
      id: "tool-trunc",
      data: { callId: "call-2", name: "run_terminal_cmd", status: "completed", truncated },
    });
    expect(events).toEqual([canonical("tool.completed", "tool_call:tool-trunc", {
      tool_call_id: "call-2",
      tool_name: "run_terminal_cmd",
      title: "run_terminal_cmd",
      status: "completed",
      adapter_meta: {
        cursor_event: "tool_call",
        sse_id: "tool-trunc",
        truncated,
      },
    })]);
    expect(events[0]?.data).not.toHaveProperty("raw_input");
    expect(events[0]?.data).not.toHaveProperty("raw_output");
  });

  it("does not classify a completed tool result as failed", () => {
    // RunStreamToolCallData.result is JSON. The only documented example is
    // `{ success: ... }`. `{ error: ... }` is not a documented failure shape.
    const result = { error: "disk full" };
    const events = decode({
      event: "tool_call",
      data: { callId: "call-3", name: "mcp", status: "completed", result },
    });
    expect(events).toEqual([canonical("tool.completed", "tool_call:call-3:completed", {
      tool_call_id: "call-3",
      tool_name: "mcp",
      title: "mcp",
      status: "completed",
      raw_output: result,
      adapter_meta: { cursor_event: "tool_call" },
    })]);
    expect(events[0]?.type).not.toBe("tool.failed");
  });

  it("keeps a tool status outside running|completed as a vendor event", () => {
    const data = { callId: "call-4", name: "read_file", status: "error", result: { message: "nope" } };
    expect(decode({ event: "tool_call", id: "tool-error", data })).toEqual([
      vendor("tool_call", "tool_call:tool-error", data, "tool-error"),
    ]);
    expect(decode({ event: "tool_call", data: { name: "read_file", status: "running" } })).toEqual([
      vendor("tool_call", `tool_call:${RUN}:running`, { name: "read_file", status: "running" }),
    ]);
  });

  it.each([
    ["ERROR", "turn.failed"],
    ["EXPIRED", "turn.failed"],
    ["CANCELLED", "turn.cancelled"],
  ] as const)("maps result status %s to %s", (status, type) => {
    const data = { runId: RUN, status, durationMs: 10 };
    expect(decode({ event: "result", data })).toEqual([canonical(type, `result:${RUN}:${status}`, {
      stop_reason: status,
      adapter_meta: { cursor_event: "result", durationMs: 10, run_id: RUN },
    })]);
  });

  it("omits optional result fields and skips a missing git object", () => {
    const events = decode({ event: "result", data: { runId: RUN, status: "FINISHED" } });
    expect(events).toEqual([canonical("turn.completed", `result:${RUN}:FINISHED`, {
      stop_reason: "FINISHED",
      adapter_meta: { cursor_event: "result", run_id: RUN },
    })]);
  });

  it("copies Run.git branches, including prUrl, into a vendor event", () => {
    const git = {
      branches: [{
        repoUrl: "github.com/your-org/your-repo",
        branch: "cursor/add-readme-a1b2",
        prUrl: "https://github.com/your-org/your-repo/pull/123",
      }],
    };
    const events = decode({
      event: "result",
      id: "result-1",
      data: { runId: RUN, status: "FINISHED", git },
    });
    expect(events.map((event) => event.type)).toEqual(["turn.completed", "vendor.event"]);
    expect(events[1]).toEqual(vendor("git", "result:result-1:git", git, "result-1"));
  });

  it("keeps an unknown result status as a vendor event", () => {
    const data = { runId: RUN, status: "RUNNING", text: "still going" };
    expect(decode({ event: "result", data })).toEqual([
      vendor("result", `result:${RUN}`, data),
    ]);
  });

  it("maps an error event to session.error and vendors a malformed one", () => {
    const data = { code: "unavailable", message: "The run stream failed." };
    expect(decode({ event: "error", id: "err-1", data })).toEqual([
      canonical("session.error", "error:err-1", {
        code: "unavailable",
        message: "The run stream failed.",
        adapter_meta: { cursor_event: "error", sse_id: "err-1" },
      }),
    ]);
    expect(decode({ event: "error", data: { code: "unavailable" } })).toEqual([
      vendor("error", `error:${RUN}`, { code: "unavailable" }),
    ]);
  });

  it("keeps interaction_update as a vendor event and passes the payload through", () => {
    const data = { type: "text-delta", text: "partial" };
    expect(decode({ event: "interaction_update", id: "ix-1", data })).toEqual([
      vendor("interaction_update", "interaction_update:ix-1", data, "ix-1"),
    ]);
  });

  it("drops heartbeat and done", () => {
    expect(decode({ event: "heartbeat", id: "hb-1", data: {} })).toEqual([]);
    expect(decode({ event: "done", data: { ignored: true } })).toEqual([]);
    expect(decode({ event: "heartbeat", data: { text: "nope" } })).toEqual([]);
  });

  it("keeps an unknown event name as a cursor-cloud vendor event", () => {
    const data = { tokens: 3 };
    expect(decode({ event: "usage", id: "u-1", data })).toEqual([
      vendor("usage", "usage:u-1", data, "u-1"),
    ]);
    expect(decode({ event: "", data })).toEqual([
      vendor("unknown", `unknown:${RUN}`, data),
    ]);
  });

  it("reads occurred_at from the injected clock", () => {
    const events = decodeCursorCloudRunStreamEvent(
      { event: "assistant", data: { text: "Hi" } },
      { ...context, now: () => "1999-01-01T00:00:00.000Z" },
    );
    expect(events[0]?.occurred_at).toBe("1999-01-01T00:00:00.000Z");
  });
});
