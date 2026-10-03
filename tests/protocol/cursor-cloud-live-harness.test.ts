import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  decodeCursorCloudRunStreamEvent,
  type CursorCloudSseEvent,
} from "../../src/protocol/cursor-cloud/index.js";
import { assessDecodedFrames, assessRunBoundaries, DOCUMENTED_SSE_EVENTS } from "../live/assess.js";
import {
  buildCreateAgentRequest,
  buildFollowUpRequest,
  cleanupLiveAgent,
  collectRunEvents,
  createFollowUpRun,
  createLiveAgent,
  CursorCloudApiError,
  cursorCloudAuthorization,
  LIVE_PROMPT,
  LIVE_REPOSITORY,
} from "../live/cursor-cloud-api.js";
import { parseSseFrame, readSseEvents } from "../live/parse-sse.js";
import { FIXTURE_AGENT_ID, FIXTURE_RUN_ID, redactString, redactValue, replaceLiveIdentifiers } from "../live/redact.js";

const NOW = "2026-04-13T18:30:00.000Z";
const SESSION = "bc-00000000-0000-0000-0000-000000000001";
const RUN = "run-00000000-0000-0000-0000-000000000001";

const DOCUMENTED_STREAM = [
  "event: status",
  `data: ${JSON.stringify({ runId: RUN, status: "RUNNING" })}`,
  "",
  "id: 1713033000000-0",
  "event: assistant",
  `data: ${JSON.stringify({ text: "I'll update the README now." })}`,
  "",
  "id: 1713033005000-0",
  "event: tool_call",
  `data: ${JSON.stringify({ callId: "call-1", name: "read_file", status: "running", args: { path: "README.md" } })}`,
  "",
  "id: 1713033006000-0",
  "event: tool_call",
  `data: ${JSON.stringify({
    callId: "call-1",
    name: "read_file",
    status: "completed",
    args: { path: "README.md" },
    result: { success: { content: "# Project", totalLines: 1, fileSize: 9, path: "README.md" } },
  })}`,
  "",
  "id: 1713033010000-0",
  "event: result",
  `data: ${JSON.stringify({
    runId: RUN,
    status: "FINISHED",
    text: "Added README.md with installation instructions.",
    durationMs: 12357,
    git: { branches: [{ repoUrl: "github.com/your-org/your-repo", branch: "cursor/add-readme-a1b2" }] },
  })}`,
  "",
  "id: 1713033010000-0",
  "event: done",
  "data: {}",
  "",
].join("\n");

