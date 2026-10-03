/**
 * Minimal client for the Cloud Agents API v1 calls this live test needs.
 *
 * Source of truth: https://cursor.com/docs/cloud-agent/api/endpoints
 * and https://cursor.com/docs-static/cloud-agents-openapi.yaml.
 * Authentication is HTTP Basic with the API key as the username and an
 * empty password (`curl -u "$CURSOR_API_KEY:"`).
 */
import type { CursorCloudSseEvent } from "../../src/protocol/cursor-cloud/index.js";
import { readSseEvents } from "./parse-sse.js";

export const CURSOR_CLOUD_API_ORIGIN = "https://api.cursor.com";

/**
 * Slightly longer than the other prompts so the run is still active when the
 * mid-run follow-up is sent. Still read-only: one file read, no edits.
 */
export const LIVE_PROMPT = "读 README.md 的第一行。不要改文件。";

/** Sent with Create A Run only after the initial run has reported RUNNING. */
export const STEER_PROMPT = "只回复 ok";

/** Sent with Create A Run after the initial run has finished. */
export const FOLLOW_UP_PROMPT = "只回复 ok";

/** Public repository. Used only when the key's GitHub installation can see it. */
export const LIVE_REPOSITORY = {
  url: "https://github.com/openma-ai/openma-common",
  startingRef: "main",
} as const;

const LIVE_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_RECONNECTS = 5;

export class CursorCloudApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, code: string | undefined, message: string) {
    super(message);
    this.name = "CursorCloudApiError";
    this.status = status;
    this.code = code;
  }
}

export function cursorCloudAuthorization(apiKey: string): string {
  return `Basic ${Buffer.from(`${apiKey}:`, "utf8").toString("base64")}`;
}

export function buildCreateAgentRequest(input: { name: string; repo: boolean }): Record<string, unknown> {
  return {
    name: input.name.slice(0, 100),
    prompt: { text: LIVE_PROMPT },
    autoCreatePR: false,
    mode: "plan",
    ...(input.repo
      ? {
        repos: [{ url: LIVE_REPOSITORY.url, startingRef: LIVE_REPOSITORY.startingRef }],
        workOnCurrentBranch: false,
      }
      : {}),
  };
}

export interface LiveAgent {
  agentId: string;
  runId: string;
  /** Set when the create call targeted LIVE_REPOSITORY. */
  repoUrl?: string;
  noRepo: boolean;
}

export interface CollectedRunStream {
  events: CursorCloudSseEvent[];
  sawDone: boolean;
  reconnects: number;
  streamExpired: boolean;
  retentionSeconds?: number;
}

type FetchLike = typeof fetch;

export function buildFollowUpRequest(text: string): { prompt: { text: string } } {
  return { prompt: { text } };
}

export interface FollowUpResult {
  accepted: boolean;
  status: number;
  code?: string;
  runId?: string;
  message: string;
}

/**
 * `POST /v1/agents/{id}/runs`. A follow-up while the agent has a CREATING
 * or RUNNING run returns 409 `agent_busy`. That response is returned, not
 * thrown. The Cloud Agents OpenAPI schema has no steer endpoint.
 */
export async function createFollowUpRun(
  apiKey: string,
  agentId: string,
  text: string,
  fetchImpl: FetchLike = fetch,
): Promise<FollowUpResult> {
  const response = await fetchImpl(`${CURSOR_CLOUD_API_ORIGIN}/v1/agents/${encodeURIComponent(agentId)}/runs`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: cursorCloudAuthorization(apiKey),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildFollowUpRequest(text)),
    signal: AbortSignal.timeout(120_000),
  });
  const payload = await readJson(response);
  if (!response.ok) {
    const error = errorFromPayload(response.status, payload);
    return { accepted: false, status: error.status, code: error.code, message: error.message };
  }
  const body = record(payload);
  const run = record(body?.run);
  const runId = typeof run?.id === "string" ? run.id : undefined;
  if (!runId) {
    throw new CursorCloudApiError(response.status, "validation_error", "follow-up response did not include run.id");
  }
  return { accepted: true, status: response.status, runId, message: "accepted" };
}

export async function createLiveAgent(apiKey: string, name: string, fetchImpl: FetchLike = fetch): Promise<LiveAgent> {
  try {
    const created = await postAgent(apiKey, buildCreateAgentRequest({ name, repo: true }), fetchImpl);
    return { ...created, repoUrl: LIVE_REPOSITORY.url, noRepo: false };
  } catch (error) {
    if (!isRepoUnavailable(error)) throw error;
    const created = await postAgent(apiKey, buildCreateAgentRequest({ name, repo: false }), fetchImpl);
    return { ...created, noRepo: true };
  }
}

