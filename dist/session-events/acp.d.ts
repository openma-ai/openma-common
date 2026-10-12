/**
 * Reduce an array of ACP `session.event` payloads into the bubble structure
 * the chat view renders.
 *
 *   - `agent_message_chunk` (type=text) → concatenated into a single
 *     assistant bubble (one per turn).
 *   - `agent_thought_chunk` (type=text) → concatenated into an optional
 *     "Thinking" reasoning block above the assistant bubble.
 *   - `tool_call` → a new `ToolEntry` with status/title/etc, content[]
 *     blocks (diff / terminal / image / content), and locations[].
 *   - `tool_call_update` → PATCH onto an existing tool by toolCallId.
 *   - `plan`             → REPLACE the current plan (no merging).
 *   - `available_commands_update` → REPLACE the per-session slash command
 *     list. The session store, not reduceTurn, owns this — it's
 *     session-scoped, not turn-scoped — but we surface it here so the
 *     reducer test can verify the dispatch path.
 *   - `current_mode_update` → REPLACE the agent's current mode id.
 *   - session-level metadata is handled by SessionStore before this reducer.
 *
 * reduceTurn is the pure convenience wrapper; live callers retain a projector
 * and apply only newly received events.
 */
export { extractAcpSystemNotice, type AcpSystemNotice } from "./acp-system-notices.js";
/** Internal transport context added when the ACP SDK gives OpenMA a
 * notification-scoped `_meta` alongside `params.update`. The explicit key
 * keeps wire-layer metadata separate from update/harness `_meta` while the
 * existing flat update shape remains compatible with consumers. */
export declare const ACP_NOTIFICATION_CONTEXT_KEY: "_openma.acp.notification";
export declare function preserveAcpNotificationContext(params: unknown): unknown;
export interface ChunkText {
    text: string;
}
export interface ToolEntry {
    toolCallId: string;
    title?: string;
    kind?: string;
    status?: "pending" | "in_progress" | "completed" | "failed" | string;
    rawInput?: unknown;
    rawOutput?: unknown;
    toolName?: string;
    /** Vendor/implementation extension data carried by ACP `_meta`. ACP
     *  explicitly reserves this shape for custom protocol details. */
    meta?: Record<string, unknown>;
    /** Known vendor extension used by claude-agent-acp to associate subagent
     *  child tool calls with the parent Task/Agent tool use. */
    parentToolUseId?: string;
    /** ACP tool content blocks. Each block is one of:
     *    { type: "content", content: { type: "text" | "image" | ..., ... } }
     *    { type: "diff", path, oldText, newText }
     *    { type: "terminal", terminalId }
     *  Patch semantics on tool_call_update: when content arrives in an
     *  update, REPLACE the array (matches Zed's reference client). */
    content?: ToolContentBlock[];
    /** Files / URLs the tool touched. Renderer turns these into clickable
     *  links above the disclosure. */
    locations?: Array<{
        path?: string;
        line?: number;
    }>;
}
interface ToolOutputDelta {
    data: string;
    /** Terminal output is byte-stream-like; MCP progress is line-oriented. */
    separator: string;
}
interface NormalizedToolPatch extends Partial<ToolEntry> {
    toolCallId: string;
    /** Incoming-only adapter extension data consumed by reduceTurn. */
    outputDelta?: ToolOutputDelta;
}
export type ToolContentBlock = {
    type: "content";
    content?: {
        type?: string;
        text?: string;
        uri?: string;
        name?: string;
        mimeType?: string;
        data?: string;
    };
} | {
    type: "diff";
    path?: string;
    oldText?: string;
    newText?: string;
} | {
    type: "terminal";
    terminalId?: string;
};
export interface PlanEntry {
    id?: string;
    content: string;
    status?: "pending" | "in_progress" | "completed" | "cancelled";
    priority?: "high" | "medium" | "low";
}
export interface PlanDocument {
    id?: string;
    title?: string;
    type?: "markdown" | "file";
    markdown?: string;
    uri?: string;
}
export type TimelineItem = {
    /** Adjacent assistant chunks in the same phase and message append here. */
    kind: "assistant_text";
    text: string;
    phase?: "commentary" | "final_answer";
} | {
    /** Adjacent chunks sharing a messageId patch the open thought item. */
    kind: "thought";
    messageId?: string;
    text: string;
} | {
    /** Pointer to a ToolEntry; the renderer looks the entry up in `tools`
     *  by id rather than embedding it inline so tool_call_update events
     *  that PATCH the tool still flow through. */
    kind: "tool";
    toolCallId: string;
} | {
    kind: "user_input";
    text: string;
    clientId?: string;
};
export interface TurnRender {
    thoughtText: string;
    /** The latest text from the open thought segment, if one exists. */
    currentThoughtText: string;
    assistantText: string;
    tools: ToolEntry[];
    plan: PlanEntry[];
    planDocument?: PlanDocument;
    /** Synthetic runtime notes that belong in the activity transcript. */
    notes: string[];
    /** Time-ordered list of "what to render between thought and assistant
     *  tail". Assistant message chunks and tool_calls interleave in the
     *  ACP stream — agents say "I'll look at X", call read_text_file,
     *  then say "now I'll edit Y" and call write_text_file. Lumping all
     *  text after all tools (the old behavior) reads as "did a bunch of
     *  things, then explained". This list preserves the order. */
    timeline: TimelineItem[];
}
export interface AvailableCommand {
    name: string;
    description?: string;
    input?: {
        hint?: string;
    } | null;
}
export type ParsedAcpEvent = {
    kind: "text";
    text: string;
    phase?: "commentary" | "final_answer";
    messageId?: string;
    /** Claude Agent ACP's nested transcript correlation. */
    parentToolUseId?: string;
    event: unknown;
} | {
    kind: "thought";
    text: string;
    messageId?: string;
    /** Claude Agent ACP's nested transcript correlation. */
    parentToolUseId?: string;
    event: unknown;
} | {
    kind: "notice";
    notice: string;
    event: unknown;
} | {
    kind: "tool_call";
    tool: NormalizedToolPatch;
    event: unknown;
} | {
    kind: "commands";
    commands: AvailableCommand[];
    event: unknown;
} | {
    kind: "plan";
    planId?: string;
    updateMode?: "replace" | "merge";
    plan: PlanEntry[];
    document?: PlanDocument;
    event: unknown;
} | {
    kind: "plan_document";
    document?: PlanDocument;
    event: unknown;
} | {
    kind: "plan_removed";
    planId?: string;
    event: unknown;
} | {
    kind: "note";
    note: string;
    event: unknown;
} | {
    kind: "silent";
    event: unknown;
} | {
    kind: "raw";
    event: unknown;
};
export declare function sessionUpdateInner(event: unknown): Record<string, unknown>;
export declare function sessionUpdateType(event: unknown): string | undefined;
export declare function sanitizeThoughtText(text: string): string;
export declare function parseAcpEvent(event: unknown): ParsedAcpEvent;
export declare function mergeStreamingText(accumulated: string, incoming: string): string;
export declare function createTurnProjector(): {
    apply(entry: {
        payload: unknown;
    }): void;
    snapshot(): TurnRender;
};
export declare function reduceTurn(events: readonly {
    payload: unknown;
}[]): TurnRender;
export declare function latestThoughtSegment(text: string): string;
/** @deprecated Use @openma/common/protocol/acp for the SDK codec. */
export * from "../protocol/acp/index.js";
//# sourceMappingURL=acp.d.ts.map