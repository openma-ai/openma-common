import { normalizeSessionEvent } from "../session-events/managed.js";
import { planManagedControlAnswer } from "./control-input-plan.js";
import { ManagedAcpEventProjector } from "./managed-event-projector.js";
const MANAGED_AGENTS_BETA = "managed-agents-2026-04-01";
const DEFAULT_POLL_INTERVAL_MS = 500;
const DEFAULT_MAX_ATTEMPTS = 4;
export class ManagedHarnessHttpError extends Error {
    status;
    name = "ManagedHarnessHttpError";
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}
class AsyncCommandQueue {
    #values = [];
    #pending = null;
    #closed = false;
    #failure;
    push(value) {
        if (this.#pending !== null) {
            const pending = this.#pending;
            this.#pending = null;
            pending.resolve({ done: false, value });
            return;
        }
        this.#values.push(value);
    }
    close() {
        if (this.#closed)
            return;
        this.#closed = true;
        const pending = this.#pending;
        this.#pending = null;
        pending?.resolve({ done: true, value: undefined });
    }
    fail(error) {
        this.#closed = true;
        this.#failure = error;
        const pending = this.#pending;
        this.#pending = null;
        pending?.reject(error);
    }
    [Symbol.asyncIterator]() {
        return {
            next: () => {
                const value = this.#values.shift();
                if (value !== undefined)
                    return Promise.resolve({ done: false, value });
                if (this.#failure !== undefined)
                    return Promise.reject(this.#failure);
                if (this.#closed) {
                    return Promise.resolve({ done: true, value: undefined });
                }
                return new Promise((resolve, reject) => {
                    this.#pending = { resolve, reject };
                });
            },
        };
    }
}
const defaultScheduler = {
    sleep(milliseconds, signal) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                signal.removeEventListener("abort", onAbort);
                resolve();
            }, milliseconds);
            const onAbort = () => {
                clearTimeout(timeout);
                reject(signal.reason);
            };
            signal.addEventListener("abort", onAbort, { once: true });
        });
    },
};
function positiveInteger(value, name) {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new TypeError(`${name} must be a positive integer`);
    }
    return value;
}
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function parseEventPage(value) {
    if (!isRecord(value) || !Array.isArray(value.data)) {
        throw new ManagedHarnessHttpError("Session events response is invalid", null);
    }
    const events = value.data.map((candidate) => {
        if (!isRecord(candidate)
            || typeof candidate.id !== "string"
            || candidate.id.length === 0
            || typeof candidate.type !== "string"
            || (candidate.processed_at !== null && typeof candidate.processed_at !== "string")) {
            throw new ManagedHarnessHttpError("Session event is invalid", null);
        }
        return candidate;
    });
    const nextPage = value.next_page;
    if (nextPage !== null && nextPage !== undefined && typeof nextPage !== "string") {
        throw new ManagedHarnessHttpError("Session events next_page is invalid", null);
    }
    return { data: events, next_page: nextPage ?? null };
}
function contentText(content) {
    if (!Array.isArray(content))
        return "";
    return content.map((candidate) => {
        if (!isRecord(candidate) || typeof candidate.type !== "string")
            return "";
        if (candidate.type === "text" && typeof candidate.text === "string") {
            return candidate.text;
        }
        if (candidate.type === "redacted")
            return "[redacted]";
        if (candidate.type !== "image" && candidate.type !== "document")
            return "";
        const source = isRecord(candidate.source) ? candidate.source : {};
        const reference = typeof source.file_id === "string"
            ? `file: ${source.file_id}`
            : typeof source.url === "string"
                ? `url: ${source.url}`
                : "inline";
        const title = typeof candidate.title === "string" ? ` ${candidate.title}` : "";
        return `[${candidate.type}${title} ${reference}]`;
    }).filter((part) => part.length > 0).join("\n");
}
function eventPrompt(event) {
    switch (event.type) {
        case "user.message":
        case "system.message":
            return contentText(event.content);
        case "user.tool_result":
            return `Tool result for ${String(event.tool_use_id ?? "unknown")}:\n${contentText(event.content)}`;
        case "user.custom_tool_result":
            return `Custom tool result for ${String(event.custom_tool_use_id ?? "unknown")}:\n${contentText(event.content)}`;
        case "session.updated":
            return event.resume === true ? "" : null;
        case "user.define_outcome":
            return `Outcome requested: ${String(event.description ?? "")}`;
        default:
            return null;
    }
}
/** processed_at is acceptance time for outcomes/results/resume, not a receipt.
 * Native source_position is authoritative whenever present. Legacy public
 * histories retain their old timestamp behavior (they cannot prove CAS). */
