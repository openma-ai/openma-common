// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { projectAcpChatTurn } from "../src/chat-ui/acp.js";
import { AgentUITurnView } from "../src/chat-ui/components.js";
import { agentUITurnElapsedSeconds } from "../src/agent-ui/presentation.js";
import type { AgentUITurnState } from "../src/agent-ui/index.js";
import { projectCanonicalChat, type WireSessionEvent } from "../src/session-events/managed.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function fixture(name: string): WireSessionEvent[] {
  const path = resolve(import.meta.dirname, `fixtures/managed-sessions/${name}.json`);
  return (JSON.parse(readFileSync(path, "utf8")) as { data: WireSessionEvent[] }).data;
}

let root: ReturnType<typeof createRoot> | undefined;
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ""; });

function render(turn: AgentUITurnState) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(
    <AgentUITurnView
      sessionId="s"
      turn={turn}
      thoughts="history"
      labels={{
        workingFor: (s) => `Working for ${s}s`,
        workedFor: (s) => `Worked for ${s}s`,
        thinking: "Thinking",
        toolRunSummary: () => "Ran commands",
        toolActivity: (item) => item.title ?? "Tool",
      }}
      slots={{ renderAssistant: ({ item }) => <p>{item.text}</p>, renderTool: ({ tool }) => <p>{tool.title}</p> }}
    />,
  ));
  return host;
}

const awaitingTurn: AgentUITurnState = {
  id: "t",
  status: "awaiting",
  promptText: "Do the thing",
  startedAt: "2026-10-31T15:50:57.835Z",
  endedAt: "2026-10-31T15:51:52.953Z",
  items: [
    { id: "m", kind: "message", role: "assistant", text: "note", phase: "commentary", status: "complete" },
    { id: "run", kind: "tool", toolKind: "execute", title: "run", status: "pending", outputs: [] },
  ],
};

describe("awaiting (requires_action) turns", () => {
  it("projection exposes real start/end from event timestamps and keeps the prompt", () => {
    const [turn] = projectCanonicalChat(fixture("session_e434d0ba91be4541bde691a99938fc10")).turns;
    expect(turn!.status).toBe("awaiting");
    expect(turn!.userText).toContain("Scaffold a small Python project");
    expect(turn!.startedAt).toBe("2026-10-31T15:50:57.835Z");
    expect(turn!.endedAt).toBe("2026-10-31T15:51:52.953Z");
    const b5c5 = projectCanonicalChat(fixture("session_b5c5f215c4bb4ee3a6919192ba1d1805")).turns;
    for (const t of b5c5) {
      expect(Date.parse(t.endedAt!) - Date.parse(t.startedAt!)).toBeGreaterThan(0);
    }
  });

  it("elapsed uses the turn's own timestamps, not 0", () => {
    expect(agentUITurnElapsedSeconds(awaitingTurn, Date.parse("2030-01-01"))).toBe(56);
  });

  it("renders in-progress wording, no spinner, and no terminal status line", () => {
    const host = render(awaitingTurn);
    const text = host.textContent ?? "";
    expect(text).toContain("Working for 56s");
    expect(text).not.toContain("Worked for");
    expect(text).not.toContain("terminal status unavailable");
    expect(host.querySelector("[data-session-turn-status='awaiting']")).not.toBeNull();
    expect(host.querySelector("[data-session-process-state='running']")).toBeNull();
  });

  it("acp projection passes awaiting through and keeps pending tools in progress", () => {
    const turn = projectAcpChatTurn({
      id: "t",
      promptText: "p",
      status: "awaiting",
      events: [{ payload: { sessionUpdate: "tool_call", toolCallId: "x", title: "run", kind: "execute", status: "pending" } }],
    } as never);
    expect(turn.status).toBe("awaiting");
    const tool = turn.items.find((item) => item.kind === "tool");
    expect(tool && tool.kind === "tool" ? tool.status : undefined).not.toBe("cancelled");
  });

  it("queue dock list is height-capped so a long queue cannot hide the turn", () => {
    const css = readFileSync(resolve(import.meta.dirname, "../src/chat-ui/styles.css"), "utf8");
    const block = css.match(/\.oma-queue-dock__list \{[^}]*max-height[^}]*\}/)?.[0] ?? "";
    expect(block).toContain("--oma-queue-dock-max-height");
    expect(block).toContain("overflow-y: auto");
  });
});
