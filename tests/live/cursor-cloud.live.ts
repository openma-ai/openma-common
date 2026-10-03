/**
 * Live decode of one Cursor Cloud Agents run stream.
 *
 * Runs only when CURSOR_API_KEY is set. CI sets CURSOR_CLOUD_LIVE_SKIP_IF_UNSET=1
 * so a repository that cannot read the organization secret skips instead of failing.
 * The key is never printed. Captured events are anonymized before they touch disk.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  decodeCursorCloudRunStreamEvent,
  type CursorCloudSseEvent,
} from "../../src/protocol/cursor-cloud/index.js";
import { assessDecodedFrames, type DecodedFrame, type LiveAssessment } from "./assess.js";
import {
  cleanupLiveAgent,
  collectRunEvents,
  createLiveAgent,
  CursorCloudApiError,
  type LiveAgent,
} from "./cursor-cloud-api.js";
import { FIXTURE_AGENT_ID, FIXTURE_RUN_ID, redactString, redactValue, replaceLiveIdentifiers, truncateStrings } from "./redact.js";

const LIVE_BUDGET_MS = 10 * 60 * 1000;

const OUT_DIR = resolve(import.meta.dirname, "out");
const STATE_PATH = resolve(OUT_DIR, "active-agent.json");
const apiKey = process.env.CURSOR_API_KEY ?? "";
const skip = apiKey.length === 0 && process.env.CURSOR_CLOUD_LIVE_SKIP_IF_UNSET === "1";

describe("Cursor Cloud live run stream", () => {
  it.skipIf(skip)("decodes a real Cloud Agents SSE stream", async () => {
    if (apiKey.length === 0) {
      throw new Error("CURSOR_API_KEY is required. Set CURSOR_CLOUD_LIVE_SKIP_IF_UNSET=1 to skip when the secret is unavailable.");
    }
    const secrets = [apiKey];
    const captured: CursorCloudSseEvent[] = [];
    const deadlineMs = Date.now() + LIVE_BUDGET_MS;
    let agent: LiveAgent | undefined;
    let wroteSample = false;
    cleanupPromise = undefined;
    const onSignal = () => {
      void ensureCleanup(apiKey, agent, secrets).finally(() => {
        process.exit(1);
      });
    };
    process.on("SIGTERM", onSignal);
    process.on("SIGINT", onSignal);
    let primary: Error | undefined;
    try {
      const name = `openma-live ${process.env.GITHUB_RUN_ID ?? "local"}`.slice(0, 100);
      agent = await createLiveAgent(apiKey, name);
      writeActiveAgent(agent);
      console.log(`created cloud agent repo=${agent.repoUrl ?? "(no-repo)"} noRepo=${agent.noRepo}`);
      const stream = await collectRunEvents(apiKey, agent, {
        deadlineMs,
        onEvent: (event) => {
          captured.push(event);
        },
      });
      const frames = decodeFrames(captured, agent);
      const assessment = assessDecodedFrames(frames, stream.sawDone);
      writeSample(agent, captured, assessment, stream, secrets);
      wroteSample = true;
      console.log(redactString(JSON.stringify({
        eventCount: assessment.eventCount,
        eventNameCounts: assessment.eventNameCounts,
        canonicalTypes: collapse(assessment.canonicalTypes),
        vendorNames: collapse(assessment.vendorNames),
        unrecognized: assessment.unrecognized,
        shapeNotes: assessment.shapeNotes,
        failures: assessment.failures,
        sawDone: stream.sawDone,
        reconnects: stream.reconnects,
        streamExpired: stream.streamExpired,
        retentionSeconds: stream.retentionSeconds,
        noRepo: agent.noRepo,
      }, null, 2), secrets));
      expect(assessment.failures, assessment.failures.join("\n")).toEqual([]);
    } catch (error) {
      if (!wroteSample && captured.length > 0 && agent) {
        writeSample(agent, captured, undefined, undefined, secrets);
      }
      primary = redactError(error, secrets);
    } finally {
      process.off("SIGTERM", onSignal);
      process.off("SIGINT", onSignal);
    }
    const cleanupError = await ensureCleanup(apiKey, agent, secrets);
    if (primary) throw primary;
    if (cleanupError) throw new Error(cleanupError);
  });
});

function collapse(values: readonly string[]): string[] {
  const collapsed: string[] = [];
  for (const value of values) {
    if (collapsed[collapsed.length - 1] !== value) collapsed.push(value);
  }
  return collapsed;
}

function decodeFrames(raw: readonly CursorCloudSseEvent[], agent: LiveAgent): DecodedFrame[] {
  const context = {
    sessionId: agent.agentId,
    turnId: agent.runId,
    now: () => new Date().toISOString(),
  };
  return raw.map((event) => {
    try {
      return { raw: event, events: decodeCursorCloudRunStreamEvent(event, context) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { raw: event, events: [], error: message };
    }
  });
}

function writeSample(
  agent: LiveAgent,
  events: readonly CursorCloudSseEvent[],
  assessment: LiveAssessment | undefined,
  stream: { sawDone: boolean; reconnects: number; streamExpired: boolean; retentionSeconds?: number } | undefined,
  secrets: readonly string[],
): void {
  mkdirSync(OUT_DIR, { recursive: true });
  const anonymized = replaceLiveIdentifiers(
    truncateStrings(redactValue(events, secrets), 8_000),
    agent.agentId,
    agent.runId,
  );
  const payload = {
    source: "https://api.cursor.com/v1/agents/{id}/runs/{runId}/stream",
    anonymized: true,
    placeholders: { agentId: FIXTURE_AGENT_ID, runId: FIXTURE_RUN_ID },
    repoUrl: agent.repoUrl ?? null,
    noRepo: agent.noRepo,
    sawDone: stream?.sawDone ?? false,
    reconnects: stream?.reconnects ?? 0,
    streamExpired: stream?.streamExpired ?? false,
    retentionSeconds: stream?.retentionSeconds ?? null,
    assessment: assessment
      ? {
        eventCount: assessment.eventCount,
        eventNameCounts: assessment.eventNameCounts,
        canonicalTypes: assessment.canonicalTypes,
        vendorNames: assessment.vendorNames,
        unrecognized: assessment.unrecognized,
        shapeNotes: assessment.shapeNotes,
        failures: assessment.failures,
      }
      : null,
    events: anonymized,
  };
  writeFileSync(resolve(OUT_DIR, "events.json"), `${JSON.stringify(payload, null, 2)}\n`);
}

function writeActiveAgent(agent: LiveAgent): void {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(STATE_PATH, `${JSON.stringify({ agentId: agent.agentId, runId: agent.runId })}\n`);
}

let cleanupPromise: Promise<string | undefined> | undefined;

async function ensureCleanup(key: string, agent: LiveAgent | undefined, secrets: readonly string[]): Promise<string | undefined> {
  if (!agent) return undefined;
  cleanupPromise ??= cleanupLiveAgent(key, agent)
    .then((result) => {
      const cleaned = result.deleteStatus === 200 || result.deleteStatus === 404 || result.archiveStatus === 200;
      console.log(redactString(`cleanup cancel=${result.cancelStatus ?? "n/a"} delete=${result.deleteStatus ?? "n/a"} archive=${result.archiveStatus ?? "n/a"} errors=${result.errors.join("; ") || "none"}`, secrets));
      if (cleaned) {
        rmSync(STATE_PATH, { force: true });
        return undefined;
      }
      return redactString(result.errors.join("; ") || `failed to delete cloud agent (HTTP ${result.deleteStatus ?? "none"})`, secrets);
    })
    .catch((error: unknown) => redactString(error instanceof Error ? error.message : String(error), secrets));
  return cleanupPromise;
}

function redactError(error: unknown, secrets: readonly string[]): Error {
  if (error instanceof CursorCloudApiError) {
    return new CursorCloudApiError(error.status, error.code, redactString(error.message, secrets));
  }
  if (error instanceof Error) {
    error.message = redactString(error.message, secrets);
    return error;
  }
  return new Error(redactString(String(error), secrets));
}
