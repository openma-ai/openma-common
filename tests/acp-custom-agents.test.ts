import { mkdtemp, rm } from "node:fs/promises";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { afterEach, describe, expect, it } from "vitest";
import {
  OMA_AGENTS_FILENAME,
  customAcpAgentsFromConfigToml,
  customAcpAgentsFromSettingsJson,
  customAcpAgentsPath,
  mergeCustomAcpAgents,
  normalizeCustomAcpAgent,
  normalizeCustomAcpAgents,
  readCustomAcpAgents,
  readCustomAcpAgentsFile,
  removeCustomAcpAgent,
  upsertCustomAcpAgent,
  validateCustomAcpAgent,
  writeCustomAcpAgentsFile,
} from "../src/acp-harnesses/custom-agents.js";

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "oma-agents-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("validateCustomAcpAgent", () => {
  it("keeps a complete definition and preserves arg versions verbatim", () => {
    const agent = validateCustomAcpAgent({
      id: "pi-beta",
      label: " Pi Beta ",
      command: " npx ",
      args: ["--yes", "@openma/pi-acp@beta"],
      env: { TOKEN: "abc" },
    });
    expect(agent).toEqual({
      id: "pi-beta",
      label: "Pi Beta",
      command: "npx",
      args: ["--yes", "@openma/pi-acp@beta"],
      env: { TOKEN: "abc" },
    });
  });

  it("defaults label to id and args to an empty array", () => {
    expect(validateCustomAcpAgent({ id: "x", command: "x-acp" })).toEqual({
      id: "x",
      label: "x",
      command: "x-acp",
      args: [],
    });
    // An empty env object serializes to no env key.
    expect(validateCustomAcpAgent({ id: "x", command: "x-acp", env: {} })).toEqual({
      id: "x",
      label: "x",
      command: "x-acp",
      args: [],
    });
  });

  it("rejects malformed definitions with a reason", () => {
    expect(() => validateCustomAcpAgent(null)).toThrow("must be an object");
    expect(() => validateCustomAcpAgent([1])).toThrow("must be an object");
    expect(() => validateCustomAcpAgent({ command: "c" })).toThrow("id must be a non-empty string");
    expect(() => validateCustomAcpAgent({ id: " " })).toThrow("id must be a non-empty string");
    expect(() => validateCustomAcpAgent({ id: "x" })).toThrow("command must be a non-empty string");
    expect(() => validateCustomAcpAgent({ id: "x", command: "c", args: "a" }))
      .toThrow("args must be an array of strings");
    expect(() => validateCustomAcpAgent({ id: "x", command: "c", args: [1] }))
      .toThrow("args must be an array of strings");
    expect(() => validateCustomAcpAgent({ id: "x", command: "c", env: { V: 1 } }))
      .toThrow("env must be an object of strings");
  });
});

describe("normalizeCustomAcpAgent(s)", () => {
  it("drops malformed rows instead of failing the list", () => {
    expect(normalizeCustomAcpAgent("junk")).toBeUndefined();
    expect(normalizeCustomAcpAgents([{ id: "a", command: "c" }, { bad: true }])).toEqual([
      { id: "a", label: "a", command: "c", args: [] },
    ]);
    expect(normalizeCustomAcpAgents({ not: "an array" })).toEqual([]);
  });

  it("deduplicates by id, first wins", () => {
    const agents = normalizeCustomAcpAgents([
      { id: "a", label: "first", command: "c1" },
      { id: "a", label: "second", command: "c2" },
    ]);
    expect(agents).toHaveLength(1);
    expect(agents[0]!.label).toBe("first");
  });
});

describe("mergeCustomAcpAgents", () => {
  it("keeps the first occurrence per id across lists", () => {
    expect(mergeCustomAcpAgents(
      [{ id: "a", label: "canonical", command: "c", args: [] }],
      [{ id: "a", label: "legacy", command: "c", args: [] }, {
        id: "b", label: "b", command: "d", args: [],
      }],
    ).map(({ id, label }) => [id, label])).toEqual([["a", "canonical"], ["b", "b"]]);
  });
});

