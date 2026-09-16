import { expect, it } from "vitest";
import { sessionInputIdentityPrefix } from "../src/protocol/managed/index.js";

it("exposes stable workspace-scoped input identity through the protocol layer", async () => {
  const id = await sessionInputIdentityPrefix("workspace", "session", "input");
  expect(await sessionInputIdentityPrefix("workspace", "session", "input")).toBe(id);
  expect(await sessionInputIdentityPrefix("other", "session", "input")).not.toBe(id);
  expect(await sessionInputIdentityPrefix("workspace", "other", "input")).not.toBe(id);
  expect(await sessionInputIdentityPrefix("workspace", "session", "other")).not.toBe(id);
});
