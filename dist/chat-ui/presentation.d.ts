import type { AgentUIMessageItem, AgentUITimelineItem, AgentUIToolItem, AgentUITurnState } from "../agent-ui/index.js";
export type AgentUIActivityChild = {
    item: AgentUIMessageItem;
    index: number;
} | {
    item: AgentUIToolItem;
    index: number;
    tool: AgentUIToolItem;
};
export interface AgentUIActivityToolProjection {
    activeTool: AgentUIToolItem | undefined;
    visibleToolIds: ReadonlySet<string>;
}
export type AgentUIToolSummaryKind = "read" | "edit" | "delete" | "move" | "search" | "execute" | "fetch" | "think" | "list" | "switchMode" | "other";
/** Backchat's tool projection: one latest completed row per semantic target,
 * plus the latest live tool while a turn is streaming. */
export declare function projectAgentUIActivityTools(turn: AgentUITurnState, isStreaming: boolean): AgentUIActivityToolProjection;
/** Backchat's uninterrupted activity grouping. Assistant text is the only
 * boundary; thoughts and tools remain one chronological disclosure. */
export declare function groupAgentUIActivityEvents(items: readonly AgentUITimelineItem[], { toolsById }: {
    toolsById: ReadonlyMap<string, AgentUIToolItem>;
}): ReadonlyMap<number, AgentUIActivityChild[]>;
export declare function isAgentUIToolRunning(status: AgentUIToolItem["status"] | undefined): boolean;
export declare function settleInterruptedAgentUIToolStatus(status: AgentUIToolItem["status"] | undefined): AgentUIToolItem["status"];
export declare function pickAgentUIToolTarget(tool: AgentUIToolItem): string;
export declare function pickAgentUIToolActivityTarget(tool: AgentUIToolItem, translateSkill?: (name: string) => string): string;
export declare function detectAgentUISkillName(tool: AgentUIToolItem): string | null;
export declare function agentUIToolRunSummaryKinds(tools: readonly AgentUIToolItem[]): Array<{
    kind: AgentUIToolSummaryKind;
    count: number;
}>;
export declare function capitalizeAgentUIToolLabel(value: string): string;
export declare function shortAgentUIToolPath(path: string): string;
//# sourceMappingURL=presentation.d.ts.map