describe("customAcpAgentsFromSettingsJson", () => {
  it("reads Martty harnesses[] rows", () => {
    expect(customAcpAgentsFromSettingsJson({
      harnesses: [{ id: "pi", label: "Pi", command: "npx", args: ["@openma/pi-acp@beta"] }],
      defaultHarness: "pi",
    })).toEqual([{ id: "pi", label: "Pi", command: "npx", args: ["@openma/pi-acp@beta"] }]);
  });

  it("keeps user-pinned package versions verbatim", () => {
    const [agent] = customAcpAgentsFromSettingsJson({
      harnesses: [{ id: "pi", command: "npx", args: ["@openma/pi-acp@beta"] }],
    });
    expect(agent!.args).toEqual(["@openma/pi-acp@beta"]);
  });

  it("strips runner flags Martty used to inject into npx args", () => {
    const [agent] = customAcpAgentsFromSettingsJson({
      harnesses: [{
        id: "pi",
        command: "C:\\tools\\npx.cmd",
        args: ["--yes", "--prefer-offline", "@openma/pi-acp@beta"],
      }],
    });
    expect(agent!.args).toEqual(["@openma/pi-acp@beta"]);
  });

  it("leaves the same flags alone for non-npx commands", () => {
    const [agent] = customAcpAgentsFromSettingsJson({
      harnesses: [{ id: "x", command: "my-agent", args: ["--yes"] }],
    });
    expect(agent!.args).toEqual(["--yes"]);
  });

  it("returns an empty list for missing or malformed settings", () => {
    expect(customAcpAgentsFromSettingsJson(undefined)).toEqual([]);
    expect(customAcpAgentsFromSettingsJson({ harnesses: "nope" })).toEqual([]);
  });
});

describe("customAcpAgentsFromConfigToml", () => {
  it("reads only [[agents]] rows that define a command", () => {
    const parsed = stringifyToml({
      agents: [
        { id: "claude-acp", enabled: false },
        {
          id: "custom",
          label_override: "Custom ACP",
          command_override: "custom-acp",
          args_override: ["serve", "--port", "9"],
          env: [{ name: "TOKEN", value: "v" }],
        },
        {
          id: "other",
          command_override: "other-acp",
        },
      ],
    });
    expect(customAcpAgentsFromConfigToml(parseToml(parsed))).toEqual([
      {
        id: "custom",
        label: "Custom ACP",
        command: "custom-acp",
        args: ["serve", "--port", "9"],
        env: { TOKEN: "v" },
      },
      { id: "other", label: "other", command: "other-acp", args: [] },
    ]);
  });

  it("skips malformed rows and dedups by id", () => {
    const parsed = parseToml(stringifyToml({
      agents: [
        { command_override: "no-id" },
        { id: "x", command_override: "c", args_override: [1, 2] },
        { id: "x", command_override: "first" },
        { id: "x", command_override: "second" },
      ],
    }));
    expect(customAcpAgentsFromConfigToml(parsed)).toEqual([
      { id: "x", label: "x", command: "first", args: [] },
    ]);
  });

  it("handles missing or malformed config", () => {
    expect(customAcpAgentsFromConfigToml(undefined)).toEqual([]);
    expect(customAcpAgentsFromConfigToml({})).toEqual([]);
    expect(customAcpAgentsFromConfigToml({ agents: "nope" })).toEqual([]);
  });

  it("accepts env written as an inline TOML table", () => {
    const parsed = parseToml('[[agents]]\nid = "a"\ncommand_override = "c"\nenv = { TOKEN = "v" }\n');
    const [agent] = customAcpAgentsFromConfigToml(parsed);
    expect(agent!.env).toEqual({ TOKEN: "v" });
  });

  it("omits env when every pair is invalid", () => {
    const parsed = parseToml(stringifyToml({
      agents: [{ id: "a", command_override: "c", env: [{ name: " " }, { value: "x" }] }],
    }));
    expect(customAcpAgentsFromConfigToml(parsed)[0]!.env).toBeUndefined();
  });

  it("skips env pairs without a name or string value", () => {
    const parsed = parseToml(stringifyToml({
      agents: [{
        id: "a",
        command_override: "c",
        env: [{ name: "GOOD", value: "1" }, { name: "  " }, { name: "NOVAL" }, "junk"],
      }],
    }));
    const [agent] = customAcpAgentsFromConfigToml(parsed)!
    expect(agent!.env).toEqual({ GOOD: "1" });
  });
});