describe("Cursor Cloud live harness", () => {
  it("keeps the documented SSE event names aligned with the decoder switch", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../../src/protocol/cursor-cloud/index.ts"), "utf8");
    const cases = [...source.matchAll(/case "([^"]+)":/g)].map((match) => match[1] ?? "");
    expect(new Set(cases)).toEqual(DOCUMENTED_SSE_EVENTS);
  });

  it("parses the documented run stream, including a shared id on result and done", async () => {
    const events = await collectText(DOCUMENTED_STREAM);
    expect(events.map((event) => event.event)).toEqual([
      "status",
      "assistant",
      "tool_call",
      "tool_call",
      "result",
      "done",
    ]);
    expect(events[0]).not.toHaveProperty("id");
    expect(events[1]?.id).toBe("1713033000000-0");
    expect(events[4]?.id).toBe(events[5]?.id);
    expect(events[3]?.data).toMatchObject({ status: "completed", name: "read_file" });
  });

  it("ignores comments and retry fields, joins data lines, and keeps non-JSON data", async () => {
    const events = await collectText([
      ": keep-alive",
      "retry: 3000",
      "",
      "event: heartbeat",
      "data: {}",
      "",
      "id: multi",
      "event: assistant",
      "data: not-json",
      "data: still",
      "",
      "event: done",
      "data: {}",
    ].join("\n"));
    expect(events).toEqual([
      { event: "heartbeat", data: {} },
      { event: "assistant", id: "multi", data: "not-json\nstill" },
      { event: "done", data: {} },
    ]);
  });

  it("accepts CRLF frames and a final frame without a trailing blank line", async () => {
    const events = await collectText("event: status\r\ndata: {\"status\":\"RUNNING\",\"runId\":\"run-1\"}\r\n\r\nevent: done\r\ndata: {}");
    expect(events.map((event) => event.event)).toEqual(["status", "done"]);
    expect(parseSseFrame("event: message-default\ndata: {}")).toMatchObject({ event: "message-default", data: {} });
    expect(parseSseFrame(": comment only")).toBeUndefined();
  });

  it("redacts secrets, emails, and live ids before a sample can be stored", () => {
    const apiKey = "crsr_live_secret_value";
    const agentId = "bc-12345678-1234-1234-1234-123456789abc";
    const runId = "run-12345678-1234-1234-1234-123456789abc";
    const redacted = redactValue({
      text: `Authorization: Bearer ${apiKey} mail dev@example.com`,
      userEmail: "dev@example.com",
      nested: { token: "ghp_abcdefghijklmnopqrstuvwxyz" },
      agentId,
      runId,
    }, [apiKey]);
    const replaced = replaceLiveIdentifiers(redacted, agentId, runId);
    expect(JSON.stringify(replaced)).not.toContain(apiKey);
    expect(JSON.stringify(replaced)).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz");
    expect(JSON.stringify(replaced)).not.toContain("dev@example.com");
    expect(JSON.stringify(replaced)).not.toContain(agentId);
    expect(JSON.stringify(replaced)).not.toContain(runId);
    expect(replaced).toMatchObject({
      userEmail: "[redacted]",
      nested: { token: "[redacted]" },
      agentId: FIXTURE_AGENT_ID,
      runId: FIXTURE_RUN_ID,
    });
    expect(redactString(`Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`, [apiKey])).toContain("[redacted]");
    expect(redactString("hello", [apiKey])).toBe("hello");
  });

  it("builds a read-only plan-mode create request and falls back to no-repo on repository_access", async () => {
    expect(buildCreateAgentRequest({ name: "probe", repo: true })).toEqual({
      name: "probe",
      prompt: { text: LIVE_PROMPT },
      autoCreatePR: false,
      mode: "plan",
      repos: [{ url: LIVE_REPOSITORY.url, startingRef: "main" }],
      workOnCurrentBranch: false,
    });
    expect(buildCreateAgentRequest({ name: "x".repeat(120), repo: false }).name).toHaveLength(100);
    expect(buildCreateAgentRequest({ name: "probe", repo: false })).not.toHaveProperty("repos");

    const bodies: unknown[] = [];
    const created = await createLiveAgent("test-key", "probe", async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      const denied = bodies.length === 1;
      const payload = denied
        ? { error: { code: "repository_access", message: "repo is not installed" } }
        : {
          agent: { id: "bc-12345678-1234-1234-1234-123456789abc" },
          run: { id: "run-12345678-1234-1234-1234-123456789abc", status: "CREATING" },
        };
      return jsonResponse(payload, denied ? 403 : 200);
    });
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toHaveProperty("repos");
    expect(bodies[1]).not.toHaveProperty("repos");
    expect(created.noRepo).toBe(true);
    expect(created.agentId).toBe("bc-12345678-1234-1234-1234-123456789abc");
    expect(cursorCloudAuthorization("test-key")).toBe(`Basic ${Buffer.from("test-key:", "utf8").toString("base64")}`);
  });

  it("records 409 agent_busy for a mid-run follow-up and accepts a later follow-up run", async () => {
    expect(buildFollowUpRequest("follow up")).toEqual({ prompt: { text: "follow up" } });
    const busy = await createFollowUpRun("test-key", "bc-1", "steer", async () => (
      jsonResponse({ error: { code: "agent_busy", message: "a run is active" } }, 409)
    ));
    expect(busy).toMatchObject({ accepted: false, status: 409, code: "agent_busy" });
    const accepted = await createFollowUpRun("test-key", "bc-1", "follow up", async (_input, init) => {
      expect(JSON.parse(String(init?.body))).toEqual({ prompt: { text: "follow up" } });
      expect(String(_input)).toBe("https://api.cursor.com/v1/agents/bc-1/runs");
      return jsonResponse({ run: { id: "run-2", agentId: "bc-1", status: "CREATING" } }, 200);
    });
    expect(accepted).toEqual({ accepted: true, status: 200, runId: "run-2", message: "accepted" });
  });

  it("does not create a second agent when authentication fails", async () => {
    let calls = 0;
    const attempt = createLiveAgent("test-key", "probe", async () => {
      calls += 1;
      return jsonResponse({ error: { code: "unauthorized", message: "bad key" } }, 401);
    });
    await expect(attempt).rejects.toBeInstanceOf(CursorCloudApiError);
    await expect(attempt).rejects.toMatchObject({ status: 401, code: "unauthorized" });
    expect(calls).toBe(1);
  });

  it("resumes a dropped stream with Last-Event-ID and does not replay completed frames", async () => {
    const headers: Array<string | null> = [];
    const stream = await collectRunEvents("test-key", { agentId: "bc-1", runId: "run-1" }, {
      sleep: async () => undefined,
      fetchImpl: async (_input, init) => {
        const requestHeaders = new Headers(init?.headers);
        headers.push(requestHeaders.get("Last-Event-ID"));
        expect(requestHeaders.get("Authorization")).toBe(cursorCloudAuthorization("test-key"));
        if (headers.length === 1) {
          return sseResponse([
            `event: status\ndata: ${JSON.stringify({ runId: "run-1", status: "RUNNING" })}\n\n`,
            `id: a-1\nevent: assistant\ndata: ${JSON.stringify({ text: "hello" })}\n\n`,
          ].join(""));
        }
        return sseResponse([
          `id: a-1\nevent: assistant\ndata: ${JSON.stringify({ text: "hello" })}\n\n`,
          `id: r-1\nevent: result\ndata: ${JSON.stringify({ runId: "run-1", status: "FINISHED", text: "hello" })}\n\n`,
          "id: r-1\nevent: done\ndata: {}\n\n",
        ].join(""), { "x-cursor-stream-retention-seconds": "600" });
      },
    });
    expect(headers).toEqual([null, "a-1"]);
    expect(stream.sawDone).toBe(true);
    expect(stream.reconnects).toBe(1);
    expect(stream.retentionSeconds).toBe(600);
    expect(stream.events.map((event) => event.event)).toEqual(["status", "assistant", "result", "done"]);
  });

  it("records stream expiry instead of inventing events from another endpoint", async () => {
    const stream = await collectRunEvents("test-key", { agentId: "bc-1", runId: "run-1" }, {
      sleep: async () => undefined,
      fetchImpl: async () => jsonResponse({ error: { code: "stream_expired", message: "gone" } }, 410),
    });
    expect(stream.streamExpired).toBe(true);
    expect(stream.sawDone).toBe(false);
    expect(stream.events).toEqual([]);
  });

  it("cancels the run and permanently deletes the agent, ignoring an already-finished run", async () => {
    const calls: string[] = [];
    const result = await cleanupLiveAgent("test-key", { agentId: "bc-1", runId: "run-1" }, async (input, init) => {
      calls.push(`${init?.method ?? "GET"} ${String(input)}`);
      const url = String(input);
      const status = url.endsWith("/cancel") ? 409 : 200;
      return jsonResponse({ id: "bc-1" }, status);
    });
    expect(calls.map((call) => call.split(" ")[0])).toEqual(["POST", "DELETE"]);
    expect(calls[0]).toContain("/v1/agents/bc-1/runs/run-1/cancel");
    expect(calls[1]).toBe("DELETE https://api.cursor.com/v1/agents/bc-1");
    expect(result.cancelStatus).toBe(409);
    expect(result.deleteStatus).toBe(200);
    expect(result.errors).toEqual([]);
  });

  it("archives the agent when permanent delete fails", async () => {
    const result = await cleanupLiveAgent("test-key", { agentId: "bc-1", runId: "run-1" }, async (input) => {
      const url = String(input);
      if (url.endsWith("/cancel")) return jsonResponse({ id: "run-1" }, 200);
      if (url.endsWith("/archive")) return jsonResponse({ id: "bc-1" }, 200);
      return jsonResponse({ error: { code: "upstream_error", message: "delete failed" } }, 500);
    });
    expect(result.deleteStatus).toBe(500);
    expect(result.archiveStatus).toBe(200);
    expect(result.errors).toEqual(["HTTP 500 upstream_error: delete failed"]);
  });

  it("accepts the documented stream and rejects an unrecognized or silently dropped event", async () => {
    const documented = await collectText(DOCUMENTED_STREAM);
    const accepted = assessDecodedFrames(decodeAll(documented), true);
    expect(accepted.ok).toBe(true);
    expect(accepted.canonicalTypes).toEqual([
      "turn.started",
      "agent.message_chunk",
      "tool.started",
      "tool.completed",
      "turn.completed",
    ]);
    expect(accepted.vendorNames).toEqual(["git"]);

    const unrecognized = assessDecodedFrames([
      ...decodeAll(documented),
      { raw: { event: "usage", id: "u-1", data: { tokens: 1 } }, events: [] },
    ], true);
    expect(unrecognized.ok).toBe(false);
    expect(unrecognized.failures.join("\n")).toContain("unrecognized SSE event \"usage\"");
    expect(unrecognized.failures.join("\n")).toContain("dropped");

    const silent = assessDecodedFrames([
      { raw: { event: "assistant", data: { text: "hello" } }, events: [] },
      { raw: { event: "heartbeat", data: {} }, events: [] },
      { raw: { event: "done", data: {} }, events: [] },
    ], true);
    expect(silent.failures.join("\n")).toContain("assistant");
    expect(silent.failures.join("\n")).not.toContain("heartbeat");
  });

  it("rejects a follow-up whose events reuse the previous turn", () => {
    const first = decodeAll([{ event: "status", data: { runId: RUN, status: "RUNNING" } }]);
    const second = first.map((frame) => ({
      raw: frame.raw,
      events: frame.events.map((event) => ({ ...event, turn_id: "run-2" })),
    }));
    second[0]?.events[0] && (second[0].events[0] = { ...second[0].events[0], event_id: first[0]?.events[0]?.event_id ?? "" });
    const failures = assessRunBoundaries(SESSION, [
      { label: "initial", turnId: RUN, frames: first },
      { label: "follow-up", turnId: "run-2", frames: second },
    ]);
    expect(failures.join("\n")).toContain("repeated");
    const distinct = assessRunBoundaries(SESSION, [
      { label: "initial", turnId: RUN, frames: first },
      {
        label: "follow-up",
        turnId: "run-2",
        frames: [{
          raw: { event: "status", data: { status: "RUNNING" } },
          events: [{ ...first[0]!.events[0]!, event_id: `status:run-2:RUNNING`, turn_id: "run-2" }],
        }],
      },
    ]);
    expect(distinct).toEqual([]);
  });

  it("keeps the live workflow outside the ordinary CI checks", () => {
    const root = resolve(import.meta.dirname, "../..");
    const ci = readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8");
    const live = readFileSync(resolve(root, ".github/workflows/cursor-cloud-live.yml"), "utf8");
    expect(ci).not.toContain("CURSOR_API_KEY");
    expect(ci).not.toContain("cursor-cloud.live");
    expect(live).toContain("workflow_dispatch:");
    expect(live).toContain("schedule:");
    expect(live).toContain("pull_request:");
    expect(live).toContain("branches: [main]");
    expect(live).toContain("secrets.CURSOR_API_KEY");
    expect(live).toContain("Skipping the live Cloud Agents run.");
  });
});

function decodeAll(events: readonly CursorCloudSseEvent[]) {
  const context = { sessionId: SESSION, turnId: RUN, now: () => NOW };
  return events.map((event) => ({
    raw: event,
    events: decodeCursorCloudRunStreamEvent(event, context),
  }));
}

async function collectText(text: string): Promise<CursorCloudSseEvent[]> {
  const events: CursorCloudSseEvent[] = [];
  for await (const event of readSseEvents(streamFrom(text))) events.push(event);
  return events;
}

function streamFrom(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

function sseResponse(text: string, headers: Record<string, string> = {}): Response {
  return new Response(streamFrom(text), {
    status: 200,
    headers: { "content-type": "text/event-stream", ...headers },
  });
}

function jsonResponse(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
