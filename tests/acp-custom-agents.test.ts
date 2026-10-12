import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { afterEach, describe, expect, it } from "vitest";
import {
  configTomlRowFromCustomAcpAgent,
  customAcpAgentFromConfigTomlRow,
  customAcpAgentsConfigPath,
  customAcpAgentsFromConfigToml,
  customAcpAgentsFromSettingsJson,
  mergeCustomAcpAgents,
  migrateLegacyAcpAgents,
  normalizeCustomAcpAgent,
  normalizeCustomAcpAgents,
  readCustomAcpAgents,
  removeCustomAcpAgent,
  upsertCustomAcpAgent,
  validateCustomAcpAgent,
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

function readToml(path: string): Record<string, unknown> {
  return parseToml(readFileSync(path, "utf8")) as Record<string, unknown>;
}

describe("validateCustomAcpAgent", () => {
  it("keeps a complete definition and preserves arg versions verbatim", () => {
    expect(validateCustomAcpAgent({
      id: "pi-beta",
      label: " Pi Beta ",
      command: " npx ",
      args: ["@openma/pi-acp@beta"],
      env: { TOKEN: "abc" },
      enabled: false,
    })).toEqual({
      id: "pi-beta",
      label: "Pi Beta",
      command: "npx",
      args: ["@openma/pi-acp@beta"],
      env: { TOKEN: "abc" },
      enabled: false,
    });
  });

  it("defaults label to id and args to an empty array; keeps env:{} verbatim", () => {
    expect(validateCustomAcpAgent({ id: "x", command: "x-acp" })).toEqual({
      id: "x", label: "x", command: "x-acp", args: [],
    });
    expect(validateCustomAcpAgent({ id: "x", command: "x-acp", env: {} })).toEqual({
      id: "x", label: "x", command: "x-acp", args: [], env: {},
    });
  });

  it("rejects malformed definitions with a reason", () => {
    expect(() => validateCustomAcpAgent(null)).toThrow("must be an object");
    expect(() => validateCustomAcpAgent({ command: "c" })).toThrow("id must be a non-empty string");
    expect(() => validateCustomAcpAgent({ id: " " })).toThrow("id must be a non-empty string");
    expect(() => validateCustomAcpAgent({ id: "x" })).toThrow("command must be a non-empty string");
    expect(() => validateCustomAcpAgent({ id: "x", command: "c", args: "a" }))
      .toThrow("args must be an array of strings");
    expect(() => validateCustomAcpAgent({ id: "x", command: "c", env: { V: 1 } }))
      .toThrow("env must be an object of strings");
    expect(() => validateCustomAcpAgent({ id: "x", command: "c", enabled: "no" }))
      .toThrow("enabled must be a boolean");
  });
});

describe("normalizeCustomAcpAgent(s) / mergeCustomAcpAgents", () => {
  it("drops malformed rows and dedups by id, first wins", () => {
    expect(normalizeCustomAcpAgent("junk")).toBeUndefined();
    expect(normalizeCustomAcpAgents([{ id: "a", command: "c" }, { bad: true }])).toEqual([
      { id: "a", label: "a", command: "c", args: [] },
    ]);
    expect(normalizeCustomAcpAgents({ not: "an array" })).toEqual([]);
    expect(mergeCustomAcpAgents(
      [{ id: "a", label: "canonical", command: "c", args: [] }],
      [{ id: "a", label: "legacy", command: "c", args: [] }],
    )).toEqual([{ id: "a", label: "canonical", command: "c", args: [] }]);
  });
});

describe("config.toml row mapping", () => {
  it("reads only rows carrying command_override and keeps enabled/env", () => {
    const parsed = parseToml(stringifyToml({
      agents: [
        { id: "claude-acp", enabled: false },
        {
          id: "custom",
          enabled: false,
          label_override: "Custom ACP",
          command_override: "custom-acp",
          args_override: ["serve"],
          env: [{ name: "TOKEN", value: "v" }],
        },
        { id: "tbl", command_override: "t-acp", env: { K: "v" } },
        { id: "badenv", command_override: "b-acp", env: [{ name: "X" }] },
        { id: "other", command_override: "other-acp" },
      ],
    }));
    expect(customAcpAgentsFromConfigToml(parsed)).toEqual([
      {
        id: "custom",
        enabled: false,
        label: "Custom ACP",
        command: "custom-acp",
        args: ["serve"],
        env: { TOKEN: "v" },
      },
      { id: "tbl", label: "tbl", command: "t-acp", args: [], env: { K: "v" } },
      { id: "badenv", label: "badenv", command: "b-acp", args: [] },
      { id: "other", label: "other", command: "other-acp", args: [] },
    ]);
  });

  it("round-trips a definition through the row shape", () => {
    const agent = {
      id: "x", label: "X", command: "x-acp", args: ["a"], env: { K: "v" }, enabled: false,
    };
    expect(customAcpAgentFromConfigTomlRow(configTomlRowFromCustomAcpAgent(agent))).toEqual(agent);
    expect(configTomlRowFromCustomAcpAgent({ id: "x", label: "x", command: "c", args: [] }))
      .toEqual({ id: "x", command_override: "c" });
  });

  it("skips malformed rows", () => {
    expect(customAcpAgentsFromConfigToml(parseToml(stringifyToml({
      agents: [
        { command_override: "no-id" },
        { id: "x", command_override: "c", args_override: [1] },
      ],
    })))).toEqual([]);
    expect(customAcpAgentsFromConfigToml(undefined)).toEqual([]);
    expect(customAcpAgentsFromConfigToml({ agents: "nope" })).toEqual([]);
  });
});

describe("customAcpAgentsFromSettingsJson", () => {
  it("reads harnesses[] rows, keeps versions verbatim, strips legacy npx flags", () => {
    expect(customAcpAgentsFromSettingsJson({
      harnesses: [{
        id: "pi",
        command: "C:\\tools\\npx.cmd",
        args: ["--yes", "--prefer-offline", "@openma/pi-acp@beta"],
      }],
    })).toEqual([{ id: "pi", label: "pi", command: "C:\\tools\\npx.cmd", args: ["@openma/pi-acp@beta"] }]);
    expect(customAcpAgentsFromSettingsJson({
      harnesses: [{ id: "x", command: "my-agent", args: ["--yes"] }],
    })[0]!.args).toEqual(["--yes"]);
    expect(customAcpAgentsFromSettingsJson({
      harnesses: [{ id: "n", command: "npx", args: ["pkg@1.2.3"] }],
    })[0]!.args).toEqual(["pkg@1.2.3"]);
    expect(customAcpAgentsFromSettingsJson(undefined)).toEqual([]);
    expect(customAcpAgentsFromSettingsJson({ harnesses: "nope" })).toEqual([]);
  });
});

describe("readCustomAcpAgents", () => {
  it("merges config.toml and settings.json leftovers, deduped", async () => {
    const dir = await makeRoot();
    writeFileSync(join(dir, "config.toml"), stringifyToml({
      agents: [
        { id: "shared", command_override: "toml-version" },
        { id: "registry-agent", enabled: false },
      ],
    }));
    writeFileSync(join(dir, "settings.json"), JSON.stringify({
      harnesses: [
        { id: "shared", command: "json-version" },
        { id: "json-only", label: "J", command: "j", args: ["@openma/pi-acp@beta"] },
      ],
    }));
    expect(readCustomAcpAgents(dir)).toEqual([
      { id: "shared", label: "shared", command: "toml-version", args: [] },
      { id: "json-only", label: "J", command: "j", args: ["@openma/pi-acp@beta"] },
    ]);
  });

  it("returns an empty list for an empty dir and throws on a corrupt config.toml", async () => {
    const dir = await makeRoot();
    expect(readCustomAcpAgents(dir)).toEqual([]);
    writeFileSync(join(dir, "config.toml"), "[[agents]]\nid = \"unclosed");
    expect(() => readCustomAcpAgents(dir)).toThrow();
  });
});

describe("writes into config.toml", () => {
  it("upserts and removes definitions, preserving other sections", async () => {
    const dir = await makeRoot();
    const path = customAcpAgentsConfigPath(dir);
    writeFileSync(path, [
      "# backchat config",
      "# https://github.com/minimax/backchat",
      "",
      "[appearance]",
      'theme = "dark"',
      "",
      "[[agents]]",
      'id = "codex-acp"',
      "enabled = false",
      "",
    ].join("\n"));

    upsertCustomAcpAgent(dir, {
      id: "pi", label: "Pi", command: "npx", args: ["@openma/pi-acp@beta"],
    });
    let written = readFileSync(path, "utf8");
    expect(written).toContain("# backchat config");
    const parsed = readToml(path);
    expect(parsed.appearance).toEqual({ theme: "dark" });
    expect(parsed.agents).toEqual([
      { id: "codex-acp", enabled: false },
      { id: "pi", label_override: "Pi", command_override: "npx", args_override: ["@openma/pi-acp@beta"] },
    ]);

    removeCustomAcpAgent(dir, "pi");
    expect(readToml(path).agents).toEqual([{ id: "codex-acp", enabled: false }]);
  });

  it("refuses to overwrite a config.toml that fails to parse", async () => {
    const dir = await makeRoot();
    const path = customAcpAgentsConfigPath(dir);
    writeFileSync(path, "[[agents]]\nid = \"unclosed\n");
    const before = readFileSync(path, "utf8");
    expect(() => upsertCustomAcpAgent(dir, { id: "x", command: "c" })).toThrow();
    expect(() => removeCustomAcpAgent(dir, "x")).toThrow();
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("a removed agent cannot resurface from settings.json", async () => {
    const dir = await makeRoot();
    writeFileSync(join(dir, "settings.json"), JSON.stringify({
      harnesses: [{ id: "old", label: "Old", command: "old-acp", args: ["a@1"] }],
      defaultHarness: "old",
      theme: "ember",
    }));
    // First write migrates the legacy list into config.toml...
    upsertCustomAcpAgent(dir, { id: "new", command: "new-acp" });
    expect(readCustomAcpAgents(dir).map(({ id }) => id)).toEqual(["old", "new"]);
    expect(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")))
      .toEqual({ defaultHarness: "old", theme: "ember" });
    // ...then a removal drops it from the single store — nothing resurfaces.
    removeCustomAcpAgent(dir, "old");
    expect(readCustomAcpAgents(dir)).toEqual([
      { id: "new", label: "new", command: "new-acp", args: [] },
    ]);
  });

  it("respects enabled=false stored rows on read and on upsert", async () => {
    const dir = await makeRoot();
    upsertCustomAcpAgent(dir, { id: "pi", command: "npx", enabled: false });
    upsertCustomAcpAgent(dir, { id: "z", command: "z-acp" });
    expect(readCustomAcpAgents(dir)).toEqual([
      { id: "pi", label: "pi", command: "npx", args: [], enabled: false },
      { id: "z", label: "z", command: "z-acp", args: [] },
    ]);
    // A caller upserting without the flag keeps the stored disable, and
    // replacing one definition leaves the other rows alone.
    upsertCustomAcpAgent(dir, { id: "pi", command: "npx2" });
    expect(readCustomAcpAgents(dir)).toEqual([
      { id: "pi", label: "pi", command: "npx2", args: [], enabled: false },
      { id: "z", label: "z", command: "z-acp", args: [] },
    ]);
  });

  it("keeps a residual enabled flag when a definition is removed", async () => {
    const dir = await makeRoot();
    upsertCustomAcpAgent(dir, { id: "pi", command: "npx", enabled: false });
    removeCustomAcpAgent(dir, "pi");
    expect(readToml(customAcpAgentsConfigPath(dir)).agents).toEqual([{ id: "pi", enabled: false }]);
    expect(readCustomAcpAgents(dir)).toEqual([]);
  });

  it("keeps rows without id, duplicate ids and stored env untouched", async () => {
    const dir = await makeRoot();
    const path = customAcpAgentsConfigPath(dir);
    writeFileSync(path, [
      "[[agents]]",
      'command_override = "id-less"',
      "",
      "[[agents]]",
      'id = "pi"',
      'env = [{name = "TOKEN", value = "v"}]',
      "",
      "[[agents]]",
      'id = "pi"',
      "enabled = true",
      "",
      "[[agents]]",
      'id = "e"',
      "enabled = true",
      "",
    ].join("\n"));
    upsertCustomAcpAgent(dir, { id: "pi", command: "npx" });
    upsertCustomAcpAgent(dir, {
      id: "e", label: "E Two", command: "e-acp", args: ["x"], env: { V: "1" },
    });
    const agents = readToml(path).agents as unknown[];
    // The env-only row gains the command fields and keeps its stored env pairs...
    expect(agents).toContainEqual({
      id: "pi", env: [{ name: "TOKEN", value: "v" }], command_override: "npx",
    });
    // ...the duplicate-id row stays as it was...
    expect(agents).toContainEqual({ id: "pi", enabled: true });
    // ...the definition's own label/args/env win when it carries them
    // (keeping the row's enabled flag)...
    expect(agents).toContainEqual({
      id: "e",
      enabled: true,
      label_override: "E Two",
      command_override: "e-acp",
      args_override: ["x"],
      env: [{ name: "V", value: "1" }],
    });
    // ...and rows without an id are never dropped.
    expect(agents).toContainEqual({ command_override: "id-less" });
  });

  it("migrateLegacyAcpAgents folds settings.json harnesses once", async () => {
    const dir = await makeRoot();
    expect(migrateLegacyAcpAgents(dir)).toBe(false);
    writeFileSync(join(dir, "settings.json"), JSON.stringify({
      harnesses: [{ id: "m", label: "M", command: "m-acp", args: ["a@2"] }],
    }));
    expect(migrateLegacyAcpAgents(dir)).toBe(true);
    expect(migrateLegacyAcpAgents(dir)).toBe(false);
    expect(readCustomAcpAgents(dir)).toEqual([
      { id: "m", label: "M", command: "m-acp", args: ["a@2"] },
    ]);
  });
});