describe("agents.json file IO", () => {
  it("returns an empty list when the file is missing or corrupt", async () => {
    const dir = await makeRoot();
    expect(readCustomAcpAgentsFile(dir)).toEqual([]);
    writeFileSync(customAcpAgentsPath(dir), "{not json");
    expect(readCustomAcpAgentsFile(dir)).toEqual([]);
    writeFileSync(customAcpAgentsPath(dir), JSON.stringify({ agents: "nope" }));
    expect(readCustomAcpAgentsFile(dir)).toEqual([]);
  });

  it("accepts a bare array as well as the versioned object", async () => {
    const dir = await makeRoot();
    writeFileSync(customAcpAgentsPath(dir), JSON.stringify([
      { id: "a", command: "c" },
    ]));
    expect(readCustomAcpAgentsFile(dir)).toEqual([
      { id: "a", label: "a", command: "c", args: [] },
    ]);
  });

  it("writes, upserts and removes definitions", async () => {
    const dir = await makeRoot();
    writeCustomAcpAgentsFile(dir, [
      { id: "a", label: "A", command: "a-acp", args: ["--x"], env: { K: "v" } },
    ]);
    expect(JSON.parse(readFileSync(customAcpAgentsPath(dir), "utf8"))).toEqual({
      version: 1,
      agents: [{ id: "a", label: "A", command: "a-acp", args: ["--x"], env: { K: "v" } }],
    });

    upsertCustomAcpAgent(dir, { id: "b", command: "b-acp" });
    upsertCustomAcpAgent(dir, { id: "a", command: "a2-acp", args: ["@openma/pi-acp@beta"] });
    let agents = readCustomAcpAgentsFile(dir);
    expect(agents).toEqual([
      { id: "a", label: "a", command: "a2-acp", args: ["@openma/pi-acp@beta"] },
      { id: "b", label: "b", command: "b-acp", args: [] },
    ]);

    removeCustomAcpAgent(dir, "a");
    expect(readCustomAcpAgentsFile(dir).map(({ id }) => id)).toEqual(["b"]);
  });

  it("round-trips through a nested directory it creates", async () => {
    const dir = join(await makeRoot(), "nested", ".oma");
    upsertCustomAcpAgent(dir, { id: "x", command: "x" });
    expect(readFileSync(join(dir, OMA_AGENTS_FILENAME), "utf8")).toContain('"id": "x"');
  });

  it("throws when asked to write an invalid definition", async () => {
    const dir = await makeRoot();
    expect(() => upsertCustomAcpAgent(dir, { id: "x" })).toThrow("command");
    expect(() => writeCustomAcpAgentsFile(dir, [{ id: "x" } as never])).toThrow("command");
  });
});

describe("readCustomAcpAgents", () => {
  it("merges all three stores, canonical file first", async () => {
    const dir = await makeRoot();
    writeCustomAcpAgentsFile(dir, [
      { id: "shared", label: "canonical", command: "c1", args: [] },
    ]);
    writeFileSync(join(dir, "config.toml"), stringifyToml({
      agents: [
        { id: "shared", command_override: "toml-version" },
        { id: "toml-only", command_override: "toml-cmd", args_override: ["a"] },
        { id: "registry-agent", enabled: false },
      ],
    }));
    writeFileSync(join(dir, "settings.json"), JSON.stringify({
      harnesses: [
        { id: "shared", label: "json", command: "c3" },
        { id: "json-only", label: "J", command: "j", args: ["@openma/pi-acp@beta"] },
      ],
    }));

    expect(readCustomAcpAgents(dir)).toEqual([
      { id: "shared", label: "canonical", command: "c1", args: [] },
      { id: "toml-only", label: "toml-only", command: "toml-cmd", args: ["a"] },
      { id: "json-only", label: "J", command: "j", args: ["@openma/pi-acp@beta"] },
    ]);
  });

  it("tolerates an empty directory", async () => {
    const dir = await makeRoot();
    mkdirSync(dir, { recursive: true });
    expect(readCustomAcpAgents(dir)).toEqual([]);
  });
});