export interface CollectRunEventsOptions {
  deadlineMs?: number;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  onEvent?: (event: CursorCloudSseEvent) => void;
}

export async function collectRunEvents(
  apiKey: string,
  agent: Pick<LiveAgent, "agentId" | "runId">,
  options: CollectRunEventsOptions = {},
): Promise<CollectedRunStream> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? delay;
  const deadlineMs = options.deadlineMs ?? Date.now() + LIVE_TIMEOUT_MS;
  const events: CursorCloudSseEvent[] = [];
  const seen = new Set<string>();
  let lastEventId: string | undefined;
  let sawDone = false;
  let reconnects = 0;
  let streamExpired = false;
  let retentionSeconds: number | undefined;
  let lastRetryable = 0;
  let lastStreamError: CursorCloudApiError | undefined;

  for (let attempt = 0; !sawDone && attempt <= MAX_RECONNECTS; attempt += 1) {
    if (Date.now() > deadlineMs) {
      throw new CursorCloudApiError(0, "live_timeout", `live run exceeded ${LIVE_TIMEOUT_MS}ms before the stream finished`);
    }
    if (attempt > 0) {
      reconnects += 1;
      await sleep(Math.min(8_000, 500 * 2 ** (attempt - 1)));
    }
    const remaining = Math.max(1_000, deadlineMs - Date.now());
    const response = await fetchImpl(
      `${CURSOR_CLOUD_API_ORIGIN}/v1/agents/${encodeURIComponent(agent.agentId)}/runs/${encodeURIComponent(agent.runId)}/stream`,
      {
        method: "GET",
        headers: {
          Accept: "text/event-stream",
          Authorization: cursorCloudAuthorization(apiKey),
          ...(lastEventId ? { "Last-Event-ID": lastEventId } : {}),
        },
        signal: AbortSignal.timeout(remaining),
      },
    );
    const retention = response.headers.get("x-cursor-stream-retention-seconds");
    if (retention && Number.isFinite(Number(retention))) retentionSeconds = Number(retention);

    if (response.status === 410) {
      await drain(response);
      streamExpired = true;
      break;
    }
    if (response.status === 429 || response.status === 503) {
      await drain(response);
      lastRetryable = response.status;
      continue;
    }
    if (response.status === 409) {
      // A live run returned 409 stream_unavailable while the run was still
      // active. Retry; a persistent 409 is reported below.
      const unavailable = await errorFromResponse(response);
      if (unavailable.code === "stream_unavailable") {
        lastStreamError = unavailable;
        lastRetryable = 409;
        continue;
      }
      throw unavailable;
    }
    if (!response.ok) throw await errorFromResponse(response);
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) throw await errorFromResponse(response);
    if (!response.body) {
      throw new CursorCloudApiError(response.status, "stream_unavailable", "run stream response had no body");
    }

    let resumeAfterUnavailable = false;
    try {
      for await (const event of readSseEvents(response.body)) {
        if (Date.now() > deadlineMs) {
          throw new CursorCloudApiError(0, "live_timeout", `live run exceeded ${LIVE_TIMEOUT_MS}ms before the stream finished`);
        }
        if (event.id) lastEventId = event.id;
        const key = `${event.event}\u0000${event.id ?? ""}\u0000${JSON.stringify(event.data)}`;
        if (attempt > 0 && seen.has(key)) continue;
        seen.add(key);
        events.push(event);
        options.onEvent?.(event);
        if (event.event === "error" && record(event.data)?.code === "stream_unavailable") {
          resumeAfterUnavailable = true;
        } else if (event.event === "result") {
          resumeAfterUnavailable = false;
        }
        if (event.event === "done") {
          if (resumeAfterUnavailable) break;
          sawDone = true;
          break;
        }
      }
    } catch (error) {
      if (error instanceof CursorCloudApiError) throw error;
      if (sawDone) break;
    }
  }

  if (!sawDone && !streamExpired && events.length === 0 && lastStreamError) throw lastStreamError;
  if (!sawDone && !streamExpired && events.length === 0 && lastRetryable !== 0) {
    const code = lastRetryable === 429 ? "rate_limit_exceeded" : "upstream_error";
    throw new CursorCloudApiError(lastRetryable, code, `run stream failed with HTTP ${lastRetryable}`);
  }

  return { events, sawDone, reconnects, streamExpired, retentionSeconds };
}

