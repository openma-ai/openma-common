import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  decodeCursorCloudRunStreamEvent,
  type CursorCloudSseEvent,
} from "../../src/protocol/cursor-cloud/index.js";
import { FIXTURE_AGENT_ID, FIXTURE_RUN_ID } from "../live/redact.js";

const NOW = "2026-04-13T18:30:00.000Z";

/**
 * Real `GET /v1/agents/{id}/runs/{runId}/stream` capture from
 * https://github.com/openma-ai/openma-common/actions/runs/37110762427.
 * Agent and run ids are placeholders. The follow-up run fixture is added
 * beside this file after the multi-run live job.
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
});

function vendorName(event: { data: unknown }): string {
  const data = event.data;
  if (typeof data !== "object" || data === null || !("name" in data)) return "";
  const name = data.name;
  return typeof name === "string" ? name : "";
}
