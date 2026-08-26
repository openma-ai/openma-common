import { describe, expect, it } from "vitest";

import {
  agentUILiveActivityState,
  agentUITurnElapsedSeconds,
  projectAgentUITurnItems,
} from "../src/agent-ui/presentation.js";
import type {
  AgentUITimelineItem,
  AgentUITurnState,
} from "../src/agent-ui/index.js";

function turn(
  items: AgentUITimelineItem[],
  status: AgentUITurnState["status"] = "running",
): AgentUITurnState {
  return { id: "turn-1", status, items };
}

const answer = (text = "words"): AgentUITimelineItem => ({
  id: "answer",
  kind: "message",
  role: "assistant",
  text,
  status: "streaming",
});
const thought = (text = "reasoning"): AgentUITimelineItem => ({
  id: "thought",
  kind: "thinking",
  role: "assistant",
  text,
  status: "streaming",
});
const tool = (
  id: string,
  status: "pending" | "in_progress" | "completed" = "completed",
): AgentUITimelineItem => ({
  id,
  kind: "tool",
  title: "cargo test",
  status,
  outputs: [],
});

describe("Backchat main Agent UI presentation", () => {
  it("keeps Codex thought in state but treats it as transient after an answer", () => {
    const state = turn([thought("Planning a temporary status"), answer("Finished.")], "completed");

    expect(state.items[0]).toMatchObject({
      kind: "thinking",
      text: "Planning a temporary status",
    });
    expect(projectAgentUITurnItems(state, { thoughts: "transient" })).toEqual([
      state.items[1],
    ]);
  });

  it("groups across thoughts by removing a transient thought once a tool follows", () => {
    const state = turn([
      tool("one"),
      thought("Planning the next command"),
      tool("two"),
    ]);

    expect(projectAgentUITurnItems(state, { thoughts: "transient" })).toEqual([
      state.items[0],
      state.items[2],
    ]);
  });

  it("keeps the live tail thought visible while reasoning", () => {
    const state = turn([tool("one"), thought("Planning")]);

    expect(projectAgentUITurnItems(state, { thoughts: "transient" })).toEqual(
      state.items,
    );
  });

  it("preserves thought history for a harness whose presentation is not transient", () => {
    const state = turn([thought("Planning"), answer("Done")], "completed");

    expect(projectAgentUITurnItems(state, { thoughts: "history" })).toEqual(
      state.items,
    );
  });

  it.each([
    { name: "settled", state: turn([answer()], "completed"), expected: { kind: "settled" } },
    { name: "answering", state: turn([tool("one"), answer()]), expected: { kind: "answering" } },
    { name: "reasoning", state: turn([tool("one", "in_progress"), thought()]), expected: { kind: "reasoning" } },
    { name: "running", state: turn([answer(), tool("one", "in_progress")]), expected: { kind: "running", command: "cargo test" } },
    { name: "tools", state: turn([tool("one")]), expected: { kind: "tools", command: "cargo test" } },
    { name: "waiting", state: turn([]), expected: { kind: "waiting" } },
  ])("matches Backchat's $name live activity state", ({ state, expected }) => {
    expect(
      agentUILiveActivityState({
        turn: state,
        describeTool: (item) => item.title ?? "",
      }),
    ).toEqual(expected);
  });

  it("uses Backchat's ceil-to-seconds turn duration for live and settled turns", () => {
    const startedAt = "2026-08-26T10:00:00.000Z";
    expect(agentUITurnElapsedSeconds({
      ...turn([]),
      startedAt,
    }, Date.parse(startedAt) + 1_001)).toBe(2);
    expect(agentUITurnElapsedSeconds({
      ...turn([], "completed"),
      startedAt,
      endedAt: "2026-08-26T10:02:05.000Z",
    }, Date.parse(startedAt) + 999_999)).toBe(125);
  });
});
