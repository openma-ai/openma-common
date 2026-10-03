import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  decodeCursorCloudRunStreamEvent,
  type CursorCloudSseEvent,
} from "../../src/protocol/cursor-cloud/index.js";
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
      "session.error",
    ]);
    expect(decoded[2]).toMatchObject({
      data: {
        code: "stream_unavailable",
        message: "Run stream is no longer available",
      },
    });
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
