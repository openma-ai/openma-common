import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionConfigOption } from "@agentclientprotocol/sdk";

import {
  buildAcpHeadlessLaunch,
  resolveAcpHeadlessThinkingLevel,
} from "../src/acp-harnesses/headless-launch.js";
import { OVERLAY_AGENTS, type KnownAgentEntry } from "../src/acp-harnesses/known-agents.js";
import { _resetRegistryCache, loadRegistry } from "../src/acp-harnesses/registry.js";

const pi = OVERLAY_AGENTS.find((agent) => agent.id === "pi-acp")!;

function entry(overrides: Partial<KnownAgentEntry> = {}): KnownAgentEntry {
  return { id: "example", label: "Example", spec: { command: "example" }, ...overrides };
}

describe("ACP headless launch", () => {
  it("builds the pi-acp launch from generic options", () => {
    // Flags and the variable are the ones openma-pi-acp 0.1.7 documents in its
    // README "Configuration" table.
    expect(
      buildAcpHeadlessLaunch(pi, {
        sessionDir: "/trial/sessions",
        agentDir: "/trial/agent",
        trustProject: true,
        provider: "deepseek",
        model: "deepseek-v4-pro",
        thinkingLevel: "medium",
      }),
    ).toEqual({
      args: [
        "--no-delegation",
        "--quiet-startup",
        "--session-dir",
        "/trial/sessions",
        "--agent-dir",
        "/trial/agent",
        "--trust-projects",
        "--model",
        "deepseek/deepseek-v4-pro:medium",
      ],
      env: { PI_CODING_AGENT_DIR: "/trial/agent" },
      unsupported: [],
    });
  });

  it("passes only the recipe's fixed flags when no option is given", () => {
    expect(buildAcpHeadlessLaunch(pi)).toEqual({
      args: ["--no-delegation", "--quiet-startup"],
      env: {},
      unsupported: [],
    });
    expect(buildAcpHeadlessLaunch(pi, { trustProject: false }).args).not.toContain("--trust-projects");
  });

  it("does not prefix a model that already names its provider, and omits absent parts", () => {
    const modelOf = (options: Parameters<typeof buildAcpHeadlessLaunch>[1]) => {
      const { args } = buildAcpHeadlessLaunch(pi, options);
      return args[args.indexOf("--model") + 1];
    };

    expect(modelOf({ provider: "deepseek", model: "deepseek/v4", thinkingLevel: "high" })).toBe("deepseek/v4:high");
    expect(modelOf({ model: "v4" })).toBe("v4");
    expect(modelOf({ provider: "deepseek", model: "v4" })).toBe("deepseek/v4");
  });

  it("keeps the entry's own arguments and defined variables first", () => {
    const launch = buildAcpHeadlessLaunch(
      entry({
        spec: { command: "example", args: ["acp"], env: { KEEP: "1", DROP: undefined } },
        headless: { agentDir: { env: "EXAMPLE_HOME" } },
      }),
      { agentDir: "/trial/agent" },
    );

    expect(launch).toEqual({
      args: ["acp"],
      env: { KEEP: "1", EXAMPLE_HOME: "/trial/agent" },
      unsupported: [],
    });
    expect(
      buildAcpHeadlessLaunch(entry({ headless: { agentDir: { flag: "--home" } } }), { agentDir: "/a" }),
    ).toMatchObject({ args: ["--home", "/a"], env: {} });
  });

  it("names every requested option the recipe cannot express", () => {
    const all = {
      sessionDir: "/s",
      agentDir: "/a",
      trustProject: true,
      provider: "p",
      model: "m",
      thinkingLevel: "low",
    };

    expect(buildAcpHeadlessLaunch(entry({ headless: {} }), all)).toEqual({
      args: [],
      env: {},
      unsupported: ["sessionDir", "agentDir", "trustProject", "model", "provider", "thinkingLevel"],
    });
    // A model flag with no provider or thinking syntax carries the model only.
    expect(buildAcpHeadlessLaunch(entry({ headless: { model: { flag: "-m" } } }), all)).toMatchObject({
      args: ["-m", "m"],
      unsupported: ["sessionDir", "agentDir", "trustProject", "provider", "thinkingLevel"],
    });
  });

  it("reports a provider or thinking level that has no model to travel in", () => {
    // Both are written inside the model value, so without a model the launch
    // would silently lose them.
    expect(buildAcpHeadlessLaunch(pi, { provider: "deepseek", thinkingLevel: "medium" })).toEqual({
      args: ["--no-delegation", "--quiet-startup"],
      env: {},
      unsupported: ["provider", "thinkingLevel"],
    });
    expect(buildAcpHeadlessLaunch(pi, { provider: "deepseek" }).unsupported).toEqual(["provider"]);
    expect(buildAcpHeadlessLaunch(pi, { thinkingLevel: "medium" }).unsupported).toEqual(["thinkingLevel"]);
    expect(buildAcpHeadlessLaunch(pi, { model: "v4" }).unsupported).toEqual([]);
  });

  it("refuses a harness that has no recipe instead of guessing one", () => {
    expect(() => buildAcpHeadlessLaunch(entry())).toThrow("Example (example) has no headless launch recipe");
  });
});

