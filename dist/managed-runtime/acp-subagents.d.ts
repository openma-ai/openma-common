import type { ToolEntry } from "../session-events/acp.js";
/** Internal decoding result; persisted output remains the native thread events. */
export interface ChildActivity {
    id: string;
    status: "running" | "completed" | "failed" | "cancelled" | "closed";
    parentToolId?: string;
    parentThreadId?: string;
    name?: string;
    error?: string;
}
/** Lift the provider metadata already understood by OpenMA's ACP views. Tool
 * names alone are insufficient evidence for Codex collaboration lifecycle. */
export declare function decodeChildActivities(value: unknown, tool?: ToolEntry): ChildActivity[];
//# sourceMappingURL=acp-subagents.d.ts.map