function inputConsumed(event) {
    if (isRecord(event.source_position)) {
        return typeof event.source_position.consumed_by_execution_id === "string"
            && event.source_position.consumed_by_execution_id.length > 0;
    }
    return event.processed_at !== null;
}
function inputTurnId(event) {
    const execution = isRecord(event.source_position) ? event.source_position.execution_id : undefined;
    return typeof execution === "string" && execution.length > 0 ? execution : event.id;
}
function parkedIdle(event) {
    const normalized = normalizeSessionEvent(event);
    return normalized.kind === "turn_complete"
        && (normalized.stopReason === "requires_action" || normalized.stopReason === "budget_reached");
}
function terminalEvent(event) {
    return event.type === "session.status_terminated" || event.type === "session.deleted";
}
function retryableStatus(status) {
    return status === 408 || status === 429 || status >= 500;
}
function createAuthenticatedRequester(options) {
    const baseUrl = options.apiBaseUrl.replace(/\/+$/u, "");
    if (baseUrl.length === 0 || options.sessionsToken.length === 0) {
        throw new TypeError("apiBaseUrl and sessionsToken are required");
    }
    return async (path, init, signal) => {
        let lastError;
        for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
            signal.throwIfAborted();
            try {
                const response = await options.fetcher(`${baseUrl}${path}`, {
                    ...init,
                    signal,
                    headers: {
                        authorization: `Bearer ${options.sessionsToken}`,
                        "anthropic-beta": MANAGED_AGENTS_BETA,
                        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
                        ...init.headers,
                    },
                });
                if (response.ok)
                    return response;
                const detail = (await response.text().catch(() => "")).slice(0, 500);
                const error = new ManagedHarnessHttpError(`Harness control request failed: ${init.method} ${path} (${response.status})${detail ? `: ${detail}` : ""}`, response.status);
                if (!retryableStatus(response.status) || attempt === options.maxAttempts)
                    throw error;
                lastError = error;
            }
            catch (error) {
                if (signal.aborted)
                    throw signal.reason;
                if (error instanceof ManagedHarnessHttpError && !retryableStatus(error.status ?? 0)) {
                    throw error;
                }
                lastError = error;
                if (attempt === options.maxAttempts)
                    break;
            }
            await options.scheduler.sleep(Math.min(1_000, 25 * 2 ** (attempt - 1)), signal);
        }
        throw lastError instanceof Error
            ? lastError
            : new ManagedHarnessHttpError("Harness control request failed", null);
    };
}
const RECOVERY_EVENT_TYPES = new Set([
    "user.message",
    "agent.message",
    "agent.thread_context_compacted",
    "agent.tool_use",
    "agent.custom_tool_use",
    "agent.mcp_tool_use",
    "agent.tool_result",
    "agent.mcp_tool_result",
    "user.custom_tool_result",
]);
/** Canonical Managed Events are the only semantic fallback when a native ACP
 * checkpoint is unavailable. The reader is paginated and deliberately drops
 * lifecycle/telemetry events rather than synthesizing an agent-native log. */
export function createManagedHarnessHttpRecoveryHistory(options) {
    const fetcher = options.fetch ?? globalThis.fetch;
    if (typeof fetcher !== "function")
        throw new TypeError("A fetch implementation is required");
    const request = createAuthenticatedRequester({
        apiBaseUrl: options.apiBaseUrl,
        sessionsToken: options.sessionsToken,
        fetcher,
        maxAttempts: positiveInteger(options.retry?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, "retry.maxAttempts"),
        scheduler: options.scheduler ?? defaultScheduler,
    });
    const signal = options.signal ?? new AbortController().signal;
    return {
        async list(sessionId) {
            const result = [];
            let page = null;
            do {
                const query = new URLSearchParams({ order: "asc", limit: "100" });
                if (page !== null)
                    query.set("page", page);
                const response = await request(`/v1/sessions/${encodeURIComponent(sessionId)}/events?${query}`, { method: "GET" }, signal);
                const decoded = parseEventPage(await response.json());
                for (const event of decoded.data) {
                    if (RECOVERY_EVENT_TYPES.has(event.type)) {
                        result.push(event);
                    }
                }
                page = decoded.next_page;
            } while (page !== null);
            return result;
        },
    };
}
/** Downloads a concrete Session-attached skill version with the same scoped
 * Work bearer used by the official Environment Worker. Archive extraction is
 * intentionally owned by the sandbox runner, not this transport adapter. */
