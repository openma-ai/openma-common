import { describe, expect, it } from "vitest";

import { acpLauncherInvocation } from "../src/acp-harnesses/installer.js";
import { commandInvocation, launcherTarget, renderWindowsLauncher } from "../src/acp-harnesses/launcher.js";

describe("harness launchers", () => {
  it("renders a .cmd launcher that sets variables literally and forwards arguments", () => {
    expect(
      renderWindowsLauncher("C:\\acp root\\node_modules\\.bin\\agent.cmd", ["acp", "two words", "100%"], {
        KEEP: "a %b% c",
        DROP: undefined,
      }).split("\r\n"),
    ).toEqual([
      "@echo off",
      "setlocal",
      'set "KEEP=a %%b%% c"',
      'call "C:\\acp root\\node_modules\\.bin\\agent.cmd" acp "two words" 100%% %*',
      "exit /b %ERRORLEVEL%",
      "",
    ]);
    expect(renderWindowsLauncher("C:\\bin\\agent.cmd").split("\r\n")[2]).toBe('call "C:\\bin\\agent.cmd" %*');
  });

  it("refuses text a .cmd file cannot hold literally", () => {
    expect(() => renderWindowsLauncher('C:\\a"b.cmd')).toThrow(/Launcher target cannot be written to a \.cmd launcher/);
    expect(() => renderWindowsLauncher("C:\\a.cmd", ['say "hi"'])).toThrow(/Launcher argument cannot be written/);
    expect(() => renderWindowsLauncher("C:\\a.cmd", [], { A: "line\nbreak" })).toThrow(/Launcher env A cannot be written/);
    expect(() => renderWindowsLauncher("C:\\a.cmd", [], { "BAD-KEY": "1" })).toThrow(
      "Launcher env key is not shell-safe: BAD-KEY",
    );
  });

  it("reads the target back from either launcher format", () => {
    expect(launcherTarget("#!/bin/sh\nset -eu\nexec '/opt/acp/node_modules/.bin/agent' 'acp' \"$@\"\n")).toBe(
      "/opt/acp/node_modules/.bin/agent",
    );
    expect(launcherTarget(renderWindowsLauncher("C:\\100% acp\\node_modules\\.bin\\agent.cmd", ["acp"]))).toBe(
      "C:\\100% acp\\node_modules\\.bin\\agent.cmd",
    );
    expect(launcherTarget("@echo off\r\necho nothing to call\r\n")).toBeUndefined();
  });

  it("starts POSIX commands and executable paths directly, and bare names and .cmd files on Windows through cmd.exe", () => {
    expect(commandInvocation(false, "npm", ["install", "a b"])).toEqual({ file: "npm", args: ["install", "a b"] });
    expect(commandInvocation(true, "C:\\node\\node.exe", ["cli.js"])).toEqual({
      file: "C:\\node\\node.exe",
      args: ["cli.js"],
    });
    expect(commandInvocation(true, "npm", ["install", "--prefix", "C:\\a b", "x&y"], "C:\\Windows\\cmd.exe")).toEqual({
      file: "C:\\Windows\\cmd.exe",
      args: ["/d", "/s", "/c", '"npm install --prefix "C:\\a b" "x&y""'],
      windowsVerbatimArguments: true,
    });
    expect(commandInvocation(true, "C:\\bin\\agent.cmd", []).file).toBe("cmd.exe");
    expect(commandInvocation(true, "C:\\bin\\agent.BAT", []).file).toBe("cmd.exe");
    expect(commandInvocation(true, "/opt/node/bin/node", ["cli.js"]).file).toBe("/opt/node/bin/node");
  });

  it("gives hosts the invocation for a launcher on either platform", () => {
    expect(acpLauncherInvocation("/bin/agent-pinned", ["--x"], { platform: "linux" })).toEqual({
      file: "/bin/agent-pinned",
      args: ["--x"],
    });
    expect(
      acpLauncherInvocation("C:\\acp bin\\agent-pinned.cmd", ["--x"], { platform: "win32", comSpec: "cmd.exe" }),
    ).toEqual({
      file: "cmd.exe",
      args: ["/d", "/s", "/c", '""C:\\acp bin\\agent-pinned.cmd" --x"'],
      windowsVerbatimArguments: true,
    });
    // Defaults: this platform, no arguments.
    expect(acpLauncherInvocation(process.execPath)).toEqual({ file: process.execPath, args: [] });
  });
});
