import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable, Writable } from "node:stream";
import type { AgentSpec, ChildHandle, Spawner } from "../types.js";

export class NodeSpawner implements Spawner {
  async spawn(spec: AgentSpec): Promise<ChildHandle> {
    const merged = { ...process.env, ...(spec.env ?? {}) };
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(merged)) {
      if (typeof value === "string") env[key] = value;
    }
    const child: ChildProcessWithoutNullStreams = nodeSpawn(spec.command, spec.args ?? [], {
      env,
      cwd: spec.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    if (spec.onDiagnosticLine) {
      let buffer = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        buffer += chunk;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) spec.onDiagnosticLine?.(line);
      });
      child.stderr.on("end", () => {
        if (buffer) spec.onDiagnosticLine?.(buffer);
      });
    }

    const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
      let settled = false;
      const settle = (code: number | null, signal: NodeJS.Signals | null) => {
        if (settled) return;
        settled = true;
        resolve({ code, signal });
      };
      child.once("exit", settle);
      child.once("close", settle);
      child.once("error", () => settle(null, null));
    });

    const kill = async (signal: "SIGTERM" | "SIGKILL" = "SIGTERM"): Promise<void> => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill(signal);
      if (await waitForChildExit(exited, 2_000)) return;
      if (signal !== "SIGKILL") {
        child.kill("SIGKILL");
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

async function waitForChildExit(
  exited: ChildHandle["exited"],
  timeoutMs: number,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      exited.then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function nodeReadableToWeb(stream: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        stream.off("data", onData);
        stream.off("end", close);
        stream.off("close", close);
        stream.off("error", onError);
        try { controller.close(); } catch { /* already closed */ }
      };
      const onData = (chunk: Buffer | string) => {
        if (closed) return;
        try { controller.enqueue(new Uint8Array(typeof chunk === "string" ? Buffer.from(chunk) : chunk)); }
        catch { close(); }
      };
      const onError = (error: Error) => {
        if (closed) return;
        closed = true;
        try { controller.error(error); } catch { /* already closed */ }
      };
      stream.on("data", onData);
      stream.once("end", close);
      stream.once("close", close);
      stream.once("error", onError);
    },
    cancel() { stream.destroy(); },
  });
}

function nodeWritableToWeb(stream: Writable): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    write(chunk) {
      if (stream.destroyed || stream.writableEnded) return;
      return new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => { cleanup(); reject(error); };
        const onDrain = () => { cleanup(); resolve(); };
        const cleanup = () => {
          stream.off("error", onError);
          stream.off("drain", onDrain);
        };
        stream.once("error", onError);
        const canContinue = stream.write(Buffer.from(chunk), (error?: Error | null) => {
          if (error) onError(error);
          else if (canContinue) { cleanup(); resolve(); }
        });
        if (!canContinue) stream.once("drain", onDrain);
      });
    },
    close() {
      if (stream.destroyed || stream.writableEnded) return;
      return new Promise<void>((resolve) => stream.end(resolve));
    },
    abort() { stream.destroy(); },
  });
}
