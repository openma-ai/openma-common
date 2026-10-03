/**
 * Live decode of a Cursor Cloud Agents run, a mid-run follow-up attempt,
 * and the follow-up run that starts after the first one finishes.
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
import { assessDecodedFrames, assessRunBoundaries, userMessageTexts, type DecodedFrame, type LiveAssessment } from "./assess.js";
import {
  cleanupLiveAgent,
  collectRunEvents,
  createFollowUpRun,
  createLiveAgent,
  CursorCloudApiError,
  FOLLOW_UP_PROMPT,
  LIVE_PROMPT,
  STEER_PROMPT,
  type CollectedRunStream,
  type FollowUpResult,
  type LiveAgent,
} from "./cursor-cloud-api.js";
import {
  FIXTURE_AGENT_ID,
  FIXTURE_RUN_ID,
  FIXTURE_RUN_ID_2,
  redactString,
  redactValue,
  replaceIdentifiers,
  truncateStrings,
} from "./redact.js";

const LIVE_BUDGET_MS = 10 * 60 * 1000;

const OUT_DIR = resolve(import.meta.dirname, "out");
const STATE_PATH = resolve(OUT_DIR, "active-agent.json");
const apiKey = process.env.CURSOR_API_KEY ?? "";
const skip = apiKey.length === 0 && process.env.CURSOR_CLOUD_LIVE_SKIP_IF_UNSET === "1";

describe("Cursor Cloud live run stream", () => {
  it.skipIf(skip)("decodes an initial run, a mid-run follow-up attempt, and a completed follow-up", async () => {
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
    let steer: FollowUpResult | undefined;
    let followUp: FollowUpResult | undefined;
    let steerPromise: Promise<FollowUpResult> | undefined;
    let steerWhileStreamOpen = false;
    const rounds: LiveRound[] = [];
    try {
      const name = `openma-live ${process.env.GITHUB_RUN_ID ?? "local"}`.slice(0, 100);
      agent = await createLiveAgent(apiKey, name);
      writeActiveAgent(agent);
      console.log(`created cloud agent repo=${agent.repoUrl ?? "(no-repo)"} noRepo=${agent.noRepo}`);
      // Create A Run is the only documented way to send more text. The
      // OpenAPI schema has no steer endpoint, and the TypeScript SDK says
      // cloud run.steer always returns revert_to_followup. Send the short
      // follow-up only after status RUNNING, while this run is still open.
      const initialStream = await collectRunEvents(apiKey, agent, {
        deadlineMs,
        onEvent: (event) => {
          captured.push(event);
          if (steerPromise || event.event === "result" || event.event === "done") return;
          if (event.event === "status" && runStatus(event) === "RUNNING") {
            steerPromise = createFollowUpRun(apiKey, agent!.agentId, STEER_PROMPT, fetch, budgetSignal(deadlineMs)).then((result) => {
              steerWhileStreamOpen = !captured.some((item) => item.event === "done" || item.event === "result");
              return result;
            });
            // The stream is still being read. A rejection here must not be unhandled.
            void steerPromise.catch(() => undefined);
          }
        },
      });
      if (!steerPromise) {
        throw new Error("initial run ended before status RUNNING, so the mid-run follow-up was not sent");
      }
      steer = await steerPromise;
      const initial = finishRound("initial", agent.runId, LIVE_PROMPT, captured, initialStream, agent);
      rounds.push(initial);
      console.log(redactString(JSON.stringify({
        steer: { accepted: steer.accepted, status: steer.status, code: steer.code ?? null },
        initial: summarizeRound(initial),
      }, null, 2), secrets));

      const second = await streamFollowUp(apiKey, agent, steer, deadlineMs, secrets);
      followUp = second.followUp;
      if (second.round) rounds.push(second.round);
      writeRounds(agent, rounds, steer, followUp, secrets);
      wroteSample = true;
      const failures = [
        ...rounds.flatMap((round) => round.assessment?.failures ?? [`${round.label} was not assessed`]),
        ...boundaryFailures(agent, rounds),
        ...steerFailures(steer, rounds, steerWhileStreamOpen),
      ];
      console.log(redactString(JSON.stringify({
        steer: { accepted: steer.accepted, status: steer.status, code: steer.code ?? null },
        followUp: followUp
          ? { accepted: followUp.accepted, status: followUp.status, code: followUp.code ?? null }
          : null,
        rounds: rounds.map(summarizeRound),
        failures,
      }, null, 2), secrets));
      expect(failures, failures.join("\n")).toEqual([]);
    } catch (error) {
      if (!steer && steerPromise) await steerPromise.catch(() => undefined);
      if (!wroteSample && agent && (captured.length > 0 || rounds.length > 0)) {
        if (rounds.length === 0 && captured.length > 0) {
          rounds.push({
            label: "initial",
            runId: agent.runId,
            prompt: LIVE_PROMPT,
            events: captured,
            stream: undefined,
            frames: undefined,
            assessment: undefined,
          });
        }
        writeRounds(agent, rounds, steer, followUp, secrets);
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

interface LiveRound {
  label: string;
  runId: string;
  prompt: string;
  events: CursorCloudSseEvent[];
  stream: Pick<CollectedRunStream, "sawDone" | "reconnects" | "streamExpired" | "retentionSeconds"> | undefined;
  frames: DecodedFrame[] | undefined;
  assessment: LiveAssessment | undefined;
}

function finishRound(
  label: string,
  runId: string,
  prompt: string,
  events: readonly CursorCloudSseEvent[],
  stream: CollectedRunStream,
  agent: LiveAgent,
): LiveRound {
  const frames = decodeFrames(events, agent.agentId, runId);
  return {
    label,
    runId,
    prompt,
    events: [...events],
    stream,
    frames,
    assessment: assessDecodedFrames(frames, stream.sawDone),
  };
}

async function streamFollowUp(
  apiKey: string,
  agent: LiveAgent,
  steer: FollowUpResult,
  deadlineMs: number,
  secrets: readonly string[],
): Promise<{ followUp: FollowUpResult; round: LiveRound | undefined }> {
  let followUp = steer;
  let prompt = STEER_PROMPT;
  if (!steer.accepted) {
    if (steer.status !== 409 || steer.code !== "agent_busy") {
      throw new Error(`mid-run follow-up returned HTTP ${steer.status} ${steer.code ?? ""}`.trim());
    }
    followUp = await createFollowUpRun(apiKey, agent.agentId, FOLLOW_UP_PROMPT, fetch, budgetSignal(deadlineMs));
    prompt = FOLLOW_UP_PROMPT;
  }
  if (!followUp.accepted || !followUp.runId) {
    throw new Error(`follow-up was not accepted: HTTP ${followUp.status} ${followUp.code ?? ""} ${followUp.message}`);
  }
  if (followUp.runId === agent.runId) {
    throw new Error("follow-up run id matched the initial run id");
  }
  agent.runId = followUp.runId;
  writeActiveAgent(agent);
  const events: CursorCloudSseEvent[] = [];
  const stream = await collectRunEvents(apiKey, agent, {
    deadlineMs,
    onEvent: (event) => {
      events.push(event);
    },
  });
  const round = finishRound(steer.accepted ? "mid-run-accepted" : "follow-up", followUp.runId, prompt, events, stream, agent);
  console.log(redactString(JSON.stringify(summarizeRound(round), null, 2), secrets));
  return { followUp, round };
}

function boundaryFailures(agent: LiveAgent, rounds: readonly LiveRound[]): string[] {
  return assessRunBoundaries(agent.agentId, rounds.flatMap((round) => (
    round.frames ? [{ label: round.label, turnId: round.runId, frames: round.frames }] : []
  )));
}

function steerFailures(steer: FollowUpResult, rounds: readonly LiveRound[], whileStreamOpen: boolean): string[] {
  const failures: string[] = [];
  const initial = rounds.find((round) => round.label === "initial");
  const second = rounds.find((round) => round.label !== "initial");
  if (!initial?.frames || !second?.frames) return ["missing initial or follow-up round"];
  const initialText = userMessageTexts(initial.frames).join("\n");
  const secondText = userMessageTexts(second.frames);
  if (steer.status === 409 && steer.code === "agent_busy") {
    if (initialText.includes(STEER_PROMPT)) {
      failures.push("rejected mid-run prompt was still appended to the initial run");
    }
    if (secondText.length > 0 && !secondText.includes(FOLLOW_UP_PROMPT)) {
      failures.push("follow-up run did not decode the follow-up prompt as user.message");
    }
  } else if (steer.accepted) {
    if (!whileStreamOpen) {
      failures.push("mid-run follow-up was accepted only after the initial run stream had already finished");
    }
    const steeredInInitial = initialText.includes(STEER_PROMPT);
    const steeredInSecond = secondText.includes(STEER_PROMPT);
    if (!steeredInInitial && !steeredInSecond) {
      failures.push("accepted mid-run prompt was not decoded as user.message on either run");
    }
  } else {
    failures.push(`unexpected mid-run follow-up result HTTP ${steer.status} ${steer.code ?? ""}`);
  }
  if (secondText.includes(LIVE_PROMPT)) {
    failures.push("follow-up run repeated the initial user prompt");
  }
  return failures;
}

function summarizeRound(round: LiveRound): Record<string, unknown> {
  return {
    label: round.label,
    eventCount: round.assessment?.eventCount ?? round.events.length,
    eventNameCounts: round.assessment?.eventNameCounts ?? {},
    canonicalTypes: collapse(round.assessment?.canonicalTypes ?? []),
    vendorNames: collapse(round.assessment?.vendorNames ?? []),
    unrecognized: round.assessment?.unrecognized ?? [],
    shapeNotes: round.assessment?.shapeNotes ?? [],
    failures: round.assessment?.failures ?? [],
    sawDone: round.stream?.sawDone ?? false,
    reconnects: round.stream?.reconnects ?? 0,
    streamExpired: round.stream?.streamExpired ?? false,
    retentionSeconds: round.stream?.retentionSeconds ?? null,
  };
}

function runStatus(event: CursorCloudSseEvent): string {
  const data = event.data;
  if (typeof data !== "object" || data === null || Array.isArray(data) || !("status" in data)) return "";
  return typeof data.status === "string" ? data.status : "";
}

function collapse(values: readonly string[]): string[] {
  const collapsed: string[] = [];
  for (const value of values) {
    if (collapsed[collapsed.length - 1] !== value) collapsed.push(value);
  }
  return collapsed;
}

function decodeFrames(raw: readonly CursorCloudSseEvent[], sessionId: string, turnId: string): DecodedFrame[] {
  const context = { sessionId, turnId, now: () => new Date().toISOString() };
  return raw.map((event) => {
    try {
      return { raw: event, events: decodeCursorCloudRunStreamEvent(event, context) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { raw: event, events: [], error: message };
    }
  });
}

function writeRounds(
  agent: LiveAgent,
  rounds: readonly LiveRound[],
  steer: FollowUpResult | undefined,
  followUp: FollowUpResult | undefined,
  secrets: readonly string[],
): void {
  mkdirSync(OUT_DIR, { recursive: true });
  const runIds = rounds.map((round) => round.runId);
  const replacements: Record<string, string> = {
    [`https://cursor.com/agents/${agent.agentId}`]: `https://cursor.com/agents/${FIXTURE_AGENT_ID}`,
    [agent.agentId]: FIXTURE_AGENT_ID,
  };
  if (runIds[0]) replacements[runIds[0]] = FIXTURE_RUN_ID;
  if (runIds[1]) replacements[runIds[1]] = FIXTURE_RUN_ID_2;
  const payload = replaceIdentifiers(truncateStrings(redactValue({
    source: "https://api.cursor.com/v1/agents/{id}/runs/{runId}/stream",
    anonymized: true,
    placeholders: { agentId: FIXTURE_AGENT_ID, initialRunId: FIXTURE_RUN_ID, followUpRunId: FIXTURE_RUN_ID_2 },
    repoUrl: agent.repoUrl ?? null,
    noRepo: agent.noRepo,
    steer: steer
      ? {
        endpoint: "POST /v1/agents/{id}/runs",
        sentWhile: "initial run CREATING or RUNNING",
        accepted: steer.accepted,
        httpStatus: steer.status,
        code: steer.code ?? null,
      }
      : null,
    followUp: followUp && followUp !== steer
      ? {
        endpoint: "POST /v1/agents/{id}/runs",
        sentWhile: "after initial run completed",
        accepted: followUp.accepted,
        httpStatus: followUp.status,
        code: followUp.code ?? null,
      }
      : null,
    runs: rounds.map((round, index) => ({
      label: round.label,
      runId: index === 0 ? FIXTURE_RUN_ID : FIXTURE_RUN_ID_2,
      prompt: round.prompt,
      sawDone: round.stream?.sawDone ?? false,
      reconnects: round.stream?.reconnects ?? 0,
      streamExpired: round.stream?.streamExpired ?? false,
      retentionSeconds: round.stream?.retentionSeconds ?? null,
      assessment: round.assessment
        ? {
          eventCount: round.assessment.eventCount,
          eventNameCounts: round.assessment.eventNameCounts,
          canonicalTypes: round.assessment.canonicalTypes,
          vendorNames: round.assessment.vendorNames,
          unrecognized: round.assessment.unrecognized,
          shapeNotes: round.assessment.shapeNotes,
          failures: round.assessment.failures,
        }
        : null,
      events: round.events,
    })),
  }, secrets), 8_000), replacements);
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

function budgetSignal(deadlineMs: number): AbortSignal {
  return AbortSignal.timeout(Math.max(30_000, deadlineMs - Date.now()));
}

function redactError(error: unknown, secrets: readonly string[]): Error {
  const message = redactString(error instanceof Error ? error.message : String(error), secrets);
  if (error instanceof CursorCloudApiError) {
    return new CursorCloudApiError(error.status, error.code, message);
  }
  return new Error(message);
}
