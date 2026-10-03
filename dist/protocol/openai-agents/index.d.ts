/**
 * OpenAI Agents → OpenMA event decoder.
 *
 * Direct port of backchat `DirectAgentRuntime` at `64fd74d`
 * (`src/main/direct-agent-runtime.ts`): `#item`, `#turn`, `#openaiEvent`,
 * `#pending`, `#vendor`, and `#event`. `#wrap` stays in backchat; it only
 * builds the desktop task envelope around the canonical event.
 * `pendingActions` / `custom_result` stay there too.
 * `decodeOpenAIAgentsPendingActions` returns the `required_actions` vendor
 * event plus the `function_call` entries themselves.
 *
 * Input types are structural on purpose. That commit duck-types items
 * (`"status" in item`, `type.endsWith("_call")`) instead of switching on the
 * SDK union, and the contract is byte-for-byte output against that commit.
 * An optional `openai` peer would not make the mapping exhaustive the way
 * `@anthropic-ai/sdk` does for Managed Agents.
 */
import { type OpenMAEvent } from "../../session-events/openma.js";
export interface OpenAIAgentsDecodeContext {
    sessionId: string;
    /**
     * Replaces `new Date()` in the backchat mapper. Turn events ignore this
     * and use `completed_at ?? created_at` (Unix seconds → ISO).
     */
    now: () => string;
}
export interface OpenAIAgentsPendingContext extends OpenAIAgentsDecodeContext {
    /**
     * History supplies `required:${uuid}`. Stream session events derive
     * `${event_id}:required` themselves.
     */
    eventId: string;
}
export interface OpenAIAgentsItem {
    type: string;
    id?: string | null;
    turn_id?: string;
    status?: string;
    role?: string;
    content?: unknown;
    summary?: unknown;
    call_id?: string;
    output?: unknown;
    error?: unknown;
    name?: unknown;
    arguments?: unknown;
    command?: unknown;
    [key: string]: unknown;
}
export interface OpenAIAgentsTurn {
    id: string;
    status: string;
    created_at: number;
    completed_at?: number | null;
    error?: {
        message?: string;
        [key: string]: unknown;
    } | null;
    [key: string]: unknown;
}
export interface OpenAIAgentsRequiredAction {
    type: string;
    call_id?: string;
    name?: string;
    arguments?: unknown;
    turn_id?: string;
    [key: string]: unknown;
}
export interface OpenAIAgentsSessionSnapshot {
    status?: string;
    error?: unknown;
    required_actions?: readonly OpenAIAgentsRequiredAction[];
    [key: string]: unknown;
}
export interface OpenAIAgentsStreamEvent {
    type: string;
    event_id: string;
    item_id?: string;
    delta?: string;
    turn_id?: string | null;
    item?: OpenAIAgentsItem;
    turn?: OpenAIAgentsTurn;
    session?: OpenAIAgentsSessionSnapshot;
    [key: string]: unknown;
}
/** Fields backchat reads off a pending `function_call`. Not `custom_result`. */
export interface OpenAIAgentsPendingFunctionCall {
    type: "function_call";
    call_id: string;
    name: string;
    arguments: unknown;
    turn_id: string;
}
export interface OpenAIAgentsPendingResult {
    event: OpenMAEvent;
    functionCalls: OpenAIAgentsPendingFunctionCall[];
}
export declare function decodeOpenAIAgentsItem(item: OpenAIAgentsItem, context: OpenAIAgentsDecodeContext): OpenMAEvent;
export declare function decodeOpenAIAgentsTurn(turn: OpenAIAgentsTurn, context: OpenAIAgentsDecodeContext): OpenMAEvent;
export declare function decodeOpenAIAgentsPendingActions(session: OpenAIAgentsSessionSnapshot, context: OpenAIAgentsPendingContext): OpenAIAgentsPendingResult;
export declare function decodeOpenAIAgentsStreamEvent(event: OpenAIAgentsStreamEvent, context: OpenAIAgentsDecodeContext): OpenMAEvent[];
//# sourceMappingURL=index.d.ts.map