import { execFile, type ExecFileOptions } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

function quoteWindowsArg(value: string): string {
  if (value.length === 0) return '""';
  if (!/[\s"&|<>^]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

type Captured = { stdout: string; stderr: string };
type RunOptions = Omit<ExecFileOptions, "encoding">;

/** Run a prepared command. Windows `.cmd` shims need cmd.exe; CreateProcess rejects them. */
export function runCaptured(command: string, args: readonly string[] = [], options: RunOptions = {}): Promise<Captured> {
  const captured = { ...options, encoding: "utf8" as const };
  if (process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command)) {
    const line = [command, ...args].map(quoteWindowsArg).join(" ");
    return exec(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", line], captured) as Promise<Captured>;
  }
  return exec(command, [...args], captured) as Promise<Captured>;
}