describe("ACP headless thinking level", () => {
  const thinking = (currentValue: string, values: string[]): SessionConfigOption => ({
    id: "thinking",
    name: "Thinking",
    category: "thought_level",
    type: "select",
    currentValue,
    options: values.map((value) => ({ value, name: value })),
  });
  const model: SessionConfigOption = {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: "deepseek/deepseek-flash",
    options: [{ value: "deepseek/deepseek-flash", name: "DeepSeek Flash" }],
  };

  it("reports the level the session runs at when the harness changed the requested one", () => {
    // The option @openma/pi-acp 0.1.7 with the Pi SDK 1.1.0 returned from
    // `session/new` for `--model deepseek/deepseek-flash:medium` (captured in
    // openma-ai/openma-common#45): Pi has no `medium` for this model.
    const reported = thinking("high", ["off", "low", "high", "max"]);

    expect(resolveAcpHeadlessThinkingLevel([model, reported], "medium")).toEqual({
      requested: "medium",
      effective: "high",
      available: ["off", "low", "high", "max"],
      status: "adjusted",
    });
  });

  it("confirms a level the session runs at as requested", () => {
    expect(resolveAcpHeadlessThinkingLevel([thinking("high", ["off", "high"])], "high")).toMatchObject({
      effective: "high",
      status: "applied",
    });
  });

  it("reads grouped levels", () => {
    const grouped: SessionConfigOption = {
      id: "thinking",
      name: "Thinking",
      category: "thought_level",
      type: "select",
      currentValue: "b",
      options: [
        { group: "one", name: "One", options: [{ value: "a", name: "a" }] },
        { group: "two", name: "Two", options: [{ value: "b", name: "b" }] },
      ],
    };

    expect(resolveAcpHeadlessThinkingLevel([grouped], "a").available).toEqual(["a", "b"]);
  });

  it("says so when the session reports no thinking level", () => {
    const unreported = { requested: "medium", available: [], status: "unreported" };
    const toggle: SessionConfigOption = {
      id: "thinking",
      name: "Thinking",
      category: "thought_level",
      type: "boolean",
      currentValue: true,
    };

    expect(resolveAcpHeadlessThinkingLevel([], "medium")).toEqual(unreported);
    expect(resolveAcpHeadlessThinkingLevel([model], "medium")).toEqual(unreported);
    // An on/off switch names no level to compare with.
    expect(resolveAcpHeadlessThinkingLevel([toggle], "medium")).toEqual(unreported);
  });
});

describe("registry merge", () => {
  beforeEach(() => _resetRegistryCache());
  afterEach(() => {
    vi.unstubAllGlobals();
    _resetRegistryCache();
  });

  it("keeps the overlay's headless recipe and pinned install over an official entry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            version: 1,
            agents: [
              {
                id: "pi-acp",
                name: "pi ACP",
                version: "9.9.9",
                distribution: { npx: { package: "pi-acp@9.9.9" } },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    const merged = (await loadRegistry({ forceRefresh: true })).find((agent) => agent.id === "pi-acp");

    expect(merged?.headless).toEqual(pi.headless);
    expect(merged?.pinned).toEqual(pi.pinned);
  });
});
