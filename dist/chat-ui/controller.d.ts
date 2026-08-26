import { type AgentUIState, type AgentUIStore } from "../agent-ui/index.js";
import { type OpenMAEvent } from "../session-events/openma.js";
export type AgentChatStatus = "ready" | "submitted" | "streaming" | "error";
export interface AgentChatPrompt {
    text: string;
    attachments?: unknown[];
    metadata?: unknown;
}
export interface AgentChatRequestOptions {
    headers?: HeadersInit;
    body?: Record<string, unknown>;
    metadata?: unknown;
}
export interface AgentChatTransport<TPrompt extends AgentChatPrompt = AgentChatPrompt, TSetup = unknown> {
    sendMessages(options: {
        trigger: "submit-message" | "regenerate-message";
        chatId: string;
        turnId: string;
        prompt: TPrompt;
        setup: TSetup | undefined;
        abortSignal: AbortSignal;
    } & AgentChatRequestOptions): Promise<ReadableStream<OpenMAEvent>>;
    reconnectToStream(options: {
        chatId: string;
        setup: TSetup | undefined;
        abortSignal: AbortSignal;
    } & AgentChatRequestOptions): Promise<ReadableStream<OpenMAEvent> | null>;
    stop?(options: {
        chatId: string;
        turnId?: string;
    }): void | Promise<void>;
}
export interface AgentChatController<TPrompt extends AgentChatPrompt = AgentChatPrompt, TSetup = unknown> {
    readonly id: string;
    readonly store: AgentUIStore;
    readonly state: AgentUIState;
    readonly status: AgentChatStatus;
    readonly error: Error | undefined;
    readonly setup: TSetup | undefined;
    sendMessage(prompt: TPrompt, options?: AgentChatRequestOptions & {
        turnId?: string;
    }): Promise<void>;
    regenerate(prompt: TPrompt, options: AgentChatRequestOptions & {
        turnId: string;
    }): Promise<void>;
    resumeStream(options?: AgentChatRequestOptions): Promise<boolean>;
    stop(): Promise<void>;
    clearError(): void;
    subscribe(listener: () => void): () => void;
}
export interface CreateAgentChatControllerOptions<TPrompt extends AgentChatPrompt, TSetup> {
    id: string;
    transport: AgentChatTransport<TPrompt, TSetup>;
    setup?: TSetup;
    createTurnId?: () => string;
    now?: () => Date;
}
/** AI SDK-shaped, framework-neutral chat controller over OpenMA events.
 * It deliberately owns no history adapter or persistence surface. */
export declare function createAgentChatController<TPrompt extends AgentChatPrompt = AgentChatPrompt, TSetup = unknown>({ id, transport, setup, createTurnId, now, }: CreateAgentChatControllerOptions<TPrompt, TSetup>): AgentChatController<TPrompt, TSetup>;
//# sourceMappingURL=controller.d.ts.map