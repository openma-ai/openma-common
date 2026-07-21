import { spawn as nodeSpawn } from "node:child_process";
const activeChildren = new Set();
let cleanupHandlersInstalled = false;
function killProcessTree(child, signal, detached) {
    if (child.exitCode !== null || child.signalCode !== null)
        return;
    if (detached && child.pid !== undefined) {
        try {
            process.kill(-child.pid, signal);
            return;
        }
        catch {
            // The process may have exited between the state check and kill(2).
        }
    }
    child.kill(signal);
}
function cleanupActiveChildren(signal = "SIGTERM") {
    for (const managed of activeChildren) {
        killProcessTree(managed.child, signal, managed.detached);
    }
}
function installProcessCleanupHandlers() {
    if (cleanupHandlersInstalled)
        return;
    cleanupHandlersInstalled = true;
    process.once("exit", () => cleanupActiveChildren());
    for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) {
        const handler = () => {
            cleanupActiveChildren();
            if (process.listenerCount(signal) === 1) {
                process.off(signal, handler);
                process.kill(process.pid, signal);
            }
        };
        process.on(signal, handler);
    }
}
export class NodeSpawner {
    async spawn(spec) {
        installProcessCleanupHandlers();
        const merged = { ...process.env, ...(spec.env ?? {}) };
        const env = {};
        for (const [key, value] of Object.entries(merged)) {
            if (typeof value === "string")
                env[key] = value;
        }
        const detached = process.platform !== "win32";
        const child = nodeSpawn(spec.command, spec.args ?? [], {
            env,
            cwd: spec.cwd,
            stdio: ["pipe", "pipe", "pipe"],
            detached,
        });
        if (spec.onDiagnosticLine) {
            let buffer = "";
            child.stderr.setEncoding("utf8");
            child.stderr.on("data", (chunk) => {
                buffer += chunk;
                const lines = buffer.split(/\r?\n/);
                buffer = lines.pop() ?? "";
                for (const line of lines)
                    spec.onDiagnosticLine?.(line);
            });
            child.stderr.on("end", () => {
                if (buffer)
                    spec.onDiagnosticLine?.(buffer);
            });
        }
        const exited = new Promise((resolve) => {
            let settled = false;
            const settle = (code, signal) => {
                if (settled)
                    return;
                settled = true;
                resolve({ code, signal });
            };
            child.once("exit", settle);
            child.once("close", settle);
            child.once("error", () => settle(null, null));
        });
        const managed = { child, detached };
        activeChildren.add(managed);
        void exited.finally(() => activeChildren.delete(managed));
        const kill = async (signal = "SIGTERM") => {
            if (child.exitCode !== null || child.signalCode !== null)
                return;
            killProcessTree(child, signal, detached);
            if (await waitForChildExit(exited, 2_000))
                return;
            if (signal !== "SIGKILL") {
                killProcessTree(child, "SIGKILL", detached);
                await waitForChildExit(exited, 2_000);
            }
        };
        return {
            stdin: nodeWritableToWeb(child.stdin),
            stdout: nodeReadableToWeb(child.stdout),
            stderr: nodeReadableToWeb(child.stderr),
            kill,
            exited,
        };
    }
}
async function waitForChildExit(exited, timeoutMs) {
    let timer;
    try {
        return await Promise.race([
            exited.then(() => true),
            new Promise((resolve) => {
                timer = setTimeout(() => resolve(false), timeoutMs);
                timer.unref?.();
            }),
        ]);
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
function nodeReadableToWeb(stream) {
    return new ReadableStream({
        start(controller) {
            let closed = false;
            const close = () => {
                if (closed)
                    return;
                closed = true;
                stream.off("data", onData);
                stream.off("end", close);
                stream.off("close", close);
                stream.off("error", onError);
                try {
                    controller.close();
                }
                catch { /* already closed */ }
            };
            const onData = (chunk) => {
                if (closed)
                    return;
                try {
                    controller.enqueue(new Uint8Array(typeof chunk === "string" ? Buffer.from(chunk) : chunk));
                }
                catch {
                    close();
                }
            };
            const onError = (error) => {
                if (closed)
                    return;
                closed = true;
                try {
                    controller.error(error);
                }
                catch { /* already closed */ }
            };
            stream.on("data", onData);
            stream.once("end", close);
            stream.once("close", close);
            stream.once("error", onError);
        },
        cancel() { stream.destroy(); },
    });
}
function nodeWritableToWeb(stream) {
    return new WritableStream({
        write(chunk) {
            if (stream.destroyed || stream.writableEnded)
                return;
            return new Promise((resolve, reject) => {
                const onError = (error) => { cleanup(); reject(error); };
                const onDrain = () => { cleanup(); resolve(); };
                const cleanup = () => {
                    stream.off("error", onError);
                    stream.off("drain", onDrain);
                };
                stream.once("error", onError);
                const canContinue = stream.write(Buffer.from(chunk), (error) => {
                    if (error)
                        onError(error);
                    else if (canContinue) {
                        cleanup();
                        resolve();
                    }
                });
                if (!canContinue)
                    stream.once("drain", onDrain);
            });
        },
        close() {
            if (stream.destroyed || stream.writableEnded)
                return;
            return new Promise((resolve) => stream.end(resolve));
        },
        abort() { stream.destroy(); },
    });
}
//# sourceMappingURL=node.js.map