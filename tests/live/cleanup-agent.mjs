/**
 * Backstop cleanup for a live agent whose vitest process was cancelled.
 * Reads tests/live/out/active-agent.json and calls the documented
 * cancel and delete endpoints. A missing state file means cleanup already
 * finished. 404 and 409 are success.
 */
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

const statePath = resolve(import.meta.dirname, "out", "active-agent.json");
const apiKey = process.env.CURSOR_API_KEY ?? "";

if (apiKey.length === 0) {
  console.log("cleanup skipped: CURSOR_API_KEY is unset");
} else {
  let state;
  try {
    state = JSON.parse(await readFile(statePath, "utf8"));
  } catch {
    console.log("cleanup skipped: no active agent");
    state = undefined;
  }
  if (state?.agentId) {
    const auth = `Basic ${Buffer.from(`${apiKey}:`, "utf8").toString("base64")}`;
    const agentId = encodeURIComponent(state.agentId);
    if (typeof state.runId === "string") {
      const cancel = await fetch(`https://api.cursor.com/v1/agents/${agentId}/runs/${encodeURIComponent(state.runId)}/cancel`, {
        method: "POST",
        headers: { Accept: "application/json", Authorization: auth },
      });
      console.log(`cleanup cancel ${cancel.status}`);
    }
    const deleted = await fetch(`https://api.cursor.com/v1/agents/${agentId}`, {
      method: "DELETE",
      headers: { Accept: "application/json", Authorization: auth },
    });
    console.log(`cleanup delete ${deleted.status}`);
    if (deleted.status === 200 || deleted.status === 404) {
      await rm(statePath, { force: true });
    } else {
      const archived = await fetch(`https://api.cursor.com/v1/agents/${agentId}/archive`, {
        method: "POST",
        headers: { Accept: "application/json", Authorization: auth },
      });
      console.log(`cleanup archive ${archived.status}`);
      if (archived.status === 200 || archived.status === 404) await rm(statePath, { force: true });
    }
  }
}
