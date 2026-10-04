import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, delimiter, dirname, join } from "node:path";
import { detectEntry, getKnownAgents, loadRegistry, } from "./registry.js";
import { installAcpRegistryAgent, installManagedAdapter, latestNpmPackageVersion, npmPackageNameFromSpec, readAcpHarnessInstallState, repairRelocatedAcpRegistryShim, uninstallAcpRegistryAgent, uninstallManagedAdapter, usesOpenMaNpmLatestSource, } from "./installer.js";
import { authenticateAgent, disposeAllAcpProbes, probeAgentSessionConfig, probeAgentAuthStatus, } from "../acp-runtime/probe.js";
const NO_LIVE_PROBE_PLAN = {
    trigger: "list",
    refreshRegistry: false,
    auth: { target: "ids", ids: [] },
    capabilities: { target: "ids", ids: [] },
};
export function createAcpAgentSetupService(deps) {
    return new AcpAgentSetupServiceImpl(deps);
}
class AcpAgentSetupServiceImpl {
    deps;
    nextOperationId = 1;
    probeCachePromise = null;
    probeCacheWrite = Promise.resolve();
    authCache = new Map();
    capabilityInspections = new Map();
    constructor(deps) {
        this.deps = deps;
    }
    dispose() {
        return disposeAllAcpProbes();
    }
    async warmup() {
        await this.repairRelocatedRegistryShims();
        await this.collectAgentSnapshot({
            trigger: "startup",
            refreshRegistry: true,
            auth: { target: "ids", ids: [] },
            capabilities: { target: "detected" },
        });
    }
    async repairRelocatedRegistryShims() {
        const entries = this.catalogEntries().filter((entry) => entry.installSource === "registry" && entry.registryId);
        await Promise.all(entries.map(async (entry) => {
            try {
                await repairRelocatedAcpRegistryShim({
                    registryId: entry.registryId,
                    shimName: basename(entry.spec.command),
                    binDir: this.deps.acpBinDir,
                    installRoot: this.deps.acpInstallRoot,
                });
            }
            catch (error) {
                if (process.env.NODE_ENV !== "test") {
                    process.stderr.write(`! ACP shim repair skipped for ${entry.id}: ${errorMessage(error)}\n`);
                }
            }
        }));
    }
    async refreshEnabledAgents() {
        const enabledAgentIds = this.deps.getEnabledAgentIds?.() ?? [];
        return this.collectAgentSnapshot({
            trigger: "manual",
            refreshRegistry: true,
            auth: { target: "ids", ids: enabledAgentIds },
            capabilities: { target: "ids", ids: enabledAgentIds },
        });
    }
    async listAgents() {
        return this.collectAgentSnapshot(NO_LIVE_PROBE_PLAN);
    }
    async collectAgentSnapshot(plan) {
        const operationId = `setup-${this.nextOperationId++}`;
        const operationStartedAt = Date.now();
        await this.refreshRegistry({ refresh: plan.refreshRegistry });
        const probeCache = await this.loadProbeCache();
        const entries = this.catalogEntries();
        const detected = (await Promise.all(entries.map((entry) => detectEntry(entry, this.resolveOptions()))))
            .filter((entry) => entry !== null);
        const detectedById = new Map(detected.map((agent) => [agent.id, agent]));
        const authAgentIds = new Set(plan.auth.target === "ids" ? plan.auth.ids : []);
        const capabilityAgentIds = new Set(plan.capabilities.target === "ids" ? plan.capabilities.ids : []);
        const result = await Promise.all(entries.map(async (entry) => {
            const detectedEntry = detectedById.get(entry.id);
            const shouldProbeAuth = Boolean(detectedEntry) &&
                (plan.auth.target === "detected" || authAgentIds.has(entry.id));
            let auth = detectedEntry ? this.authCache.get(entry.id) : undefined;
            const shouldProbeCapabilities = Boolean(detectedEntry) &&
                (plan.capabilities.target === "detected"
                    || capabilityAgentIds.has(entry.id));
            let sessionConfig;
            if (detectedEntry && shouldProbeCapabilities) {
                const startedAt = Date.now();
                let outcome = "settled";
                let errorDetail;
                logSetupOperation({
                    operationId,
                    trigger: plan.trigger,
                    scope: "full",
                    agentId: entry.id,
                    outcome: "started",
                    durationMs: 0,
                });
                try {
                    sessionConfig = await this.probeSessionConfig(detectedEntry);
                    auth = setupAuthFromProbeStatus(sessionConfig.auth);
                    if (auth) {
                        this.authCache.set(entry.id, auth);
                    }
                    else {
                        this.authCache.delete(entry.id);
                    }
                    this.capabilityInspections.set(entry.id, {
                        status: setupAuthBlocksCapabilities(auth)
                            ? "blocked-auth"
                            : "ready",
                        inspected_at: new Date().toISOString(),
                    });
                }
                catch (error) {
                    outcome = "degraded";
                    errorDetail = errorMessage(error);
                    this.capabilityInspections.set(entry.id, {
                        status: "degraded",
                        error: errorDetail,
                        inspected_at: new Date().toISOString(),
                    });
                    // Keep the last confirmed state across a transient probe failure.
                }
                finally {
                    logSetupOperation({
                        operationId,
                        trigger: plan.trigger,
                        scope: "full",
                        agentId: entry.id,
                        outcome,
                        durationMs: Date.now() - startedAt,
                        ...(errorDetail ? { detail: errorDetail } : {}),
                    });
                }
            }
            else if (detectedEntry && shouldProbeAuth) {
                const startedAt = Date.now();
                let outcome = "settled";
                logSetupOperation({
                    operationId,
                    trigger: plan.trigger,
                    scope: "auth",
                    agentId: entry.id,
                    outcome: "started",
                    durationMs: 0,
                });
                try {
                    auth = await this.probeAuth(detectedEntry);
                    if (auth) {
                        this.authCache.set(entry.id, auth);
                    }
                    else {
                        this.authCache.delete(entry.id);
                    }
                }
                catch {
                    outcome = "degraded";
                    // Keep the last confirmed state across a transient probe failure.
                }
                finally {
                    logSetupOperation({
                        operationId,
                        trigger: plan.trigger,
                        scope: "auth",
                        agentId: entry.id,
                        outcome,
                        durationMs: Date.now() - startedAt,
                    });
                }
            }
            const cachedProbe = detectedEntry ? probeCache[entry.id] : undefined;
            if (!auth && cachedProbe?.auth) {
                auth = cachedProbe.auth;
                this.authCache.set(entry.id, auth);
            }
            const usableSessionConfig = sessionConfig && !setupAuthBlocksCapabilities(auth)
                ? sessionConfig
                : undefined;
            if (usableSessionConfig) {
                await this.persistProbe(entry.id, {
                    config_options: usableSessionConfig.configOptions,
                    available_commands: usableSessionConfig.availableCommands,
                    ...(usableSessionConfig.modes
                        ? { session_modes: usableSessionConfig.modes }
                        : {}),
                    ...(auth ? { auth } : {}),
                });
            }
            else if (auth && (shouldProbeAuth || shouldProbeCapabilities)) {
                await this.persistProbe(entry.id, { auth });
            }
            const configOptions = usableSessionConfig?.configOptions ??
                cachedProbe?.config_options ??
                entry.configOptions;
            const availableCommands = usableSessionConfig?.availableCommands ??
                cachedProbe?.available_commands;
            const sessionModes = usableSessionConfig?.modes ??
                cachedProbe?.session_modes;
            const installInfo = await readAcpHarnessInstallState({
                entry,
                binDir: this.deps.acpBinDir,
                installRoot: this.deps.acpInstallRoot,
                fetchImpl: this.deps.fetchImpl,
                npmRegistryUrls: this.deps.npmRegistryUrls,
            });
            return {
                id: entry.id,
                label: entry.label,
                ...(entry.icon ? { icon: entry.icon } : {}),
                command: detectedEntry?.spec.command ?? entry.spec.command,
                installHint: entry.installHint,
                homepage: entry.homepage,
                featured: entry.featured,
                detected: !!detectedEntry,
                available: !!detectedEntry,
                installed: installInfo.installed,
                ...(installInfo.installedVersion ? { installedVersion: installInfo.installedVersion } : {}),
                ...(installInfo.latestVersion ? { latestVersion: installInfo.latestVersion } : {}),
                ...(installInfo.updateAvailable ? { updateAvailable: true } : {}),
                installable: !entry.custom && Boolean(entry.installSource || entry.downloadUrl || entry.install),
                ...(entry.installSource ? { installSource: entry.installSource } : {}),
                ...(entry.custom ? { custom: true } : {}),
                ...(auth ? { auth } : {}),
                ...(configOptions ? { config_options: configOptions } : {}),
                ...(availableCommands ? { available_commands: availableCommands } : {}),
                ...(sessionModes ? { session_modes: sessionModes } : {}),
                ...(detectedEntry && this.capabilityInspections.has(entry.id)
                    ? {
                        capability_inspection: this.capabilityInspections.get(entry.id),
                    }
                    : {}),
            };
        }));
        logSetupOperation({
            operationId,
            trigger: plan.trigger,
            scope: "snapshot",
            agentId: "*",
            outcome: "settled",
            durationMs: Date.now() - operationStartedAt,
        });
        return result;
    }
    async installAgent(id) {
        await this.refreshRegistry({ refresh: true });
        const entry = this.requireEntry(id);
        const targetVersion = await this.resolveManagedInstallTargetVersion(entry);
        await this.installEntry(entry, targetVersion);
        return this.collectAgentSnapshot({
            trigger: "install",
            refreshRegistry: false,
            auth: { target: "ids", ids: [id] },
            capabilities: { target: "ids", ids: [id] },
        });
    }
    async upgradeAgent(id) {
        await this.refreshRegistry({ refresh: false });
        const entry = this.requireEntry(id);
        const installInfo = await readAcpHarnessInstallState({
            entry,
            binDir: this.deps.acpBinDir,
            installRoot: this.deps.acpInstallRoot,
            fetchImpl: this.deps.fetchImpl,
            npmRegistryUrls: this.deps.npmRegistryUrls,
        });
        if (!installInfo.installed) {
            throw new Error(`${entry.label} is not installed by ${this.managedByName()}`);
        }
        const targetVersion = await this.resolveManagedInstallTargetVersion(entry, installInfo.latestVersion);
        await this.installEntry(entry, targetVersion);
        return this.collectAgentSnapshot({
            trigger: "update",
            refreshRegistry: false,
            auth: { target: "ids", ids: [id] },
            capabilities: { target: "ids", ids: [id] },
        });
    }
    async resolveManagedInstallTargetVersion(entry, registryLatestVersion) {
        if (usesOpenMaNpmLatestSource(entry) && entry.registryDistribution?.npx) {
            const packageName = npmPackageNameFromSpec(entry.registryDistribution.npx.package);
            const latest = await latestNpmPackageVersion(packageName, {
                fetchImpl: this.deps.fetchImpl,
                npmRegistryUrls: this.deps.npmRegistryUrls,
            });
            if (!latest) {
                throw new Error(`Could not resolve npm latest version for ${packageName}`);
            }
            return latest;
        }
        return registryLatestVersion ?? entry.version;
    }
    async installEntry(entry, targetVersion) {
        if (entry.installSource === "registry") {
            if (!entry.registryId)
                throw new Error(`${entry.label} is missing an ACP registry id`);
            const registryDistribution = targetVersion && entry.registryDistribution?.npx
                ? {
                    ...entry.registryDistribution,
                    npx: {
                        ...entry.registryDistribution.npx,
                        package: `${npmPackageNameFromSpec(entry.registryDistribution.npx.package)}@${targetVersion}`,
                    },
                }
                : entry.registryDistribution;
            await installAcpRegistryAgent({
                registryId: entry.registryId,
                ...(registryDistribution ? {
                    registryAgent: {
                        id: entry.registryId,
                        name: entry.label,
                        ...(targetVersion
                            ? { version: targetVersion }
                            : entry.version
                                ? { version: entry.version }
                                : {}),
                        distribution: registryDistribution,
                    },
                } : {}),
                shimName: basename(entry.spec.command),
                binDir: this.deps.acpBinDir,
                installRoot: this.deps.acpInstallRoot,
                fetchImpl: this.deps.fetchImpl,
                npmCommand: this.deps.npmCommand,
                npmCommandArgs: this.deps.npmCommandArgs,
                npmEnv: this.deps.npmEnv,
                npmRegistryUrls: this.deps.npmRegistryUrls,
                shimArgs: entry.spec.args,
                shimEnv: entry.spec.env,
                env: this.spawnEnv(),
            });
        }
        else if (entry.installSource === "adapter" && entry.downloadUrl) {
            await installManagedAdapter({
                id: entry.id,
                label: entry.label,
                command: entry.spec.command,
                args: entry.spec.args,
                downloadUrl: entry.downloadUrl,
                binDir: this.deps.acpBinDir,
                fetchImpl: this.deps.fetchImpl,
            });
        }
        else {
            throw new Error(`${entry.label} is not installable from ${this.managedByName()}`);
        }
    }
    async uninstallAgent(id) {
        await this.refreshRegistry({ refresh: true });
        const entry = this.requireEntry(id);
        if (entry.installSource === "registry") {
            if (!entry.registryId)
                throw new Error(`${entry.label} is missing an ACP registry id`);
            await uninstallAcpRegistryAgent({
                registryId: entry.registryId,
                shimName: basename(entry.spec.command),
                binDir: this.deps.acpBinDir,
                installRoot: this.deps.acpInstallRoot,
            });
        }
        else if (entry.installSource === "adapter") {
            await uninstallManagedAdapter({
                command: entry.spec.command,
                binDir: this.deps.acpBinDir,
            });
        }
        else {
            throw new Error(`${entry.label} is not managed by ${this.managedByName()}`);
        }
        this.authCache.delete(id);
        return this.collectAgentSnapshot({
            ...NO_LIVE_PROBE_PLAN,
            trigger: "uninstall",
            refreshRegistry: true,
        });
    }
    async authenticateAgent(id, options = {}) {
        await this.refreshRegistry({ refresh: false });
        const entry = await this.detectCatalogEntry(id);
        if (!entry)
            throw new Error(`ACP agent is not available: ${id}`);
        const result = await authenticateAgent({
            agent: entry.spec,
            env: this.spawnEnv(),
            ...(this.deps.probeCwd ? { cwd: this.deps.probeCwd } : {}),
            timeoutMs: 120_000,
            agentAuthLaunchGraceMs: 2_000,
            backgroundAuthTimeoutMs: 10 * 60_000,
            methodId: options.methodId,
            ...(options.secret ? { secret: options.secret } : {}),
            ...(options.values ? { values: options.values } : {}),
            ...(options.gateway ? { gateway: options.gateway } : {}),
            launchInteractiveAuth: this.deps.launchInteractiveAuth,
        });
        if (result.status === "completed") {
            const existing = this.authCache.get(id);
            const auth = {
                status: "configured",
                message: "Authentication completed",
                ...(options.methodId
                    ? { methodId: options.methodId }
                    : existing?.methodId
                        ? { methodId: existing.methodId }
                        : {}),
                ...(existing?.methodName ? { methodName: existing.methodName } : {}),
                ...(existing?.methods ? { methods: existing.methods } : {}),
            };
            this.authCache.set(id, auth);
            await this.persistProbe(id, { auth });
        }
        // Authentication is an explicit lifecycle of its own. Do not follow it
        // with another disposable ACP probe; the next real session is the source
        // of truth if a browser/terminal flow is still finishing.
        return this.listAgents();
    }
    async observeAuth(id, observation) {
        const auth = mergeObservedAuth(this.authCache.get(id), observation);
        this.authCache.set(id, auth);
        await this.persistProbe(id, { auth });
        return auth;
    }
    async observeSessionConfig(id, snapshot) {
        await this.persistProbe(id, snapshot);
    }
    async refreshRegistry(options) {
        if (this.deps.refreshRegistry) {
            await this.deps.refreshRegistry({ refresh: options.refresh });
            return;
        }
        await loadRegistry({
            cachePath: this.deps.registryCachePath,
            forceRefresh: options.refresh === true,
            cacheOnly: options.refresh !== true,
        }).catch(() => undefined);
    }
    resolveOptions() {
        return {
            env: this.spawnEnv(),
            managedBinDirs: [this.deps.acpBinDir],
        };
    }
    spawnEnv() {
        const path = [this.deps.acpBinDir, process.env.PATH].filter(Boolean).join(delimiter);
        return {
            ...process.env,
            ...this.deps.env,
            // A setup probe is a fresh harness process. Do not let a parent Claude
            // session make the child believe it is already running inside one.
            CLAUDECODE: undefined,
            CLAUDE_CODE_ENTRYPOINT: undefined,
            CLAUDE_CODE_SSE_PORT: undefined,
            OPENMA_ACP_BIN_DIR: this.deps.acpBinDir,
            PATH: path,
        };
    }
    requireEntry(id) {
        const entry = this.catalogEntries().find((candidate) => candidate.id === id);
        if (!entry)
            throw new Error(`Unknown ACP agent: ${id}`);
        return entry;
    }
    catalogEntries() {
        return catalogEntriesWithOverrides(getKnownAgents(), this.deps.agentOverrides?.() ?? []);
    }
    async detectCatalogEntry(id) {
        const entry = this.catalogEntries().find((candidate) => candidate.id === id);
        if (!entry)
            return null;
        return await detectEntry(entry, this.resolveOptions());
    }
    async probeAuth(entry) {
        const status = await probeAgentAuthStatus({
            agent: entry.spec,
            env: this.spawnEnv(),
            ...(this.deps.probeCwd ? { cwd: this.deps.probeCwd } : {}),
            timeoutMs: this.deps.authInspectionTimeoutMs ?? 15_000,
        });
        return setupAuthFromProbeStatus(status);
    }
    async probeSessionConfig(entry) {
        return probeAgentSessionConfig({
            agent: entry.spec,
            env: this.spawnEnv(),
            ...(this.deps.probeCwd ? { cwd: this.deps.probeCwd } : {}),
            timeoutMs: this.deps.capabilityInspectionTimeoutMs ?? 90_000,
        });
    }
    probeCachePath() {
        return this.deps.probeCachePath ??
            join(dirname(this.deps.registryCachePath), "agent-probe-cache.json");
    }
    loadProbeCache() {
        if (this.probeCachePromise)
            return this.probeCachePromise;
        this.probeCachePromise = readFile(this.probeCachePath(), "utf8")
            .then((raw) => parseProbeCache(raw))
            .catch(() => ({}));
        return this.probeCachePromise;
    }
    async persistProbe(id, patch) {
        const cache = await this.loadProbeCache();
        const prev = cache[id];
        cache[id] = {
            config_options: patch.config_options ?? prev?.config_options ?? [],
            available_commands: patch.available_commands ?? prev?.available_commands ?? [],
            ...(patch.session_modes !== undefined
                ? { session_modes: patch.session_modes }
                : prev?.session_modes
                    ? { session_modes: prev.session_modes }
                    : {}),
            ...(patch.auth ? { auth: patch.auth } : prev?.auth ? { auth: prev.auth } : {}),
            updated_at: new Date().toISOString(),
        };
        const path = this.probeCachePath();
        const tempPath = `${path}.tmp-${process.pid}`;
        const serialized = JSON.stringify({ version: 1, agents: cache }, null, 2);
        const write = async () => {
            await mkdir(dirname(path), { recursive: true });
            await writeFile(tempPath, serialized, "utf8");
            await rename(tempPath, path);
        };
        this.probeCacheWrite = this.probeCacheWrite.then(write, write);
        await this.probeCacheWrite;
    }
    managedByName() {
        return this.deps.managedByName?.trim() || "this host";
    }
}
function parseProbeCache(raw) {
    const parsed = JSON.parse(raw);
    if (parsed.version !== 1 || !parsed.agents || typeof parsed.agents !== "object") {
        return {};
    }
    return Object.fromEntries(Object.entries(parsed.agents).flatMap(([id, value]) => Array.isArray(value.config_options) && Array.isArray(value.available_commands)
        ? [[id, {
                    config_options: value.config_options,
                    available_commands: value.available_commands,
                    ...(value.session_modes ? { session_modes: value.session_modes } : {}),
                    ...(value.auth ? { auth: value.auth } : {}),
                    updated_at: typeof value.updated_at === "string" ? value.updated_at : "",
                }]]
        : value.auth
            ? [[id, {
                        config_options: Array.isArray(value.config_options) ? value.config_options : [],
                        available_commands: Array.isArray(value.available_commands)
                            ? value.available_commands
                            : [],
                        ...(value.session_modes ? { session_modes: value.session_modes } : {}),
                        auth: value.auth,
                        updated_at: typeof value.updated_at === "string" ? value.updated_at : "",
                    }]]
            : []));
}
function catalogEntriesWithOverrides(entries, overrides) {
    const overrideById = new Map(overrides.map((override) => [override.id, override]));
    const knownIds = new Set(entries.map((entry) => entry.id));
    const merged = entries.map((entry) => applyAgentOverride(entry, overrideById.get(entry.id)));
    for (const override of overrides) {
        if (knownIds.has(override.id))
            continue;
        const command = override.command?.trim();
        if (!command)
            continue;
        const env = overrideEnv(override);
        merged.push({
            id: override.id,
            label: override.label?.trim() || override.id,
            spec: {
                command,
                ...(override.args ? { args: [...override.args] } : {}),
                ...(env ? { env } : {}),
            },
            custom: true,
        });
    }
    return merged;
}
function applyAgentOverride(entry, override) {
    if (!override)
        return entry;
    const env = {
        ...(entry.spec.env ?? {}),
        ...(overrideEnv(override) ?? {}),
    };
    return {
        ...entry,
        ...(override.label?.trim() ? { label: override.label.trim() } : {}),
        spec: {
            ...entry.spec,
            ...(override.command?.trim() ? { command: override.command.trim() } : {}),
            ...(override.args ? { args: [...override.args] } : {}),
            ...(Object.keys(env).length > 0 ? { env } : {}),
        },
    };
}
function overrideEnv(override) {
    if (!override.env)
        return undefined;
    const entries = Array.isArray(override.env)
        ? override.env
            .filter((item) => item.name.length > 0)
            .map((item) => [item.name, item.value])
        : Object.entries(override.env)
            .filter((entry) => entry[0].length > 0 && typeof entry[1] === "string");
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
function mergeObservedAuth(existing, observation) {
    const methodId = observation.methodId ?? existing?.methodId;
    const prefix = observation.status === "configured"
        ? methodId ? `ACP auth is configured (${methodId}).` : "ACP auth is configured."
        : observation.status === "needs-auth"
            ? methodId ? `Authentication required (${methodId}).` : "Authentication required."
            : "Could not verify auth.";
    return {
        status: observation.status,
        message: observation.message ?? prefix,
        ...(methodId ? { methodId } : {}),
        ...(existing?.methodName ? { methodName: existing.methodName } : {}),
        ...(existing?.methods ? { methods: existing.methods } : {}),
    };
}
function setupAuthFromProbeStatus(status) {
    if (status.status === "none")
        return undefined;
    const method = status.methodName ?? status.methodId;
    const prefix = status.status === "configured"
        ? method ? `ACP auth is configured (${method}).` : "ACP auth is configured."
        : status.status === "needs-auth"
            ? method ? `Authentication required (${method}).` : "Authentication required."
            : "Could not verify auth.";
    return {
        status: status.status,
        message: status.message ? `${prefix} ${status.message}` : prefix,
        ...(status.methodId ? { methodId: status.methodId } : {}),
        ...(status.methodName ? { methodName: status.methodName } : {}),
        ...(status.methods ? { methods: status.methods.map((methodInfo) => ({
                id: methodInfo.id,
                ...(methodInfo.name ? { name: methodInfo.name } : {}),
                ...(methodInfo.description ? { description: methodInfo.description } : {}),
                ...(methodInfo.type ? { type: methodInfo.type } : {}),
                ...(methodInfo.form ? { form: methodInfo.form } : {}),
                ...(methodInfo.vars ? { vars: methodInfo.vars } : {}),
                ...(methodInfo.link ? { link: methodInfo.link } : {}),
            })) } : {}),
    };
}
function setupAuthBlocksCapabilities(auth) {
    return auth?.status === "needs-auth" || auth?.status === "unknown";
}
function logSetupOperation(fields) {
    if (process.env.NODE_ENV === "test")
        return;
    const detail = fields.detail
        ? ` error=${JSON.stringify(fields.detail.replace(/\s+/g, " ").slice(0, 500))}`
        : "";
    process.stderr.write(`[agent-lifecycle] op=${fields.operationId} trigger=${fields.trigger} scope=${fields.scope} agent=${fields.agentId} outcome=${fields.outcome} total_ms=${fields.durationMs}${detail}\n`);
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
export function launchTerminalAuth(options, launchOptions = {}) {
    const shellCommand = terminalAuthShellCommand(options, launchOptions.returnInstruction);
    if (process.platform === "darwin") {
        return spawnDetached("osascript", [
            "-e", `tell application "Terminal"`,
            "-e", "activate",
            "-e", `do script ${JSON.stringify(shellCommand)}`,
            "-e", "end tell",
        ], options.env);
    }
    const terminal = process.platform === "win32" ? null : (process.env.TERMINAL || "x-terminal-emulator");
    if (!terminal) {
        throw new Error(`Interactive auth launch is not supported on ${process.platform}. Run ${[options.command, ...options.args].join(" ")} manually.`);
    }
    return spawnDetached(terminal, ["-e", "sh", "-lc", shellCommand], options.env);
}
function spawnDetached(command, args, env) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            env: {
                ...process.env,
                ...Object.fromEntries(Object.entries(env ?? {}).filter((entry) => typeof entry[1] === "string")),
            },
            detached: true,
            stdio: "ignore",
        });
        child.once("error", reject);
        child.once("spawn", () => {
            child.unref();
            resolve();
        });
    });
}
function terminalAuthShellCommand(options, returnInstruction) {
    const parts = [];
    if (options.cwd) {
        parts.push("cd", shellQuote(options.cwd), "&&");
    }
    const envEntries = Object.entries(options.env ?? {})
        .filter((entry) => typeof entry[1] === "string" && entry[0].length > 0);
    if (envEntries.length > 0) {
        parts.push("env");
        for (const [key, value] of envEntries)
            parts.push(`${key}=${shellQuote(value)}`);
    }
    parts.push(shellQuote(options.command), ...options.args.map(shellQuote));
    if (returnInstruction?.trim()) {
        parts.push(";");
        parts.push("printf", shellQuote(`\\n${returnInstruction.trim()}\\n`));
    }
    return parts.join(" ");
}
function shellQuote(value) {
    return `'${value.replace(/'/g, "'\\''")}'`;
}
//# sourceMappingURL=agent-setup.js.map