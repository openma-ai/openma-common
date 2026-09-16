import type { ManagedHarnessSemanticRecoveryPort } from "./index.js";
import type { ManagedHarnessRecoveryReason } from "./index.js";
export type ManagedRecoveryContentBlock = {
    type: "text";
    text: string;
} | {
    type: "image" | "document";
    source: {
        file_id?: string;
        url?: string;
    };
    title?: string;
};
type Extensible<T> = T & {
    [key: string]: unknown;
};
export type ManagedRecoveryEvent = Extensible<{
    type: "user.message" | "agent.message";
    content: ManagedRecoveryContentBlock[];
}> | Extensible<{
    type: "agent.thread_context_compacted";
    summary?: ManagedRecoveryContentBlock[];
}> | Extensible<{
    type: "agent.tool_use" | "agent.custom_tool_use";
    id: string;
    name: string;
}> | Extensible<{
    type: "agent.mcp_tool_use";
    id: string;
    name: string;
    mcp_server_name: string;
}> | Extensible<{
    type: "agent.tool_result";
    tool_use_id: string;
    content: string | ManagedRecoveryContentBlock[];
}> | Extensible<{
    type: "agent.mcp_tool_result";
    mcp_tool_use_id: string;
    content: string;
    is_error?: boolean;
}> | Extensible<{
    type: "user.custom_tool_result";
    custom_tool_use_id: string;
    content: ManagedRecoveryContentBlock[];
}>;
export interface ManagedHarnessRecoveryHistoryPort {
    list(sessionId: string): Promise<readonly ManagedRecoveryEvent[]>;
}
export interface ManagedEventSemanticRecoveryOptions {
    history: ManagedHarnessRecoveryHistoryPort;
    maxCharacters?: number;
}
/** Builds a bounded, side-effect-safe ACP recovery turn from canonical
 * Managed Events. Native agent formats are intentionally never synthesized. */
export declare function createManagedEventSemanticRecovery(options: ManagedEventSemanticRecoveryOptions): ManagedHarnessSemanticRecoveryPort;
export declare function buildManagedEventRecoveryPrompt(events: readonly ManagedRecoveryEvent[], currentPrompt: string, options: {
    reason: ManagedHarnessRecoveryReason;
    maxCharacters?: number;
}): string;
export {};
//# sourceMappingURL=semantic-recovery.d.ts.map