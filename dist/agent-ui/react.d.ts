import type { AgentUIState, AgentUIStore, AgentUIStreamSubscriber } from "./index.js";
export interface StreamTextPacer {
    enqueue(text: string): void;
    flush(): void;
    dispose(): void;
}
export interface StreamTextPacerOptions {
    write(text: string): void;
    schedule(callback: () => void, delayMs: number): unknown;
    cancel(handle: unknown): void;
    onDrain?(): void;
}
/** Backchat main's Unicode-aware stream pacer. */
export declare function createStreamTextPacer({ write, schedule, cancel, onDrain, }: StreamTextPacerOptions): StreamTextPacer;
/** React binding for the framework-neutral Agent UI store. */
export declare function useAgentUIState(store: AgentUIStore): AgentUIState;
export interface AgentUIStreamingMarkdownProps {
    store: AgentUIStreamSource;
    turnId: string;
    kind: "assistant" | "thought";
    className?: string;
    prefixSkip?: number;
    paceReplay?: boolean;
    onLinkActivate?: (url: string) => void;
    decorate?: (host: HTMLDivElement) => void;
}
/** Minimal AI-SDK-like stream contract. A host can feed the shared renderer
 * from the canonical Agent UI store or from an existing product transport
 * adapter without exposing that transport to the component. */
export interface AgentUIStreamSource {
    subscribeTurnStream(turnId: string, listener: AgentUIStreamSubscriber): () => void;
}
/**
 * The DOM-mutating half of Backchat main's dual-track renderer. React owns
 * one inert host node; the per-turn stream writes markdown directly until the
 * parent swaps this element for its settled renderer.
 */
export declare function AgentUIStreamingMarkdown({ store, turnId, kind, className, prefixSkip, paceReplay, onLinkActivate, decorate, }: AgentUIStreamingMarkdownProps): import("react").JSX.Element;
export declare function thoughtProjectionLines(text: string, fallback: string): string[];
export declare function thoughtHeadline(text: string): string;
export declare function AgentUIStreamingThoughtProjection({ store, turnId, prefixSkip, fallback, mode, }: {
    store: AgentUIStore;
    turnId: string;
    prefixSkip: number;
    fallback: string;
    mode: "body" | "headline";
}): import("react").JSX.Element;
//# sourceMappingURL=react.d.ts.map