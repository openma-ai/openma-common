import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  decodeCursorCloudRunStreamEvent,
  type CursorCloudSseEvent,
} from "../../src/protocol/cursor-cloud/index.js";
import { assessRunBoundaries } from "../live/assess.js";
import { FIXTURE_AGENT_ID, FIXTURE_RUN_ID, FIXTURE_RUN_ID_2 } from "../live/redact.js";

const NOW = "2026-04-13T18:30:00.000Z";

/**
 * Real `GET /v1/agents/{id}/runs/{runId}/stream` capture from
 * https://github.com/openma-ai/openma-common/actions/runs/37110762427.
 * Agent and run ids are placeholders.
 */
describe("Cursor Cloud live fixture", () => {
  it("decodes the 2026-10-03 initial run, including the user prompt", () => {
    const fixture = JSON.parse(readFileSync(
      resolve(import.meta.dirname, "../fixtures/cursor-cloud/2026-10-03-initial-run.events.json"),
      "utf8",
    )) as { events: CursorCloudSseEvent[] };
    const decoded = fixture.events.flatMap((event) => decodeCursorCloudRunStreamEvent(event, {
      sessionId: FIXTURE_AGENT_ID,
      turnId: FIXTURE_RUN_ID,
      now: () => NOW,
    }));
    expect(decoded.map((event) => event.type)).toEqual([
      "turn.started",
      "vendor.event",
      "user.message",
      "agent.thinking",
      "vendor.event",
      "vendor.event",
      "vendor.event",
      "agent.message_chunk",
      "vendor.event",
      "vendor.event",
      "vendor.event",
      "vendor.event",
      "vendor.event",
      "turn.completed",
      "vendor.event",
    ]);
    const user = decoded.find((event) => event.type === "user.message");
    expect(user).toMatchObject({
      event_id: "user:1791017141403-0",
      session_id: FIXTURE_AGENT_ID,
      turn_id: FIXTURE_RUN_ID,
      data: {
        message_id: `${FIXTURE_RUN_ID}:user:1791017141403-0`,
        text: "Reply with exactly the word hello and then stop. Do not use tools. Do not read or modify files. Do not run commands. Do not commit, push, or open a pull request.",
        adapter_meta: {
          cursor_event: "interaction_update",
          interaction_type: "user-message-appended",
          user_message: {
            type: "user_message",
            session_id: FIXTURE_RUN_ID,
          },
        },
      },
    });
    expect(decoded.filter((event) => event.type === "turn.completed")).toHaveLength(1);
    expect(decoded.some((event) => event.type === "vendor.event" && vendorName(event) === "status")).toBe(true);
    expect(decoded.some((event) => event.type === "vendor.event" && vendorName(event) === "git")).toBe(true);
    for (const event of decoded) {
      expect(event).not.toHaveProperty("seq");
      expect(JSON.stringify(event)).not.toMatch(/crsr_|ghp_|ghs_|github_pat_|Bearer /);
    }
  });

  it("decodes the read-only README run, including tool calls and no user-message event", () => {
    const decoded = decodeFixture("2026-10-03-read-readme-run.events.json", FIXTURE_RUN_ID);
    const types = decoded.map((event) => event.type);
    expect(types.indexOf("turn.queued")).toBeGreaterThanOrEqual(0);
    expect(types.indexOf("turn.started")).toBeGreaterThan(types.indexOf("turn.queued"));
    expect(types.indexOf("tool.started")).toBeGreaterThan(types.indexOf("turn.started"));
    expect(types.indexOf("tool.completed")).toBeGreaterThan(types.indexOf("tool.started"));
    expect(types.indexOf("agent.message_chunk")).toBeGreaterThan(types.indexOf("tool.completed"));
    expect(types.lastIndexOf("turn.completed")).toBeGreaterThan(types.indexOf("agent.message_chunk"));
    expect(types.filter((type) => type === "turn.completed")).toHaveLength(1);
    expect(types).not.toContain("user.message");
    const completed = decoded.find((event) => event.type === "tool.completed");
    expect(completed).toMatchObject({
      data: {
        tool_name: "read_file",
        raw_output: {
          success: {
            path: "/workspace/README.md",
            readRange: { startLine: 1, endLine: 5 },
          },
        },
      },
    });
  });

  it("decodes the follow-up stream that closed with stream_unavailable", () => {
    const decoded = decodeFixture("2026-10-03-follow-up-stream-unavailable.events.json", FIXTURE_RUN_ID_2);
    expect(decoded.map((event) => event.type)).toEqual([
      "turn.queued",
      "turn.started",
      "vendor.event",
    ]);
    expect(decoded.some((event) => event.type === "session.error")).toBe(false);
    expect(decoded[2]).toMatchObject({
      type: "vendor.event",
      data: {
        name: "error",
        data: {
          payload: {
            code: "stream_unavailable",
            message: "Run stream is no longer available",
          },
        },
      },
    });
  });

  it("keeps the follow-up run on its own turn after a rejected mid-run post", () => {
    const fixture = JSON.parse(readFileSync(
      resolve(import.meta.dirname, "../fixtures/cursor-cloud/2026-10-03-two-rounds.events.json"),
      "utf8",
    )) as {
      steer: { httpStatus: number; code: string; accepted: boolean };
      runs: { label: string; runId: string; prompt: string; events: CursorCloudSseEvent[] }[];
    };
    expect(fixture.steer).toMatchObject({ httpStatus: 409, code: "agent_busy", accepted: false });
    const decoded = fixture.runs.map((run) => ({
      label: run.label,
      turnId: run.runId,
      frames: run.events.map((event) => ({
        raw: event,
        events: decodeCursorCloudRunStreamEvent(event, {
          sessionId: FIXTURE_AGENT_ID,
          turnId: run.runId,
          now: () => NOW,
        }),
      })),
    }));
    expect(assessRunBoundaries(FIXTURE_AGENT_ID, decoded)).toEqual([]);
    const followUp = decoded.find((run) => run.label === "follow-up");
    const types = followUp?.frames.flatMap((frame) => frame.events).map((event) => event.type) ?? [];
    expect(types).not.toContain("session.error");
    expect(types.indexOf("turn.started")).toBeGreaterThanOrEqual(0);
    expect(types.indexOf("user.message")).toBeGreaterThan(types.indexOf("turn.started"));
    expect(types.indexOf("agent.message_chunk")).toBeGreaterThan(types.indexOf("user.message"));
    expect(types.lastIndexOf("turn.completed")).toBeGreaterThan(types.indexOf("agent.message_chunk"));
    const user = followUp?.frames.flatMap((frame) => frame.events).find((event) => event.type === "user.message");
    expect(user).toMatchObject({
      turn_id: FIXTURE_RUN_ID_2,
      data: { text: "只回复 ok" },
    });
    const initialText = decoded
      .find((run) => run.label === "initial")
      ?.frames.flatMap((frame) => frame.events)
      .filter((event) => event.type === "user.message")
      .map((event) => event.data && typeof event.data === "object" && "text" in event.data ? event.data.text : "")
      .join("\n");
    expect(initialText).not.toContain("只回复 ok");
  });
});

function decodeFixture(name: string, turnId: string) {
  const fixture = JSON.parse(readFileSync(
    resolve(import.meta.dirname, "../fixtures/cursor-cloud", name),
    "utf8",
  )) as { events: CursorCloudSseEvent[] };
  return fixture.events.flatMap((event) => decodeCursorCloudRunStreamEvent(event, {
    sessionId: FIXTURE_AGENT_ID,
    turnId,
    now: () => NOW,
  }));
}

function vendorName(event: { data: unknown }): string {
  const data = event.data;
  if (typeof data !== "object" || data === null || !("name" in data)) return "";
  const name = data.name;
  return typeof name === "string" ? name : "";
}
