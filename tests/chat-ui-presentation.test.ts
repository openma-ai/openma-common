import { describe, expect, it } from "vitest";

import type {
  AgentUITimelineItem,
  AgentUIToolItem,
  AgentUITurnState,
} from "../src/agent-ui/index.js";
import {
  agentUIToolRunSummaryKinds,
  groupAgentUIActivityEvents,
  pickAgentUIToolActivityTarget,
  projectAgentUIActivityTools,
} from "../src/chat-ui/presentation.js";

function turn(
  items: AgentUITimelineItem[],
  status: AgentUITurnState["status"] = "running",
): AgentUITurnState {
  return { id: "turn-1", status, items };
}

function tool(
  id: string,
  overrides: Partial<AgentUIToolItem> = {},
): AgentUIToolItem {
  return {
    id,
    kind: "tool",
    toolKind: "execute",
    title: id,
    status: "completed",
    outputs: [],
    ...overrides,
  };
}

describe("Backchat main activity projection", () => {
  it("keeps only the latest completed duplicate and latest running tool", () => {
    const state = turn([
      tool("old", {
        toolKind: "read",
        title: "Read file '/tmp/a'",
        locations: [{ path: "/tmp/a" }],
      }),
      tool("new", {
        toolKind: "read",
        title: "Read file '/tmp/a'",
        locations: [{ path: "/tmp/a" }],
      }),
      tool("running-old", { status: "pending" }),
      tool("running-new", { status: "in_progress" }),
    ]);

    const projection = projectAgentUIActivityTools(state, true);

    expect([...projection.visibleToolIds]).toEqual(["new"]);
    expect(projection.activeTool?.id).toBe("running-new");
  });

  it("collapses one uninterrupted tool/thought sequence into one group", () => {
    const one = tool("one");
    const two = tool("two");
    const state = turn([
      one,
      {
        id: "thought",
        kind: "thinking",
        role: "assistant",
        text: "Planning",
        status: "complete",
      },
      two,
    ]);

    const groups = groupAgentUIActivityEvents(state.items, {
      toolsById: new Map([
        [one.id, one],
        [two.id, two],
      ]),
    });

    expect([...groups.values()]).toEqual([
      [
        { item: one, index: 0, tool: one },
        { item: state.items[1], index: 1 },
        { item: two, index: 2, tool: two },
      ],
    ]);
  });

  it("uses assistant text as the exact activity group boundary", () => {
    const one = tool("one");
    const two = tool("two");
    const state = turn([
      one,
      {
        id: "commentary",
        kind: "message",
        role: "assistant",
        phase: "commentary",
        text: "Checking another source.",
        status: "complete",
      },
      two,
    ]);

    const groups = groupAgentUIActivityEvents(state.items, {
      toolsById: new Map([
        [one.id, one],
        [two.id, two],
      ]),
    });

    expect([...groups.values()].map((group) => group.map((node) => node.index)))
      .toEqual([[0], [2]]);
  });

  it("copies Backchat's tool target and run-summary semantics", () => {
    const command = tool("shell", {
      toolKind: "execute",
      title: "bash",
      rawInput: { command: ["bash", "-lc", "pnpm test -- --run"] },
    });
    const read = tool("read", { toolKind: "read" });

    expect(pickAgentUIToolActivityTarget(command)).toBe("pnpm test -- --run");
    expect(agentUIToolRunSummaryKinds([read, command, tool("again")])).toEqual([
      { kind: "read", count: 1 },
      { kind: "execute", count: 2 },
    ]);
  });
});
