import type { AgentUITimelineItem, AgentUIToolItem, AgentUITurnState } from "./index.js";
export type AgentUIThoughtPresentation = "transient" | "history";
/** Backchat main keeps Codex thoughts in state, but only projects the live tail. */
export declare function projectAgentUITurnItems(turn: AgentUITurnState, options: {
    thoughts: AgentUIThoughtPresentation;
}): AgentUITimelineItem[];
/** The chronological prefix collapsed into Backchat's process disclosure. */
export declare function agentUIProcessEndIndex(items: readonly AgentUITimelineItem[]): number;
export type AgentUILiveActivityState = {
    kind: "settled";
} | {
    kind: "answering";
} | {
    kind: "reasoning";
} | {
    kind: "running";
    command: string;
} | {
    kind: "tools";
    command: string;
} | {
    kind: "waiting";
};
export declare function agentUILiveActivityState({ turn, describeTool, }: {
    turn: AgentUITurnState;
    describeTool: (tool: AgentUIToolItem) => string;
}): AgentUILiveActivityState;
export declare function isAgentUIToolRunning(status: AgentUIToolItem["status"]): boolean;
export declare function agentUITurnElapsedSeconds(turn: AgentUITurnState, now?: number): number;
//# sourceMappingURL=presentation.d.ts.map