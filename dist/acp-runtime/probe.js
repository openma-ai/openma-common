import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION, } from "@agentclientprotocol/sdk";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isAuthenticationRequiredError } from "./errors.js";
import { NodeSpawner } from "./spawners/node.js";
const ACP_CLIENT_CAPABILITIES = {
    fs: { readTextFile: true, writeTextFile: true },
    terminal: true,
    auth: { terminal: true, _meta: { gateway: true } },
    _meta: { "terminal-auth": true, terminal_output: true },
};
/**
 * Disposable capability probe used during product cold start. It deliberately
 * never returns the child as a real session: callers must start a fresh ACP
 * session after consuming this snapshot.
 */
export async function probeAcpSession(options) {
    const cwd = options.cwd ?? join(tmpdir(), "openma-acp-probe");
    await mkdir(cwd, { recursive: true });
    let configOptions = [];
    let availableCommands = [];
    let currentModeId;
    let resolveCommands;
    const commandsReady = new Promise((resolve) => {
        resolveCommands = resolve;
    });
    const client = {
        sessionUpdate: async (params) => {
            const update = asRecord(params.update);
            if (!update)
                return;
            if (update.sessionUpdate === "config_option_update" && Array.isArray(update.configOptions)) {
                configOptions = update.configOptions.map((option) => structuredClone(option));
            }
            if (update.sessionUpdate === "available_commands_update") {
                const commands = Array.isArray(update.availableCommands)
                    ? update.availableCommands
                    : Array.isArray(update.available_commands)
                        ? update.available_commands
                        : undefined;
                if (commands) {
                    availableCommands = commands.map((command) => structuredClone(command));
                    resolveCommands?.();
                }
            }
            if (update.sessionUpdate === "current_mode_update" && typeof update.currentModeId === "string") {
                currentModeId = update.currentModeId;
            }
        },
        requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
    };
    const connection = await spawnProbeAgent({
        agent: options.agent,
        cwd,
        env: options.env,
        spawner: options.spawner,
        client,
    });
    const timeoutMs = Math.max(1, options.timeoutMs ?? 15_000);
    const settleMs = Math.max(0, options.capabilitySettleMs ?? 750);
    try {
        return await withTimeout((async () => {
            const initialized = await Promise.resolve(connection.agent.initialize({
                protocolVersion: PROTOCOL_VERSION,
                clientCapabilities: ACP_CLIENT_CAPABILITIES,
            }));
            const created = await Promise.resolve(connection.agent.newSession({
                cwd,
                mcpServers: [],
            }));
            await waitForSignalOrTimeout(commandsReady, settleMs);
            const responseOptions = Array.isArray(created.configOptions)
                ? created.configOptions.map((option) => structuredClone(option))
                : [];
            const responseModes = created.modes ? structuredClone(created.modes) : null;
            return {
                sessionId: created.sessionId,
                configOptions: responseOptions.length > 0 ? responseOptions : configOptions,
                availableCommands,
                modes: responseModes
                    ? (currentModeId ? { ...responseModes, currentModeId } : responseModes)
                    : null,
                authMethods: Array.isArray(initialized.authMethods)
                    ? initialized.authMethods.map((method) => structuredClone(method))
                    : [],
            };
        })(), timeoutMs, `ACP capability probe timed out after ${timeoutMs}ms`);
    }
    finally {
        await connection.dispose();
    }
}
/** Disposable session/capability probe that also reports auth status from the same child. */
export async function probeAgentSessionConfig(options) {
    const cwd = options.cwd ?? join(tmpdir(), "openma-acp-probe");
    await mkdir(cwd, { recursive: true });
    let updatedConfigOptions = [];
    let updatedAvailableCommands = [];
    let updatedModeId = null;
    let resolveAvailableCommands = null;
    const availableCommandsReady = new Promise((resolve) => {
        resolveAvailableCommands = resolve;
    });
    const client = {
        sessionUpdate: async (params) => {
            const next = configOptionsFromSessionUpdate(params.update);
            if (next)
                updatedConfigOptions = next;
            const commands = availableCommandsFromSessionUpdate(params.update);
            if (commands) {
                updatedAvailableCommands = commands;
                resolveAvailableCommands?.();
            }
            const modeId = modeFromSessionUpdate(params.update);
            if (modeId)
                updatedModeId = modeId;
        },
        requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
    };
    const connection = await spawnAuthAgent({
        agent: options.agent,
        cwd,
        env: options.env,
        spawner: options.spawner,
        client,
    });
    const timeoutMs = Math.max(1, options.timeoutMs ?? 15_000);
    const capabilitySettleMs = Math.max(0, options.capabilitySettleMs ?? 750);
    try {
        return await withTimeout((async () => {
            const initResult = await initializeAuthAgent(connection.agent);
            const methods = supportedAuthMethods(initResult.authMethods);
            const method = selectAuthMethod(initResult.authMethods);
            if (!method) {
                const declared = declaredAuthMethods(initResult.authMethods);
                if (declared.length > 0) {
                    const unsupported = unsupportedAuthMethodTypes(declared);
                    return {
                        configOptions: [],
                        availableCommands: [],
                        auth: {
                            status: "unknown",
                            message: unsupported.length > 0
                                ? `No supported ACP auth method is available. Unsupported methods: ${unsupported.join(", ")}.`
                                : "No supported ACP auth method is available.",
                        },
                    };
                }
            }
            const methodFields = method
                ? authMethodStatusFields(method, methods, options.agent, connection.env, cwd)
                : {};
            if (method && isCredentialPromptAuthMethod(method)) {
                const missing = missingCredentialVariableNames(method, connection.env);
                if (missing.length > 0) {
                    return {
                        configOptions: [],
                        availableCommands: [],
                        auth: {
                            status: "needs-auth",
                            ...methodFields,
                            message: missing.length === 1
                                ? `Missing credential variable: ${missing[0]}.`
                                : `Missing credential variables: ${missing.join(", ")}.`,
                        },
                    };
                }
            }
            try {
                const session = await createAuthProbeSession(connection.agent, cwd);
                const responseConfigOptions = configOptionsFromResponse(session);
                const modes = modesFromResponse(session);
                await waitForSignalOrTimeout(availableCommandsReady, capabilitySettleMs);
                await allowDiagnosticsToFlush();
                const diagnostic = unauthenticatedDiagnostic(connection.diagnosticLines);
                return {
                    configOptions: responseConfigOptions.length > 0 ? responseConfigOptions : updatedConfigOptions,
                    availableCommands: updatedAvailableCommands,
                    ...(modes ? { modes: updatedModeId ? { ...modes, currentModeId: updatedModeId } : modes } : {}),
                    auth: diagnostic
                        ? { status: "needs-auth", ...methodFields, message: diagnostic }
                        : method
                            ? { status: "configured", ...methodFields }
                            : { status: "none" },
                };
            }
            catch (error) {
                if (isAuthenticationRequiredError(error)) {
                    return {
                        configOptions: [],
                        availableCommands: [],
                        auth: { status: "needs-auth", ...methodFields },
                    };
                }
                const message = acpErrorMessage(error);
                if (isAuthFailureMessage(message)) {
                    return {
                        configOptions: [],
                        availableCommands: [],
                        auth: { status: "needs-auth", ...methodFields, message },
                    };
                }
                throw error;
            }
        })(), timeoutMs, `ACP agent config probe timed out after ${timeoutMs}ms`);
    }
    finally {
        await connection.dispose();
    }
}
const activeProbes = new Set();
/** Dispose every in-flight capability probe, auth probe, and background
 * authentication child before a product shuts down. */