export interface CleanupResult {
  cancelStatus?: number;
  deleteStatus?: number;
  archiveStatus?: number;
  errors: string[];
}

export async function cleanupLiveAgent(
  apiKey: string,
  agent: { agentId: string; runId?: string },
  fetchImpl: FetchLike = fetch,
): Promise<CleanupResult> {
  const errors: string[] = [];
  let cancelStatus: number | undefined;
  let deleteStatus: number | undefined;
  let archiveStatus: number | undefined;

  if (agent.runId) {
    try {
      cancelStatus = await send(apiKey, "POST", `/v1/agents/${encodeURIComponent(agent.agentId)}/runs/${encodeURIComponent(agent.runId)}/cancel`, fetchImpl);
    } catch (error) {
      const status = error instanceof CursorCloudApiError ? error.status : 0;
      cancelStatus = status || undefined;
      // 409 run_not_cancellable and 404 are expected once the run has finished.
      if (status !== 404 && status !== 409) errors.push(errorMessage(error));
    }
  }

  try {
    deleteStatus = await send(apiKey, "DELETE", `/v1/agents/${encodeURIComponent(agent.agentId)}`, fetchImpl);
  } catch (error) {
    const status = error instanceof CursorCloudApiError ? error.status : 0;
    deleteStatus = status || undefined;
    if (status !== 404) {
      errors.push(errorMessage(error));
      try {
        archiveStatus = await send(apiKey, "POST", `/v1/agents/${encodeURIComponent(agent.agentId)}/archive`, fetchImpl);
      } catch (archiveError) {
        const archive = archiveError instanceof CursorCloudApiError ? archiveError.status : 0;
        archiveStatus = archive || undefined;
        if (archive !== 404) errors.push(errorMessage(archiveError));
      }
    }
  }

  return { cancelStatus, deleteStatus, archiveStatus, errors };
}

async function postAgent(apiKey: string, body: Record<string, unknown>, fetchImpl: FetchLike): Promise<{ agentId: string; runId: string }> {
  const response = await fetchImpl(`${CURSOR_CLOUD_API_ORIGIN}/v1/agents`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: cursorCloudAuthorization(apiKey),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const payload = await readJson(response);
  if (!response.ok) throw errorFromPayload(response.status, payload);
  const created = readCreatedAgent(payload);
  if (!created) {
    throw new CursorCloudApiError(response.status, "validation_error", "create agent response did not include agent.id and run.id");
  }
  return created;
}

async function send(apiKey: string, method: string, path: string, fetchImpl: FetchLike): Promise<number> {
  const response = await fetchImpl(`${CURSOR_CLOUD_API_ORIGIN}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      Authorization: cursorCloudAuthorization(apiKey),
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw await errorFromResponse(response);
  return response.status;
}

function readCreatedAgent(payload: unknown): { agentId: string; runId: string } | undefined {
  const body = record(payload);
  const agent = record(body?.agent);
  const run = record(body?.run);
  const agentId = typeof agent?.id === "string" ? agent.id : undefined;
  const runId = typeof run?.id === "string"
    ? run.id
    : typeof agent?.latestRunId === "string" ? agent.latestRunId : undefined;
  if (!agentId || !runId) return undefined;
  return { agentId, runId };
}

function isRepoUnavailable(error: unknown): boolean {
  return error instanceof CursorCloudApiError
    && (error.code === "repository_access" || error.code === "integration_not_connected");
}

async function errorFromResponse(response: Response): Promise<CursorCloudApiError> {
  return errorFromPayload(response.status, await readJson(response));
}

function errorFromPayload(status: number, payload: unknown): CursorCloudApiError {
  const body = record(payload);
  const nested = record(body?.error);
  const code = typeof nested?.code === "string" ? nested.code : undefined;
  const message = typeof nested?.message === "string"
    ? nested.message
    : typeof body?.message === "string"
      ? body.message
      : `Cursor Cloud API request failed with HTTP ${status}`;
  return new CursorCloudApiError(status, code, `HTTP ${status}${code ? ` ${code}` : ""}: ${message}`);
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text.slice(0, 500) };
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function drain(response: Response): Promise<void> {
  await response.text().catch(() => undefined);
}
