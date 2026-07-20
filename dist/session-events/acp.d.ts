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
 * Designed to be pure: pass an immutable event list, get a snapshot.
 * Re-running on each render is cheap because events list grows linearly
 * with the turn length (a few hundred at most).
 */
export { extractAcpSystemNotice, type AcpSystemNotice } from "./acp-system-notices.js";
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
export type ToolContentBlock = {
    type: "content";
    content?: {
        type?: string;
        text?: string;
        uri?: string;
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
    content: string;
    status?: "pending" | "in_progress" | "completed";
    priority?: "high" | "medium" | "low";
}
export type TimelineItem = {
    /** Continuous block of assistant text — concatenated agent_message_chunk
     *  events that arrived without being interrupted by a tool_call. The
     *  next tool_call starts a new segment. */
    kind: "assistant_text";
    text: string;
    phase?: "commentary" | "final_answer";
} | {
    /** One logical thought message. Chunks sharing a messageId patch this
     * item; a new messageId appends a new item to the activity timeline. */
    kind: "thought";
    messageId?: string;
    text: string;
} | {
    /** Pointer to a ToolEntry; the renderer looks the entry up in `tools`
     *  by id rather than embedding it inline so tool_call_update events
     *  that PATCH the tool still flow through. */
    kind: "tool";
    toolCallId: string;
};
export interface TurnRender {
    thoughtText: string;
    /** The current, replaceable thought status at the tail of a running
     * activity stream. Cleared as soon as commentary or a tool follows it. */
    currentThoughtText: string;
    assistantText: string;
    tools: ToolEntry[];
    plan: PlanEntry[];
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
    event: unknown;
} | {
    kind: "thought";
    text: string;
    messageId?: string;
    event: unknown;
} | {
    kind: "notice";
    notice: string;
    event: unknown;
} | {
    kind: "tool_call";
    tool: Partial<ToolEntry> & {
        toolCallId: string;
    };
    event: unknown;
} | {
    kind: "commands";
    commands: AvailableCommand[];
    event: unknown;
} | {
    kind: "plan";
    plan: PlanEntry[];
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
export declare function reduceTurn(events: readonly {
    payload: unknown;
}[]): TurnRender;
export declare function latestThoughtSegment(text: string): string;
//# sourceMappingURL=acp.d.ts.map