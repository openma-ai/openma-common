import type { AgentUITurnState } from "../agent-ui/index.js";
import { type TurnRender } from "../session-events/acp.js";
export type AcpChatTurnStatus = "queued" | "running" | "complete" | "error" | "cancelled" | "unknown";
export interface AcpChatTurnInput {
    id: string;
    promptText: string;
    attachments?: unknown[];
    events: readonly {
        payload: unknown;
        receivedAt?: number;
    }[];
    assistantText?: string;
    status: AcpChatTurnStatus;
    errorMessage?: string;
    startedAt?: number | string;
    endedAt?: number | string;
}
export interface ProjectAcpChatTurnOptions {
    /** A host may already have applied richer plan/tool projection to this view. */
    rendered?: TurnRender;
    omitToolIds?: ReadonlySet<string>;
}
/** Projects Backchat's ACP turn boundary onto the common AI SDK-shaped parts.
 * It is pure, deterministic, and deliberately does not read session storage. */
export declare function projectAcpChatTurn(input: AcpChatTurnInput, options?: ProjectAcpChatTurnOptions): AgentUITurnState;
//# sourceMappingURL=acp.d.ts.map