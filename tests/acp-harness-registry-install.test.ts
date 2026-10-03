import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import type { AcpCatalogHarness } from "../src/acp-harnesses/catalog.js";
import { installAcpHarnesses } from "../src/acp-harnesses/install.js";
import { platformKey } from "../src/acp-artifacts/shared.js";
import { runCaptured } from "./run-command.js";

const platform = platformKey();
const win = process.platform === "win32";
const bytes = Buffer.from(win
  ? "@echo off\r\necho %MODE%:%*\r\n"
  : '#!/bin/sh\nprintf "%s:%s\\n" "$MODE" "$*"\n');
const agentCommand = win ? "agent.cmd" : "./agent";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function manifest(version: string) {
  return {
    id: "fixture",
    version,
    distribution: {
      binary: {
        [platform]: {
          archive: "https://releases.test/agent",
          cmd: agentCommand,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          args: ["acp", "--stdio"],
          env: { MODE: "registry" },
        },
      },
    },
  };
}

it("installs a registry catalog entry through the generic installer using a fixture manifest", async () => {
  const manifestUrl = "https://example.test/{id}/{version}/agent.json";
  const fetcher: typeof fetch = async (input) => {
    const address = String(input);
    if (address === "https://example.test/fixture/1.0.0/agent.json") {
      return Response.json(manifest("1.0.0"));
    }
    if (address === "https://releases.test/agent") return new Response(bytes);
    throw new Error(`Unexpected URL ${address}`);
  };
  const entry: AcpCatalogHarness = {
    id: "fixture",
    label: "Fixture",
    version: "1.0.0",
    source: { type: "registry", manifestUrl },
  };
  const root = await mkdtemp(join(tmpdir(), "acp-harness-registry-"));
  roots.push(root);
  const [installed] = await installAcpHarnesses({
    root,
    catalog: [entry],
    ids: ["fixture"],
    fetch: fetcher,
  });
  expect(installed).toMatchObject({
    id: "fixture",
    version: "1.0.0",
    args: ["acp", "--stdio"],
    env: { MODE: "registry" },
  });
  expect(installed!.release.schema).toBe("openma.acp.registry.v1");
  expect((await runCaptured(installed!.command, installed!.args, {
    env: { ...process.env, ...installed!.env },
  })).stdout.trim()).toBe("registry:acp --stdio");
}, 30_000);
