/**
 * Launcher files and command lines for managed harness installs on POSIX and
 * Windows. Everything here is a pure function of its arguments, so both
 * platforms' output is tested on either one.
 */
import { quoteWindowsArg } from "../acp-artifacts/npm.js";
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
function definedEnv(env) {
    return Object.entries(env).flatMap(([key, value]) => {
        if (value === undefined)
            return [];
        if (!ENV_NAME.test(key))
            throw new Error(`Launcher env key is not shell-safe: ${key}`);
        return [[key, value]];
    });
}
/** `%` starts a variable reference inside a batch file. */
function batchLiteral(value, what) {
    if (/["\r\n]/.test(value)) {
        throw new Error(`${what} cannot be written to a .cmd launcher: ${JSON.stringify(value)}`);
    }
    return value.replaceAll("%", "%%");
}
/**
 * A `.cmd` launcher: sets the variables, then runs the target (itself a
 * `.cmd` from `node_modules/.bin`, hence `call`) with the fixed arguments
 * followed by the caller's.
 */
export function renderWindowsLauncher(commandPath, args = [], env = {}) {
    const fixed = args.map((arg) => ` ${quoteWindowsArg(batchLiteral(arg, "Launcher argument"))}`).join("");
    return [
        "@echo off",
        "setlocal",
        ...definedEnv(env).map(([key, value]) => `set "${key}=${batchLiteral(value, `Launcher env ${key}`)}"`),
        `call "${batchLiteral(commandPath, "Launcher target")}"${fixed} %*`,
        "exit /b %ERRORLEVEL%",
        "",
    ].join("\r\n");
}
/** The command a launcher written by this package runs: `exec '…'` (sh) or `call "…"` (.cmd). */
export function launcherTarget(launcher) {
    const posix = launcher.match(/^exec\s+'([^']+)'(?:\s|$)/m)?.[1];
    if (posix)
        return posix;
    return launcher.match(/^call\s+"([^"]+)"(?:\s|$)/m)?.[1]?.replaceAll("%%", "%");
}
/**
 * How to start `command` without a shell option. On Windows a `.cmd`/`.bat`
 * file, or a bare name such as `npm` that PATH resolves to one, cannot be
 * started by CreateProcess, so it goes through `cmd.exe /d /s /c "<line>"`.
 * A path to any other executable, and every POSIX command, starts directly.
 */
export function commandInvocation(windows, command, args, comSpec) {
    const needsShell = /\.(?:cmd|bat)$/i.test(command) || !/[\\/]/.test(command);
    if (!windows || !needsShell)
        return { file: command, args: [...args] };
    const line = [command, ...args].map(quoteWindowsArg).join(" ");
    return {
        file: comSpec || "cmd.exe",
        args: ["/d", "/s", "/c", `"${line}"`],
        windowsVerbatimArguments: true,
    };
}
//# sourceMappingURL=launcher.js.map