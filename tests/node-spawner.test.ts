import { describe, expect, it } from "vitest";
import { NodeSpawner } from "../src/acp-runtime/spawners/node.js";

describe("NodeSpawner", () => {
  it("rejects with the spawn error when an ACP executable is missing", async () => {
    const spawner = new NodeSpawner();

    await expect(spawner.spawn({
      command: "openma-definitely-missing-acp-executable",
    })).rejects.toMatchObject({ code: "ENOENT" });
  });
});