export async function disposeAllAcpProbes() {
    await Promise.allSettled([...activeProbes].map((dispose) => dispose()));
}
async function spawnProbeAgent(options) {
    const mergedEnv = {
        ...(options.agent.env ?? {}),
        ...(options.env ?? {}),
    };
    const child = await (options.spawner ?? new NodeSpawner()).spawn({
        ...options.agent,
        cwd: options.cwd,
        env: mergedEnv,
    });
    const stream = ndJsonStream(child.stdin, child.stdout);
    const agent = new ClientSideConnection(() => options.client, stream);
    let disposed;
    const dispose = () => {
        disposed ??= child.kill().catch(() => undefined).finally(() => {
            activeProbes.delete(dispose);
        });
        return disposed;
    };
    activeProbes.add(dispose);
    return { agent, dispose };
}
async function withTimeout(promise, timeoutMs, message) {
    let timer;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(message)), timeoutMs);
                if (typeof timer === "object" && "unref" in timer)
                    timer.unref();
            }),
        ]);
    }
    finally {
        if (timer !== undefined)
            clearTimeout(timer);
    }
}
async function waitForSignalOrTimeout(signal, timeoutMs) {
    if (timeoutMs === 0)
        return;
    let timer;
    try {
        await Promise.race([
            signal,
            new Promise((resolve) => {
                timer = setTimeout(resolve, timeoutMs);
                if (typeof timer === "object" && "unref" in timer)
                    timer.unref();
            }),
        ]);
    }
    finally {
        if (timer !== undefined)
            clearTimeout(timer);
    }
}
function asRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value
        : undefined;
}
const SUPPORTED_AUTH_METHOD_TYPES = new Set(["agent", "terminal", "env_var"]);
export async function probeAgentAuthStatus(options) {
    const cwd = options.cwd ?? join(tmpdir(), "openma-acp-auth-probe");
    await mkdir(cwd, { recursive: true });
    const connection = await spawnAuthAgent({
        agent: options.agent,
        cwd,
        env: options.env,
        spawner: options.spawner,
    });
    const timeoutMs = Math.max(1, options.timeoutMs ?? 15_000);
    try {
        return await withTimeout(readAuthStatus(connection, options.agent, cwd), timeoutMs, `ACP auth probe timed out after ${timeoutMs}ms`);
    }
    finally {
        await connection.dispose();
    }
}
export async function authenticateAgent(options) {
    const cwd = options.cwd ?? join(tmpdir(), "openma-acp-auth");
    await mkdir(cwd, { recursive: true });
    const env = mergedStringEnv(options.agent.env, options.env);
    let authTerminalId = 0;
    let activeAuthMethodName = "Agent";
    let resolveTerminalLaunch;
    let rejectTerminalLaunch;
    const terminalLaunch = new Promise((resolve, reject) => {
        resolveTerminalLaunch = resolve;
        rejectTerminalLaunch = reject;
    });
    void terminalLaunch.catch(() => undefined);
    const client = {
        sessionUpdate: async () => undefined,
        requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
        createTerminal: async (params) => {
            if (!options.launchInteractiveAuth) {
                throw new Error("ACP auth requested a terminal, but this host cannot open one.");
            }
            const terminalId = `auth-terminal-${++authTerminalId}`;
            try {
                const terminalEnv = envArrayToRecord(params.env);
                await options.launchInteractiveAuth({
                    label: `${activeAuthMethodName} auth`,
                    command: params.command,
                    args: params.args ?? [],
                    ...(terminalEnv ? { env: terminalEnv } : {}),
                    cwd: params.cwd ?? cwd,
                });
                resolveTerminalLaunch?.();
                return { terminalId };
            }
            catch (error) {
                rejectTerminalLaunch?.(error);
                throw error;
            }
        },
        terminalOutput: async () => ({ output: "", truncated: false }),
        waitForTerminalExit: async () => new Promise(() => undefined),
        releaseTerminal: async () => undefined,
        killTerminal: async () => undefined,
    };
    const connection = await spawnAuthAgent({
        agent: options.agent,
        cwd,
        env: options.env,
        spawner: options.spawner,
        client,
    });
    const timeoutMs = Math.max(1, options.timeoutMs ?? 120_000);
    const agentAuthLaunchGraceMs = options.agentAuthLaunchGraceMs ?? 0;
    const backgroundAuthTimeoutMs = options.backgroundAuthTimeoutMs ?? 10 * 60_000;
    let keepChildAliveForBackgroundAuth = false;
    let timer;
    const keepBackgroundAuthAlive = (authPromise) => {
        keepChildAliveForBackgroundAuth = true;
        let backgroundTimer = setTimeout(() => {
            void connection.dispose();
            backgroundTimer = undefined;
        }, backgroundAuthTimeoutMs);
        backgroundTimer.unref?.();
        void (async () => {
            try {
                await authPromise;
            }
            catch {
                // The interactive flow may be cancelled after the host has taken over.
            }
            finally {
                if (backgroundTimer)
                    clearTimeout(backgroundTimer);
                await connection.dispose();
            }
        })();
    };
    try {
        return await Promise.race([
            (async () => {
                const initResult = await initializeAuthAgent(connection.agent);
                const method = selectAuthMethod(initResult.authMethods, options.methodId);
                if (!method) {
                    throw new Error(options.methodId
                        ? `ACP auth method is unavailable or not supported: ${options.methodId}`
                        : "No supported ACP auth method is available for this agent");
                }
                if (isCredentialPromptAuthMethod(method)) {
                    const vars = credentialVariableNames(method);
                    throw new Error(vars
                        ? `ACP auth method ${method.id} requires credential variables (${vars}) and cannot be started as a sign-in flow.`
                        : `ACP auth method ${method.id} requires credential variables and cannot be started as a sign-in flow.`);
                }
                const authenticateMeta = authenticateMetaFromMethod(method, options.values ?? {});
                if (authenticateMeta) {
                    await Promise.resolve(connection.agent.authenticate({
                        methodId: method.id,
                        _meta: authenticateMeta,
                    })).catch((error) => {
                        throw withAcpDetails(error);
                    });
                    return { status: "completed" };
                }
                const terminalAuth = terminalAuthFromMethod(method, options.agent, env, cwd);
                if (terminalAuth) {
                    if (!options.launchInteractiveAuth) {
                        throw new Error(`ACP auth method ${method.id} requires an interactive terminal, but this host cannot open one.`);
                    }
                    await options.launchInteractiveAuth(terminalAuth);
                    return { status: "started" };
                }
                activeAuthMethodName = authMethodName(method) ?? "Agent";
                const authPromise = Promise.resolve(connection.agent.authenticate({ methodId: method.id }))
                    .catch((error) => {
                    throw withAcpDetails(error);
                });
                void authPromise.catch(() => undefined);
                let launchGraceTimer;
                const launchGrace = agentAuthLaunchGraceMs > 0
                    ? new Promise((resolve) => {
                        launchGraceTimer = setTimeout(() => resolve("launched"), agentAuthLaunchGraceMs);
                        launchGraceTimer.unref?.();
                    })
                    : null;
                try {
                    const result = await Promise.race([
                        authPromise.then(() => "complete"),
                        terminalLaunch.then(() => "terminal"),
                        ...(launchGrace ? [launchGrace] : []),
                    ]);
                    if (result === "launched") {
                        keepBackgroundAuthAlive(authPromise);
                        return { status: "started" };
                    }
                    return { status: result === "complete" ? "completed" : "started" };
                }
                finally {
                    if (launchGraceTimer)
                        clearTimeout(launchGraceTimer);
                }
            })(),
            new Promise((_, reject) => {
                timer = setTimeout(() => {
                    reject(new Error(`ACP auth timed out after ${timeoutMs}ms`));
                }, timeoutMs);
                timer.unref?.();
            }),
        ]);
    }
    finally {
        if (timer)
            clearTimeout(timer);
        if (!keepChildAliveForBackgroundAuth)
            await connection.dispose();
    }
}
async function readAuthStatus(connection, agent, cwd) {
    const initResult = await initializeAuthAgent(connection.agent);
    const methods = supportedAuthMethods(initResult.authMethods);
    const method = selectAuthMethod(initResult.authMethods);
    if (!method) {
        const declared = declaredAuthMethods(initResult.authMethods);
        if (declared.length > 0) {
            const unsupported = unsupportedAuthMethodTypes(declared);
            return {
                status: "unknown",
                message: unsupported.length > 0
                    ? `No supported ACP auth method is available. Unsupported methods: ${unsupported.join(", ")}.`
                    : "No supported ACP auth method is available.",
            };
        }
        return { status: "none" };
    }
    const methodFields = authMethodStatusFields(method, methods, agent, connection.env, cwd);
    if (isCredentialPromptAuthMethod(method)) {
        const missing = missingCredentialVariableNames(method, connection.env);
        if (missing.length > 0) {
            const [only] = missing;
            return {
                status: "needs-auth",
                ...methodFields,
                message: missing.length === 1 && only
                    ? `Missing credential variable: ${only}.`
                    : `Missing credential variables: ${missing.join(", ")}.`,
            };
        }
    }
    try {
        await createAuthProbeSession(connection.agent, cwd);
        await allowDiagnosticsToFlush();
        const diagnostic = unauthenticatedDiagnostic(connection.diagnosticLines);
        if (diagnostic) {
            return { status: "needs-auth", ...methodFields, message: diagnostic };
        }
        return { status: "configured", ...methodFields };
    }
    catch (error) {
        if (!isAuthenticationRequiredError(error)) {
            return { status: "unknown", message: acpErrorMessage(error), ...methodFields };
        }
        return { status: "needs-auth", ...methodFields };
    }
}
async function spawnAuthAgent(options) {
    const env = mergedStringEnv(options.agent.env, options.env);
    const diagnosticLines = [];
    const onDiagnosticLine = options.agent.onDiagnosticLine;
    const child = await (options.spawner ?? new NodeSpawner()).spawn({
        ...options.agent,
        cwd: options.cwd,
        env: { ...(options.agent.env ?? {}), ...(options.env ?? {}) },
        onDiagnosticLine: (line) => {
            diagnosticLines.push(line);
            onDiagnosticLine?.(line);
        },
    });
    const agent = new ClientSideConnection(() => options.client ?? {
        sessionUpdate: async () => undefined,
        requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
    }, ndJsonStream(child.stdin, child.stdout));
    let disposed;
    const dispose = () => {
        disposed ??= withTimeout(child.kill(), 5_000, "ACP setup process disposal timed out after 5000ms").catch(() => undefined).finally(() => {
            activeProbes.delete(dispose);
        });
        return disposed;
    };
    activeProbes.add(dispose);
    return { agent, env, diagnosticLines, dispose };
}
function initializeAuthAgent(agent) {
    return Promise.resolve(agent.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: ACP_CLIENT_CAPABILITIES,
    }));
}
function createAuthProbeSession(agent, cwd) {
    return Promise.resolve(agent.newSession({ cwd, mcpServers: [] }));
}
function authMethodType(method) {
    const type = method.type;
    if (typeof type === "string" && type.length > 0)
        return type;
    const metaType = authMethodMeta(method)?.type;
    return typeof metaType === "string" && metaType.length > 0 ? metaType : "agent";
}
function isSupportedAuthMethod(method) {
    return SUPPORTED_AUTH_METHOD_TYPES.has(authMethodType(method));
}
function supportedAuthMethods(authMethods) {
    return declaredAuthMethods(authMethods).filter(isSupportedAuthMethod);
}
function declaredAuthMethods(authMethods) {
    if (!Array.isArray(authMethods))
        return [];
    return authMethods.filter((method) => {
        if (!asRecord(method))
            return false;
        const id = method.id;
        return typeof id === "string" && id.length > 0;
    });
}
function unsupportedAuthMethodTypes(methods) {
    return [...new Set(methods
            .filter((method) => !isSupportedAuthMethod(method))
            .map(authMethodType)
            .filter((type) => type.length > 0))];
}
function authMethodMeta(method) {
    const record = method;
    return asRecord(record._meta ?? record.meta) ?? null;
}
function terminalAuthMeta(method) {
    const terminalAuth = asRecord(authMethodMeta(method)?.["terminal-auth"]);
    if (!terminalAuth)
        return null;
    if (typeof terminalAuth.command !== "string" || terminalAuth.command.length === 0)
        return null;
    const env = stringRecord(terminalAuth.env);
    return {
        label: typeof terminalAuth.label === "string" && terminalAuth.label.length > 0
            ? terminalAuth.label
            : authMethodName(method) ?? "Login",
        command: terminalAuth.command,
        args: stringArray(terminalAuth.args),
        ...(env ? { env } : {}),
    };
}
function parseGeneratedShellShimCommand(command) {
    try {
        const text = readFileSync(command, "utf8");
        const execLine = text.split("\n").find((line) => line.startsWith("exec ") && line.includes('"$@"'));
        if (!execLine)
            return null;
        const match = execLine.match(/^exec\s+'([^']+)'(?:\s|$)/);
        return match?.[1] ?? null;
    }
    catch {
        return null;
    }
}
function terminalAuthCommand(command) {
    return parseGeneratedShellShimCommand(command) ?? command;
}
function terminalAuthFromMethod(method, agent, env, cwd) {
    const metaAuth = terminalAuthMeta(method);
    if (metaAuth)
        return { ...metaAuth, cwd };
    if (authMethodType(method) !== "terminal")
        return null;
    const terminalMethod = method;
    const meta = authMethodMeta(method);
    const methodEnv = stringRecord(terminalMethod.env) ?? {};
    const metaEnv = stringRecord(meta?.env) ?? {};
    const metaArgs = meta ? stringArray(meta.args) : [];
    const command = meta && typeof meta.command === "string" && meta.command.length > 0
        ? meta.command
        : terminalAuthCommand(agent.command);
    return {
        label: authMethodName(method) ?? "Login",
        command,
        args: metaArgs.length > 0 ? metaArgs : stringArray(terminalMethod.args),
        env: { ...env, ...methodEnv, ...metaEnv },
        cwd,
    };
}
function authEnvVars(method) {
    if (authMethodType(method) !== "env_var")
        return undefined;
    const vars = method.vars;
    if (!Array.isArray(vars))
        return undefined;
    const normalized = vars.flatMap((item) => {
        const typed = asRecord(item);
        if (!typed || typeof typed.name !== "string" || typed.name.length === 0)
            return [];
        return [{
                name: typed.name,
                ...(typeof typed.label === "string" && typed.label.length > 0 ? { label: typed.label } : {}),
                ...(typeof typed.secret === "boolean" ? { secret: typed.secret } : {}),
                ...(typeof typed.optional === "boolean" ? { optional: typed.optional } : {}),
            }];
    });
    return normalized.length > 0 ? normalized : undefined;
}
function authMethodLink(method) {
    const link = method.link;
    return typeof link === "string" && link.length > 0 ? link : undefined;
}
function apiKeyAuthMeta(method) {
    return asRecord(authMethodMeta(method)?.["api-key"]) ?? null;
}
function gatewayAuthMeta(method) {
    return asRecord(authMethodMeta(method)?.gateway) ?? null;
}
function authFormVars(method) {
    if (apiKeyAuthMeta(method)) {
        return [{ name: "api-key", label: "API key", secret: true }];
    }
    if (gatewayAuthMeta(method)) {
        return [
            { name: "baseUrl", label: "Base URL" },
            { name: "api-key", label: "API key", secret: true },
            { name: "providerName", label: "Provider", optional: true },
        ];
    }
    return undefined;
}
function authenticateMetaFromMethod(method, values) {
    if (gatewayAuthMeta(method)) {
        const baseUrl = (values.baseUrl ?? "").trim();
        const apiKey = (values["api-key"] ?? "").trim();
        const providerName = (values.providerName ?? "").trim();
        if (!baseUrl)
            return undefined;
        return {
            gateway: {
                baseUrl,
                headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
                ...(providerName ? { providerName } : {}),
            },
        };
    }
    if (apiKeyAuthMeta(method)) {
        const apiKey = (values["api-key"] ?? "").trim();
        return apiKey ? { "api-key": { apiKey } } : undefined;
    }
    return undefined;
}
function selectAuthMethod(authMethods, methodId) {
    const methods = supportedAuthMethods(authMethods);
    if (!methodId)
        return methods[0] ?? null;
    return methods.find((method) => method.id === methodId) ?? null;
}
function authMethodName(method) {
    if (!method)
        return undefined;
    const name = method.name;
    return typeof name === "string" && name.length > 0 ? name : undefined;
}
function authMethodDescription(method) {
    if (!method)
        return undefined;
    const description = method.description;
    return typeof description === "string" && description.length > 0 ? description : undefined;
}
function inferredCredentialVars(method) {
    const description = authMethodDescription(method);
    if (!description || !/\benvironment variable\b|\benv(?:ironment)? var\b/i.test(description)) {
        return undefined;
    }
    const names = [...new Set([...description.matchAll(/\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/g)]
            .map((match) => match[1])
            .filter((name) => typeof name === "string" && name.length > 0))];
    if (names.length === 0)
        return undefined;
    return names.map((name) => ({
        name,
        secret: /(?:^|_)(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)(?:_|$)/.test(name),
    }));
}
function credentialVars(method) {
    return authEnvVars(method) ?? inferredCredentialVars(method);
}
function isCredentialPromptAuthMethod(method) {
    const type = authMethodType(method);
    return type === "env_var" || (type === "terminal" && Boolean(inferredCredentialVars(method)));
}
function credentialVariableNames(method) {
    const names = credentialVars(method)?.map((item) => item.name).join(", ");
    return names && names.length > 0 ? names : undefined;
}
function missingCredentialVariableNames(method, env) {
    return (credentialVars(method) ?? [])
        .filter((variable) => variable.optional !== true)
        .map((variable) => variable.name)
        .filter((name) => !env[name]);
}
function publicAuthMethods(methods, agent, env, cwd) {
    return methods.map((method) => {
        const formVars = authFormVars(method);
        const vars = formVars ?? credentialVars(method);
        const type = isCredentialPromptAuthMethod(method) ? "env_var" : authMethodType(method);
        const terminalLaunch = type === "terminal"
            ? terminalAuthFromMethod(method, agent, env, cwd)
            : null;
        return {
            id: method.id,
            ...(authMethodName(method) ? { name: authMethodName(method) } : {}),
            ...(authMethodDescription(method) ? { description: authMethodDescription(method) } : {}),
            type,
            ...(formVars ? { form: "fields" } : {}),
            ...(vars ? { vars } : {}),
            ...(authMethodLink(method) ? { link: authMethodLink(method) } : {}),
            ...(terminalLaunch ? { terminalLaunch } : {}),
        };
    });
}
function authMethodStatusFields(method, methods, agent, env, cwd) {
    const methodName = authMethodName(method);
    return {
        methodId: method.id,
        ...(methodName ? { methodName } : {}),
        methods: publicAuthMethods(methods, agent, env, cwd),
    };
}
function acpErrorMessage(error) {
    const data = asRecord(error?.data);
    if (typeof data?.details === "string" && data.details.length > 0)
        return data.details;
    if (typeof data?.message === "string" && data.message.length > 0)
        return data.message;
    const message = error?.message;
    if (typeof message === "string" && message.length > 0)
        return message;
    return String(error);
}
function withAcpDetails(error) {
    const message = acpErrorMessage(error);
    if (error instanceof Error && message === error.message)
        return error;
    const next = new Error(message);
    if (error && typeof error === "object") {
        const code = error.code;
        const data = error.data;
        if (typeof code === "number")
            next.code = code;
        if (data !== undefined)
            next.data = data;
    }
    return next;
}
function mergedStringEnv(...envs) {
    const out = {};
    for (const env of envs) {
        for (const [key, value] of Object.entries(env ?? {})) {
            if (typeof value === "string")
                out[key] = value;
        }
    }
    return out;
}
function stringArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}
function stringRecord(value) {
    const record = asRecord(value);
    if (!record)
        return undefined;
    const entries = Object.entries(record).filter((entry) => typeof entry[1] === "string");
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
function envArrayToRecord(env) {
    if (!Array.isArray(env))
        return undefined;
    const entries = env.filter((entry) => (typeof entry.name === "string"
        && entry.name.length > 0
        && typeof entry.value === "string")).map((entry) => [entry.name, entry.value]);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
function configOptionsFromResponse(value) {
    return Array.isArray(value?.configOptions)
        ? value.configOptions.map((option) => structuredClone(option))
        : [];
}
function configOptionsFromSessionUpdate(update) {
    const typed = asRecord(update);
    if (!typed || typed.sessionUpdate !== "config_option_update" || !Array.isArray(typed.configOptions)) {
        return null;
    }
    return typed.configOptions.map((option) => structuredClone(option));
}
function availableCommandsFromSessionUpdate(update) {
    const typed = asRecord(update);
    if (!typed || typed.sessionUpdate !== "available_commands_update")
        return null;
    const commands = Array.isArray(typed.availableCommands)
        ? typed.availableCommands
        : Array.isArray(typed.available_commands)
            ? typed.available_commands
            : null;
    return commands?.map((command) => structuredClone(command)) ?? null;
}
function modesFromResponse(value) {
    return value?.modes ? structuredClone(value.modes) : null;
}
function modeFromSessionUpdate(update) {
    const typed = asRecord(update);
    if (!typed || typed.sessionUpdate !== "current_mode_update" || typeof typed.currentModeId !== "string") {
        return null;
    }
    return typed.currentModeId;
}
function isAuthFailureMessage(message) {
    return typeof message === "string"
        && /authentication required\b|authentication fails\b|invalid api key|api key[:\s=][^\n]*\binvalid\b/i.test(message);
}
function unauthenticatedDiagnostic(lines) {
    for (const line of lines) {
        const plain = line.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "").trim();
        if (/\bcreating session without credentials\b/i.test(plain)) {
            return plain.replace(/^.*?\bcreating session without credentials\b/i, "Creating session without credentials");
        }
        if (/\bagent may not work\b/i.test(plain) && /\bcredentials?\b/i.test(plain)) {
            return plain;
        }
    }
    return null;
}
async function allowDiagnosticsToFlush() {
    await new Promise((resolve) => setTimeout(resolve, 25));
}
//# sourceMappingURL=probe.js.map