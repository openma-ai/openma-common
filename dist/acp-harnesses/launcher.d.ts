/**
 * Launcher files and command lines for managed harness installs on POSIX and
 * Windows. Everything here is a pure function of its arguments, so both
 * platforms' output is tested on either one.
 */
/**
 * A `.cmd` launcher: sets the variables, then runs the target (itself a
 * `.cmd` from `node_modules/.bin`, hence `call`) with the fixed arguments
 * followed by the caller's.
 */
export declare function renderWindowsLauncher(commandPath: string, args?: readonly string[], env?: Record<string, string | undefined>): string;
/** The command a launcher written by this package runs: `exec '…'` (sh) or `call "…"` (.cmd). */
export declare function launcherTarget(launcher: string): string | undefined;
export interface CommandInvocation {
    file: string;
    args: string[];
    /** Set when `args` already carry Windows quoting and must not be re-quoted. */
    windowsVerbatimArguments?: true;
}
/**
 * How to start `command` without a shell option. On Windows a `.cmd`/`.bat`
 * file, or a bare name such as `npm` that PATH resolves to one, cannot be
 * started by CreateProcess, so it goes through `cmd.exe /d /s /c "<line>"`.
 * A path to any other executable, and every POSIX command, starts directly.
 */
export declare function commandInvocation(windows: boolean, command: string, args: readonly string[], comSpec?: string): CommandInvocation;
//# sourceMappingURL=launcher.d.ts.map