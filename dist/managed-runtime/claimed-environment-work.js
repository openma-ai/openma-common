export class ClaimedEnvironmentWorkLeaseLostError extends Error {
    name = "ClaimedEnvironmentWorkLeaseLostError";
}
const defaultScheduler = {
    sleep(milliseconds, signal) {
        signal.throwIfAborted();
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
        throw new RangeError(`${name} must be a positive integer`);
    }
    return value;
}
function nonEmpty(value, name) {
    if (value.trim() === "")
        throw new TypeError(`${name} must not be empty`);
    return value;
}
function statusOf(error) {
    if (typeof error !== "object" || error === null || !("status" in error))
        return undefined;
    return typeof error.status === "number" ? error.status : undefined;
}
function isAbort(error, signal) {
    return signal.aborted || (error instanceof DOMException && error.name === "AbortError");
}
/**
 * Own one already-reserved Managed Agents Work item from inside its sandbox.
 *
 * The dispatcher deliberately leaves the item unacknowledged. This runner is
 * therefore the single owner of ACK, the optimistic-concurrency heartbeat,
 * execution cancellation, and terminal stop. A 412 fences the local process
 * immediately and suppresses stop because the Work may already belong to a
 * replacement.
 */
export function createClaimedEnvironmentWorkRunner(options) {
    if (typeof options?.client?.ack !== "function"
        || typeof options.client.heartbeat !== "function"
        || typeof options.client.stop !== "function") {
        throw new TypeError("Claimed Work runner requires a lifecycle client");
    }
    const heartbeatIntervalMs = positiveInteger(options.heartbeatIntervalMs ?? 30_000, "heartbeatIntervalMs");
    const heartbeatTtlSeconds = positiveInteger(options.heartbeatTtlSeconds ?? 90, "heartbeatTtlSeconds");
    const scheduler = options.scheduler ?? defaultScheduler;
    const now = options.now ?? Date.now;
    return {
        async run(input) {
            const environmentId = nonEmpty(input.environmentId, "environmentId");
            nonEmpty(input.sessionId, "sessionId");
            const workId = nonEmpty(input.workId, "workId");
            input.signal?.throwIfAborted();
            const execution = new AbortController();
            const heartbeat = new AbortController();
            const onExternalAbort = () => {
                execution.abort(input.signal?.reason);
                heartbeat.abort(input.signal?.reason);
            };
            input.signal?.addEventListener("abort", onExternalAbort, { once: true });
            let ownership = "unacknowledged";
            let lastHeartbeat = "NO_HEARTBEAT";
            let lastSuccessAt = now();
            let ttlMs = heartbeatTtlSeconds * 1_000;
            let leaseFailure = null;
            const loseLease = (message, cause) => {
                if (ownership === "lost")
                    return;
                ownership = "lost";
                leaseFailure = new ClaimedEnvironmentWorkLeaseLostError(message, { cause });
                execution.abort(leaseFailure);
                heartbeat.abort(leaseFailure);
            };
            const beat = async (initial) => {
                try {
                    const response = await options.client.heartbeat(workId, {
                        environment_id: environmentId,
                        desired_ttl_seconds: heartbeatTtlSeconds,
                        expected_last_heartbeat: lastHeartbeat,
                    }, { signal: heartbeat.signal });
                    if (!Number.isFinite(response.ttl_seconds) || response.ttl_seconds <= 0) {
                        loseLease("Managed Environment Work heartbeat returned an invalid lease TTL");
                        return;
                    }
                    lastHeartbeat = response.last_heartbeat;
                    lastSuccessAt = now();
                    ttlMs = response.ttl_seconds * 1_000;
                    ownership = "held";
                    if (!response.lease_extended
                        || response.state === "stopping"
                        || response.state === "stopped") {
                        execution.abort(new Error(`Managed Environment Work entered ${response.state}`));
                        heartbeat.abort(execution.signal.reason);
                    }
                }
                catch (error) {
                    if (statusOf(error) === 412) {
                        loseLease("Managed Environment Work lease was lost", error);
                        return;
                    }
                    if (isAbort(error, heartbeat.signal))
                        return;
                    if (initial || now() - lastSuccessAt >= ttlMs) {
                        loseLease("Managed Environment Work lease could not be established or renewed", error);
                        return;
                    }
                    await options.onError?.(error);
                }
            };
            let monitor = null;
            try {
                await options.client.ack(workId, { environment_id: environmentId }, { signal: execution.signal });
                await beat(true);
                if (leaseFailure !== null)
                    throw leaseFailure;
                execution.signal.throwIfAborted();
                monitor = (async () => {
                    while (!heartbeat.signal.aborted) {
                        try {
                            await scheduler.sleep(heartbeatIntervalMs, heartbeat.signal);
                        }
                        catch (error) {
                            if (heartbeat.signal.aborted)
                                return;
                            throw error;
                        }
                        if (heartbeat.signal.aborted)
                            return;
                        await beat(false);
                    }
                })();
                void monitor.catch((error) => {
                    loseLease("Managed Environment Work heartbeat loop failed", error);
                });
                let result;
                try {
                    result = await input.execute(execution.signal);
                }
                catch (error) {
                    if (leaseFailure !== null)
                        throw leaseFailure;
                    throw error;
                }
                if (leaseFailure !== null)
                    throw leaseFailure;
                execution.signal.throwIfAborted();
                return result;
            }
            finally {
                heartbeat.abort(new Error("Managed Environment Work execution finished"));
                await monitor?.catch(() => undefined);
                input.signal?.removeEventListener("abort", onExternalAbort);
                if (ownership === "held") {
                    await Promise.resolve(options.client.stop(workId, { environment_id: environmentId, force: true }, { signal: new AbortController().signal })).catch(options.onError);
                }
            }
        },
    };
}
//# sourceMappingURL=claimed-environment-work.js.map