import { type TurnRender } from "./acp.js";
export interface WireSessionEvent {
    type: string;
    [key: string]: unknown;
}
export type ToolFamily = "builtin" | "custom" | "mcp";
export interface CanonicalTool {
    id: string;
    family: ToolFamily;
    name: string;
    input?: unknown;
    output?: unknown;
    status: "pending" | "running" | "completed" | "failed";
    isError?: boolean;
    rawUse?: WireSessionEvent;
    rawResult?: WireSessionEvent;
}
export type NormalizedSessionEvent = {
    kind: "user_message";
    id: string;
    text: string;
    raw: WireSessionEvent;
} | {
    kind: "assistant_delta";
    id: string;
    text: string;
    raw: WireSessionEvent;
} | {
    kind: "assistant_message";
    id: string;
    text: string;
    raw: WireSessionEvent;
} | {
    kind: "assistant_stream_end";
    id?: string;
    raw: WireSessionEvent;
} | {
    kind: "thinking_delta";
    id: string;
    text: string;
    raw: WireSessionEvent;
} | {
    kind: "thinking";
    id: string;
    text: string;
    raw: WireSessionEvent;
} | {
    kind: "thinking_stream_end";
    id?: string;
    raw: WireSessionEvent;
} | {
    kind: "tool_input_start";
    toolId: string;
    name: string;
    raw: WireSessionEvent;
} | {
    kind: "tool_use";
    tool: CanonicalTool;
    raw: WireSessionEvent;
} | {
    kind: "tool_result";
    toolId: string;
    output: unknown;
    isError: boolean;
    raw: WireSessionEvent;
} | {
    kind: "notice";
    tone: "warning" | "error";
    message: string;
    source?: string;
    raw: WireSessionEvent;
} | {
    kind: "turn_running";
    raw: WireSessionEvent;
} | {
    kind: "turn_complete";
    raw: WireSessionEvent;
} | {
    kind: "turn_terminated";
    raw: WireSessionEvent;
} | {
    kind: "ignore";
    raw: WireSessionEvent;
};
export type ConversationItem = {
    kind: "message";
    id: string;
    role: "user" | "assistant";
    text: string;
    raw: WireSessionEvent;
} | {
    kind: "thinking";
    id: string;
    text: string;
    raw: WireSessionEvent;
} | {
    kind: "tool";
    id: string;
    tool: CanonicalTool;
    raw: WireSessionEvent;
} | {
    kind: "notice";
    id: string;
    tone: "warning" | "error";
    message: string;
    source?: string;
    cause?: {
        error: string;
        model?: string;
    };
    raw: WireSessionEvent;
};
export interface ConversationTurn {
    id: string;
    status: "running" | "completed" | "errored" | "terminated";
    items: ConversationItem[];
    rawEvents: WireSessionEvent[];
}
export interface CanonicalChatTurn {
    id: string;
    status: ConversationTurn["status"];
    userText: string;
    render: TurnRender;
    rawEvents: WireSessionEvent[];
}
export declare function eventText(content: unknown): string;
export declare function eventThreadId(event: WireSessionEvent): string;
export declare function eventStableId(event: WireSessionEvent, fallback: string): string;
export declare function normalizeSessionEvent(event: WireSessionEvent): NormalizedSessionEvent;
export declare function projectConversationTurns(events: readonly WireSessionEvent[], options?: {
    threadId?: string;
}): ConversationTurn[];
/** Adapt Managed's event vocabulary to the richer ACP/Backchat render model.
 * The renderer can therefore consume one `TurnRender` whether events came
 * from a local ACP child or OpenManaged's cloud/local runtime. */
export declare function projectCanonicalChatTurns(events: readonly WireSessionEvent[], options?: {
    threadId?: string;
}): CanonicalChatTurn[];
//# sourceMappingURL=managed.d.ts.map