export function createManagedHarnessHttpSkillSource(options) {
    const fetcher = options.fetch ?? globalThis.fetch;
    if (typeof fetcher !== "function")
        throw new TypeError("A fetch implementation is required");
    const request = createAuthenticatedRequester({
        apiBaseUrl: options.apiBaseUrl,
        sessionsToken: options.sessionsToken,
        fetcher,
        maxAttempts: positiveInteger(options.retry?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, "retry.maxAttempts"),
        scheduler: options.scheduler ?? defaultScheduler,
    });
    const signal = options.signal ?? new AbortController().signal;
    return {
        async download(input) {
            const response = await request(`/v1/skills/${encodeURIComponent(input.skillId)}/versions/${encodeURIComponent(input.version)}/content`, { method: "GET" }, signal);
            return new Uint8Array(await response.arrayBuffer());
        },
    };
}
export function createManagedHarnessHttpControlChannel(options) {
    const fetcher = options.fetch ?? globalThis.fetch;
    if (typeof fetcher !== "function") {
        throw new TypeError("A fetch implementation is required");
    }
    const pollIntervalMs = positiveInteger(options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS, "pollIntervalMs");
    const maxAttempts = positiveInteger(options.retry?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, "retry.maxAttempts");
    const scheduler = options.scheduler ?? defaultScheduler;
    let generatedId = 0;
    const nextEventId = options.eventIds?.next ?? (() => `sevt_${options.scope.workId}_${++generatedId}`);
    const now = options.clock?.now ?? (() => new Date());
    const projector = new ManagedAcpEventProjector({
        nextEventId,
        now,
    });
    const queue = new AsyncCommandQueue();
    const controller = new AbortController();
    const seenEventIds = new Set();
    let latestProcessedAt;
    let nativeCursor = null;
    let activeTurnId = null;
    let pump;
    let consumed = false;
    const continuationInputs = new Set();
    const history = [];
    const answerContext = [];
    const systemContext = [];
    const request = createAuthenticatedRequester({
        apiBaseUrl: options.apiBaseUrl,
        sessionsToken: options.sessionsToken,
        fetcher,
        maxAttempts,
        scheduler,
    });
    const loadSession = async (signal) => {
        const response = await request(`/v1/sessions/${encodeURIComponent(options.scope.sessionId)}`, { method: "GET" }, signal);
        const value = await response.json();
        if (!isRecord(value)
            || value.id !== options.scope.sessionId
            || value.environment_id !== options.scope.environmentId) {
            throw new ManagedHarnessHttpError("Claimed Session does not match the Work scope", response.status);
        }
        return value;
    };
    const loadEvents = async (signal) => {
        const all = [];
        if (options.eventReader) {
            for (;;) {
                const result = await options.eventReader.read({ scope: options.scope, cursor: nativeCursor, limit: 100, signal });
                const decoded = parseEventPage({ data: result.events, next_page: null });
                if ((decoded.data.length > 0 || result.hasMore) && (result.cursor === null || result.cursor === nativeCursor)) {
                    throw new ManagedHarnessHttpError("Native eventReader cursor must advance", null);
                }
                all.push(...decoded.data);
                nativeCursor = result.cursor;
                if (!result.hasMore)
                    return all;
            }
        }
        // Legacy timestamp-only HTTP remains for processed histories. Queued
        // inputs require a native reader; do not pretend mutable time is safe.
        let page = null;
        do {
            const query = new URLSearchParams({ order: "asc", limit: "100" });
            if (page !== null)
                query.set("page", page);
            else if (latestProcessedAt !== undefined) {
                query.set("created_at[gte]", latestProcessedAt);
            }
            const response = await request(`/v1/sessions/${encodeURIComponent(options.scope.sessionId)}/events?${query}`, { method: "GET" }, signal);
            const decoded = parseEventPage(await response.json());
            for (const event of decoded.data) {
                if (event.processed_at === null)
                    throw new ManagedHarnessHttpError("Queued inputs require a stable eventReader", null);
                if (seenEventIds.has(event.id))
                    continue;
                seenEventIds.add(event.id);
                all.push(event);
                if (latestProcessedAt === undefined || event.processed_at > latestProcessedAt) {
                    latestProcessedAt = event.processed_at;
                }
            }
            page = decoded.next_page;
        } while (page !== null);
        return all;
    };
    const enqueueEvent = async (event, replayOnly = false) => {
        const answerPlan = event.type === "user.custom_tool_result" ? planManagedControlAnswer(history, event) : null;
        if (event.type !== "user.tool_confirmation" || replayOnly)
            history.push(event);
        if (replayOnly) {
            if (event.type === "user.message" && inputConsumed(event))
                activeTurnId ??= inputTurnId(event);
            if (event.type === "session.status_idle" && !parkedIdle(event)) {
                activeTurnId = null;
                answerContext.length = 0;
            }
            // Previously consumed partial answers still belong to the continuation.
            if (event.type === "user.custom_tool_result" && answerPlan === "partial") {
                answerContext.push(eventPrompt(event));
            }
            return false;
        }
        if (terminalEvent(event)) {
            queue.push({ type: "session.dispose", sessionId: options.scope.sessionId });
            queue.push({ type: "control.complete", workId: options.scope.workId });
            queue.close();
            return true;
        }
        if (event.type === "session.status_idle") {
            if (!parkedIdle(event)) {
                activeTurnId = null;
                answerContext.length = 0;
            }
            return false;
        }
        if (event.type === "user.interrupt") {
            if (activeTurnId !== null) {
                queue.push({
                    type: "session.cancel",
                    sessionId: options.scope.sessionId,
                    turnId: activeTurnId,
                });
                // A user.message immediately following an interrupt is the next turn,
                // not a soft steer into the turn being cancelled.
                activeTurnId = null;
            }
            return false;
        }
        if (isRecord(event.source_position) && inputConsumed(event)) {
            if (event.type === "user.message")
                activeTurnId ??= inputTurnId(event);
            return false;
        }
        if (event.type === "user.tool_confirmation") {
            const result = await options.onToolConfirmation?.({ scope: options.scope, event, activeTurnId, signal: controller.signal });
            if (result === "answered")
                history.push(event);
            return false;
        }
        let text = eventPrompt(event);
        // Canonical native feeds attach source metadata; legacy public transport
        // remains compatible until its consumers opt into the private reader.
        if (event.type === "system.message" && isRecord(event.source_position)) {
            if (text)
                systemContext.push(text);
            return false;
        }
        if (event.type === "user.custom_tool_result") {
            const plan = answerPlan;
            if (plan !== "release") {
                await options.onInputSettled?.({ scope: options.scope, input: { eventId: event.id, event }, turnId: inputTurnId(event), reason: plan, signal: controller.signal });
                if (plan === "partial" && text !== null)
                    answerContext.push(text);
                return false;
            }
            text = [...answerContext, text].filter(part => part !== null).join("\n\n");
            answerContext.length = 0;
        }
        if (text !== null) {
            if (systemContext.length > 0) {
                text = [...systemContext, text].join("\n\n");
                systemContext.length = 0;
            }
            const input = { eventId: event.id, event };
            if (event.type === "user.define_outcome")
                input.outcome = {
                    id: typeof event.outcome_id === "string" ? event.outcome_id : `outcome_${event.id}`,
                    description: String(event.description ?? ""), rubric: event.rubric,
                    maxIterations: event.max_iterations === undefined ? null : event.max_iterations,
                };
            if (event.type === "user.message" && activeTurnId !== null) {
                queue.push({
                    type: "session.steer",
                    sessionId: options.scope.sessionId,
                    eventId: inputTurnId(event),
                    text,
                    input,
                });
                return false;
            }
            activeTurnId = inputTurnId(event);
            queue.push({
                type: "session.prompt",
                sessionId: options.scope.sessionId,
                turnId: inputTurnId(event),
                text,
                input,
            });
        }
        return false;
    };
    const runPump = async (signal) => {
        const session = await loadSession(signal);
        if (session.archived_at != null || session.status === "terminated") {
            queue.push({ type: "control.complete", workId: options.scope.workId });
            queue.close();
            return;
        }
        await options.onSessionLoaded?.(session);
        const initial = await loadEvents(signal);
        let start = 0;
        let latestInputId;
        let canonicalCompletedTurnId;
        for (let index = 0; index < initial.length; index += 1) {
            const event = initial[index];
            if (event.type !== "system.message" && eventPrompt(event) !== null && inputConsumed(event))
                latestInputId = inputTurnId(event);
            if (event.type === "session.status_idle") {
                start = index + 1;
                if (!parkedIdle(event))
                    canonicalCompletedTurnId = latestInputId;
            }
        }
        queue.push({
            type: "session.start",
            sessionId: options.scope.sessionId,
            agentId: options.harness.id,
            runtime: "cloud",
            cwd: options.workspacePath,
            ...(canonicalCompletedTurnId === undefined
                ? {}
                : { canonicalCompletedTurnId }),
        });
        const pending = [];
        for (const event of initial.slice(0, start)) {
            if (!inputConsumed(event) && (eventPrompt(event) !== null || event.type === "user.tool_confirmation"))
                pending.push(event);
            else
                await enqueueEvent(event, true);
        }
        for (const event of [...pending, ...initial.slice(start)]) {
            if (await enqueueEvent(event))
                return;
        }
        while (!signal.aborted) {
            await scheduler.sleep(pollIntervalMs, signal);
            for (const event of await loadEvents(signal)) {
                if (await enqueueEvent(event))
                    return;
            }
        }
    };
    const startPump = (externalSignal) => {
        const abort = () => controller.abort(externalSignal.reason);
        if (externalSignal.aborted)
            abort();
        else
            externalSignal.addEventListener("abort", abort, { once: true });
        pump = runPump(controller.signal).then(() => queue.close(), (error) => {
            if (controller.signal.aborted)
                queue.close();
            else
                queue.fail(error);
        }).finally(() => externalSignal.removeEventListener("abort", abort));
    };
    return {
        ...(options.onBeforeDispatch ? { async beforeDispatch(command, signal, kind = "prompt") {
                if (!command.input)
                    throw new Error("Canonical input context is required");
                await options.onBeforeDispatch({ scope: options.scope, command, input: command.input, signal, kind });
                // Steering may inject into the existing prompt, so admission alone
                // must not open a new turn/span. A confirmed prompt fallback calls
                // this gate again with kind="prompt" before native dispatch.
                if (options.publishTurnStartBeforeDispatch && kind === "prompt" && !continuationInputs.has(command.turnId)) {
                    signal.throwIfAborted();
                    const events = projector.startTurn(command.turnId);
                    if (events.length > 0)
                        await request(`/v1/oma/sessions/${encodeURIComponent(options.scope.sessionId)}/runtime-events`, { method: "POST", body: JSON.stringify({ events }) }, signal);
                    signal.throwIfAborted();
                }
            } } : {}),
        ...(options.onFallbackOwner ? { async fallbackOwner(command, signal) {
                const owner = await options.onFallbackOwner({ command, signal });
                if (owner !== null)
                    continuationInputs.add(command.turnId);
                return owner;
            } } : {}),
        ...(options.onConsumed ? { async onConsumed(command, acceptance) {
                if (!command.input)
                    throw new Error("Canonical input context is required");
                await options.onConsumed({ scope: options.scope, command, input: command.input, acceptance });
            } } : {}),
        commands(signal) {
            if (consumed)
                throw new Error("Harness control commands may only be consumed once");
            consumed = true;
            startPump(signal);
            return queue;
        },
        async publish(event) {
            if (event.sessionId !== options.scope.sessionId) {
                throw new Error(`Harness output attempted cross-session publication ${event.sessionId}`);
            }
            const events = event.type === "session.warning"
                ? [{
                        id: nextEventId(),
                        type: event.type,
                        processed_at: now().toISOString(),
                        source: event.source,
                        message: event.message,
                        details: event.details,
                    }]
                : projector.project(event);
            if (events.length === 0)
                return;
            await request(`/v1/oma/sessions/${encodeURIComponent(options.scope.sessionId)}/runtime-events`, { method: "POST", body: JSON.stringify({ events }) }, controller.signal);
            if (event.type === "session.complete" || event.type === "session.error") {
                activeTurnId = null;
            }
        },
        async close() {
            controller.abort(new Error("Harness HTTP control channel closed"));
            queue.close();
            await pump;
        },
    };
}
//# sourceMappingURL=http-control.js.map