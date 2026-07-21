import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION, } from "@agentclientprotocol/sdk";
const NON_TRANSCRIPT_SESSION_UPDATES = new Set([
    "available_commands_update",
    "current_mode_update",
    "config_option_update",
    "session_info_update",
    "usage_update",
]);
const LOAD_REPLAY_QUIET_MS = 30;
const LOAD_REPLAY_MAX_SETTLE_MS = 300;
const SESSION_CLOSE_TIMEOUT_MS = 1_000;
const ACP_AUTH_REQUIRED_CODE = -32000;
function sessionUpdateKind(update) {
    if (!update || typeof update !== "object")
        return null;
    const value = update;
    if (typeof value.sessionUpdate === "string")
        return value.sessionUpdate;
    return typeof value.type === "string" ? value.type : null;
}
function isTranscriptReplayUpdate(update) {
    const kind = sessionUpdateKind(update);
    return !kind || !NON_TRANSCRIPT_SESSION_UPDATES.has(kind);
}
function isIdleSessionUpdate(update) {
    const kind = sessionUpdateKind(update);
    return Boolean(kind && NON_TRANSCRIPT_SESSION_UPDATES.has(kind));
}
function isAuthRequiredError(error) {
    if (!error || typeof error !== "object")
        return false;
    const value = error;
    return value.code === ACP_AUTH_REQUIRED_CODE
        && typeof value.message === "string"
        && /^Authentication required\b/i.test(value.message);
}
function firstAgentHandledAuthMethod(authMethods) {
    for (const method of authMethods) {
        if (!method.id)
            continue;
        const value = method;
        const meta = value._meta ?? value.meta;
        const metaType = meta && typeof meta === "object" && !Array.isArray(meta)
            ? meta.type
            : undefined;
        const type = typeof value.type === "string"
            ? value.type
            : typeof metaType === "string"
                ? metaType
                : "agent";
        if (type === "agent")
            return method;
    }
    return null;
}
function mergeClientCapabilities(callbacks, extra) {
    const inferred = {
        fs: {
            readTextFile: Boolean(callbacks.readTextFile),
            writeTextFile: Boolean(callbacks.writeTextFile),
        },
        terminal: Boolean(callbacks.createTerminal),
    };
    if (!extra)
        return inferred;
    return {
        ...inferred,
        ...extra,
        fs: {
            ...inferred.fs,
            ...(extra.fs ?? {}),
        },
        _meta: {
            ...(inferred._meta ?? {}),
            ...(extra._meta ?? {}),
        },
    };
}
export class AcpSessionImpl {
    id;
    options;
    #child;
    #agent;
    #sessionId;
    #disposed = false;
    #disposePromise = null;
    #activePromptCount = 0;
    #pendingEvents = [];
    #waiters = [];
    #authMethods = [];
    #agentInfo = null;
    #configOptions = [];
    #modes;
    #promptCapabilities = {};
    #supportsSessionFork = false;
    #supportsSessionClose = false;
    #loadedReplayEvents = [];
    #suppressLoadedReplay = false;
    #lastSuppressedLoadReplayAt = 0;
    constructor(deps) {
        this.id = deps.id;
        this.options = deps.options;
        this.#child = deps.child;
    }
    get acpSessionId() {
        return this.#sessionId ?? "";
    }
    get authMethods() {
        return this.#authMethods;
    }
    get agentInfo() {
        return this.#agentInfo;
    }
    get configOptions() {
        return this.#configOptions;
    }
    get modes() {
        return this.#modes ? structuredClone(this.#modes) : undefined;
    }
    get promptCapabilities() {
        return this.#promptCapabilities;
    }
    get supportsSessionFork() {
        return this.#supportsSessionFork;
    }
    get loadedReplayEvents() {
        return this.#loadedReplayEvents.map((event) => structuredClone(event));
    }
    async init() {
        const initStartedAt = Date.now();
        const callbacks = this.options.clientCallbacks ?? {};
        const connection = new ClientSideConnection(() => this.#createClient(callbacks), ndJsonStream(this.#child.stdin, this.#child.stdout));
        this.#agent = connection;
        const initialized = await this.#agent.initialize({
            protocolVersion: PROTOCOL_VERSION,
            clientCapabilities: mergeClientCapabilities(callbacks, this.options.clientCapabilities),
        });
        const initializedAt = Date.now();
        this.#authMethods = initialized.authMethods ?? [];
        this.#agentInfo = initialized.agentInfo ?? null;
        this.#promptCapabilities = initialized.agentCapabilities?.promptCapabilities ?? {};
        this.#supportsSessionFork =
            initialized.agentCapabilities?.sessionCapabilities?.fork != null;
        this.#supportsSessionClose =
            initialized.agentCapabilities?.sessionCapabilities?.close != null
                && typeof this.#agent.closeSession === "function";
        const cwd = this.options.agent.cwd ?? process.cwd();
        const mcpServers = this.options.mcpServers ?? [];
        let attemptedAuth = false;
        const withAuthRetry = async (request) => {
            try {
                return await request();
            }
            catch (error) {
                const method = firstAgentHandledAuthMethod(this.#authMethods);
                if (attemptedAuth
                    || this.options.autoAuthenticate === false
                    || !method
                    || !isAuthRequiredError(error)) {
                    throw error;
                }
                attemptedAuth = true;
                await this.#agent.authenticate({ methodId: method.id });
                return request();
            }
        };
        if (this.options.forkFromAcpSessionId) {
            if (!this.#supportsSessionFork || !this.#agent.unstable_forkSession) {
                throw new Error("ACP agent does not support unstable session/fork");
            }
            const forked = await withAuthRetry(() => this.#agent.unstable_forkSession({
                sessionId: this.options.forkFromAcpSessionId,
                cwd,
                mcpServers,
            }));
            this.#sessionId = forked.sessionId;
            this.#setSessionStateFromResponse(forked);
            this.#logInit("fork", initStartedAt, initializedAt);
            return;
        }
        const resumeSessionId = this.options.resumeAcpSessionId;
        const sessionCapabilities = initialized.agentCapabilities?.sessionCapabilities;
        if (resumeSessionId
            && sessionCapabilities?.resume != null
            && this.#agent.resumeSession) {
            try {
                const resumed = await withAuthRetry(() => this.#agent.resumeSession({
                    sessionId: resumeSessionId,
                    cwd,
                    mcpServers,
                }));
                this.#sessionId = resumeSessionId;
                this.#setSessionStateFromResponse(resumed);
                this.#logInit("resume", initStartedAt, initializedAt);
                return;
            }
            catch (error) {
                console.error(`[acp] session/resume(${resumeSessionId}) failed, falling back to load/new:`, error);
            }
        }
        if (resumeSessionId
            && initialized.agentCapabilities?.loadSession === true
            && this.#agent.loadSession) {
            try {
                this.#loadedReplayEvents = [];
                this.#suppressLoadedReplay = true;
                this.#lastSuppressedLoadReplayAt = 0;
                const loaded = await withAuthRetry(() => this.#agent.loadSession({
                    sessionId: resumeSessionId,
                    cwd,
                    mcpServers,
                }));
                this.#sessionId = resumeSessionId;
                this.#setSessionStateFromResponse(loaded);
                await this.#settleLoadedReplay();
                this.#logInit("load", initStartedAt, initializedAt);
                return;
            }
            catch (error) {
                this.#loadedReplayEvents = [];
                console.error(`[acp] session/load(${resumeSessionId}) failed, falling back to new:`, error);
            }
            finally {
                this.#suppressLoadedReplay = false;
            }
        }
        const created = await withAuthRetry(() => this.#agent.newSession({ cwd, mcpServers }));
        this.#sessionId = created.sessionId;
        this.#setSessionStateFromResponse(created);
        this.#logInit("new", initStartedAt, initializedAt);
    }
    #createClient(callbacks) {
        return {
            sessionUpdate: async (params) => {
                const inner = params.update;
                const update = (inner === undefined ? params : inner);
                if (this.#suppressLoadedReplay && isTranscriptReplayUpdate(update)) {
                    this.#lastSuppressedLoadReplayAt = Date.now();
                    this.#loadedReplayEvents.push(update);
                    return;
                }
                if (this.#activePromptCount === 0 && !isIdleSessionUpdate(update))
                    return;
                this.#pushEvent(update);
            },
            requestPermission: async (params) => {
                if (this.options.emitPermissionEvents) {
                    this.#pushEvent({ type: "requestPermission", params });
                }
                if (!callbacks.requestPermission) {
                    return { outcome: { outcome: "cancelled" } };
                }
                try {
                    return await callbacks.requestPermission(params);
                }
                catch (error) {
                    this.#pushEvent({ type: "requestPermissionError", error: String(error) });
                    return { outcome: { outcome: "cancelled" } };
                }
            },
            readTextFile: callbacks.readTextFile
                ? async (params) => callbacks.readTextFile(params)
                : undefined,
            writeTextFile: callbacks.writeTextFile
                ? async (params) => callbacks.writeTextFile(params)
                : undefined,
            createTerminal: callbacks.createTerminal
                ? async (params) => callbacks.createTerminal(params)
                : undefined,
            terminalOutput: callbacks.terminalOutput
                ? async (params) => callbacks.terminalOutput(params)
                : undefined,
            releaseTerminal: callbacks.releaseTerminal
                ? async (params) => callbacks.releaseTerminal(params)
                : undefined,
            waitForTerminalExit: callbacks.waitForTerminalExit
                ? async (params) => callbacks.waitForTerminalExit(params)
                : undefined,
            killTerminal: callbacks.killTerminal
                ? async (params) => callbacks.killTerminal(params)
                : undefined,
        };
    }
    #logInit(mode, startedAt, initializedAt) {
        if (process.env.NODE_ENV === "test")
            return;
        const completedAt = Date.now();
        process.stderr.write(`[acp-init] id=${this.id} mode=${mode} initialize_ms=${initializedAt - startedAt} session_open_ms=${completedAt - initializedAt} total_ms=${completedAt - startedAt}\n`);
    }
    async authenticate(methodId) {
        if (!this.#agent)
            throw new Error("AcpSession not initialized");
        await this.#agent.authenticate({ methodId });
    }
    async setMode(modeId) {
        if (!this.#agent || !this.#sessionId)
            throw new Error("AcpSession not initialized");
        if (!this.#agent.setSessionMode) {
            throw new Error("ACP agent does not support session modes");
        }
        await this.#agent.setSessionMode({ sessionId: this.#sessionId, modeId });
        if (this.#modes)
            this.#modes = { ...this.#modes, currentModeId: modeId };
        return this.modes;
    }
    async setConfigOption(configId, value) {
        if (!this.#agent || !this.#sessionId)
            throw new Error("AcpSession not initialized");
        if (!this.#agent.setSessionConfigOption) {
            throw new Error("ACP agent does not support session config options");
        }
        const response = await this.#agent.setSessionConfigOption({
            sessionId: this.#sessionId,
            configId,
            ...(typeof value === "boolean" ? { type: "boolean", value } : { value }),
        });
        this.#setSessionStateFromResponse(response);
        return this.#configOptions;
    }
    prompt(input, options) {
        if (this.#disposed)
            throw new Error(`AcpSession ${this.id} is disposed`);
        return this.#prompt(input, options);
    }
    async provideToolResult(toolCallId, result) {
        void toolCallId;
        void result;
        throw new Error("provideToolResult not implemented; ACP tools use client callbacks");
    }
    drainPendingEvents() {
        return this.#pendingEvents.splice(0);
    }
    async *#prompt(input, options) {
        const turnAbort = new AbortController();
        const cancelAgent = () => {
            void this.#agent.cancel({ sessionId: this.#sessionId }).catch(() => undefined);
        };
        const abortByCaller = () => cancelAgent();
        options?.abortSignal?.addEventListener("abort", abortByCaller, { once: true });
        turnAbort.signal.addEventListener("abort", cancelAgent, { once: true });
        const timer = this.options.perTurnTimeoutMs
            ? setTimeout(() => {
                turnAbort.abort();
            }, this.options.perTurnTimeoutMs)
            : undefined;
        timer?.unref?.();
        if (options?.abortSignal?.aborted)
            abortByCaller();
        this.#activePromptCount += 1;
        const prompt = typeof input === "string"
            ? [{ type: "text", text: input }]
            : [...input];
        const agentPrompt = this.#agent.prompt({ sessionId: this.#sessionId, prompt });
        void agentPrompt.catch(() => undefined);
        const abort = new Promise((_, reject) => {
            turnAbort.signal.addEventListener("abort", () => reject(new Error(`ACP prompt timed out after ${this.options.perTurnTimeoutMs}ms`)), { once: true });
        });
        const done = Promise.race([agentPrompt, abort]).finally(() => {
            this.#activePromptCount = Math.max(0, this.#activePromptCount - 1);
            if (timer)
                clearTimeout(timer);
            options?.abortSignal?.removeEventListener("abort", abortByCaller);
            turnAbort.signal.removeEventListener("abort", cancelAgent);
        });
        let ended = false;
        const endPromise = done.then((response) => {
            ended = true;
            this.#pushEvent({ type: "promptComplete", response });
            this.#endStream();
        }, (error) => {
            ended = true;
            this.#pushEvent({ type: "promptError", error: String(error) });
            this.#endStream();
        });
        while (true) {
            if (this.#pendingEvents.length > 0) {
                yield this.#pendingEvents.shift();
            }
            else if (ended || this.#disposed) {
                break;
            }
            else {
                await new Promise((resolve) => {
                    this.#waiters.push(resolve);
                });
            }
        }
        await endPromise;
    }
    isAlive() {
        return !this.#disposed;
    }
    dispose() {
        this.#disposePromise ??= this.#disposeOnce();
        return this.#disposePromise;
    }
    async #disposeOnce() {
        this.#disposed = true;
        this.#endStream();
        if (this.#supportsSessionClose && this.#sessionId && this.#agent.closeSession) {
            await withTimeout(this.#agent.closeSession({ sessionId: this.#sessionId }), SESSION_CLOSE_TIMEOUT_MS).catch(() => undefined);
        }
        await this.#child.kill("SIGTERM").catch(() => undefined);
    }
    #pushEvent(event) {
        this.#setSessionStateFromEvent(event);
        this.#pendingEvents.push(event);
        this.#waiters.shift()?.();
    }
    #endStream() {
        while (this.#waiters.length > 0)
            this.#waiters.shift()?.();
    }
    #setSessionStateFromResponse(value) {
        if (Array.isArray(value?.configOptions))
            this.#configOptions = value.configOptions;
        if (value?.modes)
            this.#modes = structuredClone(value.modes);
    }
    #setSessionStateFromEvent(event) {
        if (!("sessionUpdate" in event))
            return;
        if (event.sessionUpdate === "config_option_update") {
            this.#configOptions = event.configOptions;
        }
        else if (event.sessionUpdate === "current_mode_update" && this.#modes) {
            this.#modes = { ...this.#modes, currentModeId: event.currentModeId };
        }
    }
    async #settleLoadedReplay() {
        const deadline = Date.now() + LOAD_REPLAY_MAX_SETTLE_MS;
        let lastSeen = this.#lastSuppressedLoadReplayAt;
        while (Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, LOAD_REPLAY_QUIET_MS));
            if (this.#lastSuppressedLoadReplayAt === lastSeen)
                return;
            lastSeen = this.#lastSuppressedLoadReplayAt;
        }
    }
}
async function withTimeout(promise, timeoutMs) {
    let timer;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(`ACP session close timed out after ${timeoutMs}ms`)), timeoutMs);
                timer.unref?.();
            }),
        ]);
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
//# sourceMappingURL=session.js.map