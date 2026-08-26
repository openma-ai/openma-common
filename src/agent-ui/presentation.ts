import type {
  AgentUITimelineItem,
  AgentUIToolItem,
  AgentUITurnState,
} from "./index.js";

export type AgentUIThoughtPresentation = "transient" | "history";

/** Backchat main keeps Codex thoughts in state, but only projects the live tail. */
export function projectAgentUITurnItems(
  turn: AgentUITurnState,
  options: { thoughts: AgentUIThoughtPresentation },
): AgentUITimelineItem[] {
  if (options.thoughts === "history") return turn.items;
  const liveThoughtIndex = turn.status === "running"
    && turn.items.at(-1)?.kind === "thinking"
    ? turn.items.length - 1
    : -1;
  return turn.items.filter(
    (item, index) => item.kind !== "thinking" || index === liveThoughtIndex,
  );
}

/** The chronological prefix collapsed into Backchat's process disclosure. */
export function agentUIProcessEndIndex(items: readonly AgentUITimelineItem[]): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item) continue;
    if (item.kind !== "message") return index;
    if (item.role !== "assistant" || item.phase === "commentary") return index;
  }
  return -1;
}

export type AgentUILiveActivityState =
  | { kind: "settled" }
  | { kind: "answering" }
  | { kind: "reasoning" }
  | { kind: "running"; command: string }
  | { kind: "tools"; command: string }
  | { kind: "waiting" };

export function agentUILiveActivityState({
  turn,
  describeTool,
}: {
  turn: AgentUITurnState;
  describeTool: (tool: AgentUIToolItem) => string;
}): AgentUILiveActivityState {
  if (turn.status !== "running") return { kind: "settled" };
  const tail = turn.items.at(-1);
  if (tail?.kind === "thinking") return { kind: "reasoning" };

  let lastAssistantIndex = -1;
  for (let index = turn.items.length - 1; index >= 0; index -= 1) {
    const item = turn.items[index];
    if (item?.kind === "message" && item.role === "assistant") {
      lastAssistantIndex = index;
      break;
    }
  }
  const liveTools = turn.items
    .slice(lastAssistantIndex + 1)
    .filter((item): item is AgentUIToolItem => item.kind === "tool");
  let running: AgentUIToolItem | undefined;
  for (let index = liveTools.length - 1; index >= 0; index -= 1) {
    const item = liveTools[index];
    if (item && isAgentUIToolRunning(item.status)) {
      running = item;
      break;
    }
  }
  if (running) {
    const command = describeTool(running).trim();
    if (command) return { kind: "running", command };
  }
  if (tail?.kind === "message" && tail.role === "assistant") {
    return { kind: "answering" };
  }
  const lastTool = liveTools.at(-1);
  if (lastTool) {
    const command = describeTool(lastTool).trim();
    if (command) return { kind: "tools", command };
  }
  return { kind: "waiting" };
}

export function isAgentUIToolRunning(status: AgentUIToolItem["status"]): boolean {
  return status === "pending" || status === "in_progress";
}

export function agentUITurnElapsedSeconds(
  turn: AgentUITurnState,
  now = Date.now(),
): number {
  const startedAt = turn.startedAt ? Date.parse(turn.startedAt) : NaN;
  if (!Number.isFinite(startedAt)) return 0;
  const endedAt = turn.status === "running" || !turn.endedAt
    ? now
    : Date.parse(turn.endedAt);
  if (!Number.isFinite(endedAt)) return 0;
  return Math.max(0, Math.ceil((endedAt - startedAt) / 1_000));
}
