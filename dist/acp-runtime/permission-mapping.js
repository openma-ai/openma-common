/** Every error is a dispatch barrier for the caller; none permits a prompt. */
export class AcpPermissionModeError extends Error {
    code;
    outcome;
    effectiveModeId;
    name = "AcpPermissionModeError";
    /** Unknown outcome means the remote may have changed mode; never auto-retry. */
    constructor(code, message, outcome, effectiveModeId, options) {
        super(message, options);
        this.code = code;
        this.outcome = outcome;
        this.effectiveModeId = effectiveModeId;
    }
}
// Exact adapter versions only, not inferred semver ranges or executable names.
// See docs/acp-permission-mapping.md for immutable source SHAs and semantics.
const profiles = [
    { id: "claude-acp", name: "@agentclientprotocol/claude-agent-acp", versions: ["0.75.1", "0.94.0"],
        modes: { always_ask: "default", auto: "auto", always_allow: "bypassPermissions" } },
    { id: "codex-acp", name: "@agentclientprotocol/codex-acp", versions: ["1.8.0", "1.10.0"],
        modes: { always_ask: "read-only", auto: "agent", always_allow: "agent-full-access" } },
];
// Held until the RPC settles, including after a local abort/deadline. A second
// write cannot race the late first write through this helper. Other setters
// remain the supervisor's responsibility to serialize.
const pending = new WeakSet();
function modeOption(options) {
    if (!Array.isArray(options))
        return;
    const candidates = options.filter(o => o && o.id === "mode");
    if (candidates.length !== 1)
        return;
    const option = candidates[0];
    if (!option || option.type !== "select" || option.category !== "mode"
        || typeof option.currentValue !== "string" || !Array.isArray(option.options))
        return;
    const available = [];
    for (const entry of option.options) {
        if (!entry || typeof entry !== "object")
            return;
        const choices = "options" in entry ? entry.options : [entry];
        if (!Array.isArray(choices))
            return;
        for (const choice of choices) {
            if (!choice || typeof choice.value !== "string")
                return;
            available.push(choice.value);
        }
    }
    if (new Set(available).size !== available.length)
        return;
    return { current: option.currentValue, available };
}
/**
 * Opt-in, one-shot native mode application with authoritative ACP config
 * response verification. Never uses setMode(), legacy currentModeId, labels,
 * arbitrary _meta, or an empty set_mode ACK as proof. The supervisor MUST
 * await success before dispatch, serialize model/mode changes, and stop on
 * any failure or later native mode drift. This is not a lifetime policy lock.
 */
export async function applyAcpPermissionMode(session, options) {
    if (options.mode === undefined)
        return { status: "not-configured" };
    const { mode, harnessId, abortSignal, timeoutMs = 10_000 } = options;
    if (abortSignal?.aborted) {
        throw new AcpPermissionModeError("aborted", "Permission mode application aborted", "not-dispatched");
    }
    if (pending.has(session)) {
        throw new AcpPermissionModeError("busy", "A permission mode RPC is still pending", "not-dispatched");
    }
    const info = session.agentInfo;
    const profile = profiles.find(p => p.id === harnessId && p.name === info?.name
        && p.versions.includes(info.version));
    if (!profile || !info || !["always_ask", "auto", "always_allow"].includes(mode)
        || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
        throw new AcpPermissionModeError("unsupported", "Unproven harness/version, permission mode, or invalid deadline", "not-dispatched");
    }
    const nativeModeId = profile.modes[mode];
    const advertised = modeOption(session.configOptions);
    if (!advertised?.available.includes(nativeModeId) || typeof session.setConfigOption !== "function") {
        throw new AcpPermissionModeError("unsupported", `Native mode ${nativeModeId} has no verifiable advertised config option`, "not-dispatched");
    }
    pending.add(session);
    let timer;
    let onAbort;
    try {
        const interruption = new Promise((_, reject) => {
            onAbort = () => reject(new AcpPermissionModeError("aborted", "Permission mode application aborted; remote outcome unknown", "unknown"));
            abortSignal?.addEventListener("abort", onAbort, { once: true });
            timer = setTimeout(() => reject(new AcpPermissionModeError("timeout", "Permission mode readback timed out; remote outcome unknown", "unknown")), timeoutMs);
        });
        // Dispatch synchronously with admission checks. Promise wrapping observes
        // synchronous throws and late rejections; never calls session/cancel.
        let rpc;
        try {
            rpc = Promise.resolve(session.setConfigOption("mode", nativeModeId));
        }
        catch (cause) {
            rpc = Promise.reject(cause);
        }
        const settled = rpc.then(response => { pending.delete(session); return response; }, cause => {
            pending.delete(session);
            throw new AcpPermissionModeError("apply-failed", "Native permission mode request failed", "unknown", undefined, { cause });
        });
        const response = await Promise.race([settled, interruption]);
        if (abortSignal?.aborted) {
            throw new AcpPermissionModeError("aborted", "Permission mode application aborted; remote outcome unknown", "unknown");
        }
        // Only the RPC response proves this write. Also reject newer contradictory
        // state already observed by the runtime while the response was in flight.
        const readback = modeOption(response);
        const current = modeOption(session.configOptions);
        if (!readback || !current || !readback.available.includes(nativeModeId)
            || !current.available.includes(nativeModeId)) {
            throw new AcpPermissionModeError("unsupported", "Native permission mode response has no verifiable current value", "unknown");
        }
        if (readback.current !== nativeModeId || current.current !== nativeModeId) {
            const effective = readback.current !== nativeModeId ? readback.current : current.current;
            throw new AcpPermissionModeError("mode-mismatch", `Requested ${nativeModeId}, native mode is ${effective}`, "unknown", effective);
        }
        return { status: "applied", mode, nativeModeId, harnessId, version: info.version, verification: "session/set_config_option" };
    }
    finally {
        clearTimeout(timer);
        abortSignal?.removeEventListener("abort", onAbort);
    }
}
//# sourceMappingURL=permission-mapping.js.map