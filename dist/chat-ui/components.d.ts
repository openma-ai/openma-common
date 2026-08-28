import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import type { ComponentProps, CSSProperties, ReactNode, Ref } from "react";
import { StickToBottom } from "use-stick-to-bottom";
import type { AgentUIMessageItem, AgentUIRawItem, AgentUIToolItem, AgentUITurnState } from "../agent-ui/index.js";
import { type AgentUIThoughtPresentation } from "../agent-ui/presentation.js";
import { type SessionTurnStatus } from "../session-ui/index.js";
export declare const ChatCollapsible: import("react").ForwardRefExoticComponent<CollapsiblePrimitive.CollapsibleProps & import("react").RefAttributes<HTMLDivElement>>;
export declare const ChatCollapsibleTrigger: import("react").ForwardRefExoticComponent<CollapsiblePrimitive.CollapsibleTriggerProps & import("react").RefAttributes<HTMLButtonElement>>;
export declare const ChatCollapsibleContent: import("react").ForwardRefExoticComponent<CollapsiblePrimitive.CollapsibleContentProps & import("react").RefAttributes<HTMLDivElement>>;
export interface ChatCollapsiblePrimitives {
    /** Adapter boundary: never leak the common checkout's React/Radix types. */
    Root: (props: any) => any;
    Trigger: (props: any) => any;
    Content: (props: any) => any;
}
export declare const defaultChatCollapsiblePrimitives: ChatCollapsiblePrimitives;
export declare const CHAT_COMPOSER_FRAME_CLASS = "chat-composer-frame mx-auto w-full max-w-3xl min-w-0";
export declare const CHAT_TURN_FRAME_CLASS = "chat-turn-frame mx-auto w-full max-w-3xl min-w-0";
export type ChatConversationProps = Omit<ComponentProps<typeof StickToBottom>, "children"> & {
    children?: ReactNode;
};
export declare function ChatConversation({ className, children, ...props }: ChatConversationProps): import("react").JSX.Element;
export type ChatConversationContentProps = ComponentProps<typeof StickToBottom.Content>;
export declare function ChatConversationContent({ className, ...props }: ChatConversationContentProps): import("react").JSX.Element;
export interface ChatConversationScrollButtonProps extends Omit<ComponentProps<"button">, "children"> {
    icon?: ReactNode;
    renderButton?: (props: {
        onClick: () => void;
        className: string;
        icon: ReactNode;
    }) => ReactNode;
}
export declare function ChatConversationScrollButton({ className, icon, renderButton, ...props }: ChatConversationScrollButtonProps): string | number | bigint | boolean | Iterable<ReactNode> | Promise<string | number | bigint | boolean | import("react").ReactPortal | import("react").ReactElement<unknown, string | import("react").JSXElementConstructor<any>> | Iterable<ReactNode> | null | undefined> | import("react").JSX.Element | null | undefined;
export declare function ChatDisclosureChevron({ open, className, }: {
    open: boolean;
    className?: string;
}): import("react").JSX.Element;
export interface ChatThoughtEventProjection {
    leading?: ReactNode;
    multiline?: boolean;
    summary: ReactNode;
}
export declare function projectChatThoughtEvent({ text, live, liveFallback, completedLabel, renderLiveSummary, }: {
    text: string;
    live: boolean;
    liveFallback: ReactNode;
    completedLabel: ReactNode;
    renderLiveSummary?: (fallback: ReactNode) => ReactNode;
}): ChatThoughtEventProjection;
export declare function ChatThoughtEventRow({ live, text, liveFallback, completedLabel, projection, renderLiveSummary, renderBody, }: {
    live: boolean;
    text: string;
    liveFallback: ReactNode;
    completedLabel: ReactNode;
    projection?: ChatThoughtEventProjection;
    renderLiveSummary?: (fallback: ReactNode) => ReactNode;
    renderBody: (input: {
        live: boolean;
    }) => ReactNode;
}): import("react").JSX.Element;
export type ChatReasoningProps = ComponentProps<typeof ChatCollapsible> & {
    isStreaming?: boolean;
    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
    duration?: number;
    /** Host interaction primitives. Structure and state remain common-owned. */
    primitives?: ChatCollapsiblePrimitives;
};
export declare const ChatReasoning: import("react").NamedExoticComponent<ChatReasoningProps>;
export type ChatReasoningTriggerProps = ComponentProps<typeof ChatCollapsibleTrigger> & {
    getThinkingMessage?: (isStreaming: boolean, duration?: number) => ReactNode;
    showIcon?: boolean;
};
export declare const ChatReasoningTrigger: import("react").NamedExoticComponent<ChatReasoningTriggerProps>;
export type ChatReasoningContentProps = ComponentProps<typeof ChatCollapsibleContent> & {
    children: ReactNode;
};
export declare const ChatReasoningContent: import("react").NamedExoticComponent<ChatReasoningContentProps>;
export interface ChatCollapsibleEventNode {
    key: string;
    projection: {
        leading?: ReactNode;
        multiline?: boolean;
        summary: ReactNode;
    };
    content: ReactNode;
}
export declare function ChatCollapsibleEventSequence({ nodes, active, forceGroup, completedProjection, }: {
    nodes: ChatCollapsibleEventNode[];
    active: boolean;
    forceGroup?: boolean;
    completedProjection: ChatCollapsibleEventNode["projection"];
}): string | number | bigint | boolean | Iterable<ReactNode> | Promise<string | number | bigint | boolean | import("react").ReactPortal | import("react").ReactElement<unknown, string | import("react").JSXElementConstructor<any>> | Iterable<ReactNode> | null | undefined> | import("react").JSX.Element | null;
export interface AgentUITurnLabels {
    workingFor: (seconds: number) => ReactNode;
    workedFor: (seconds: number) => ReactNode;
    thinking: ReactNode;
    thoughtFor?: (seconds: number) => ReactNode;
    toolActivity: (tool: AgentUIToolItem) => ReactNode;
    toolRunSummary: (tools: readonly AgentUIToolItem[]) => ReactNode;
}
export interface AgentUITurnRenderContext {
    turn: AgentUITurnState;
    live: boolean;
    prefixSkip: number;
}
export interface AgentUITurnSlots {
    renderBeforeTurn?: (input: {
        turn: AgentUITurnState;
    }) => ReactNode;
    renderPrompt?: (input: {
        item: AgentUIMessageItem;
        turn: AgentUITurnState;
    }) => ReactNode;
    renderAssistant: (input: AgentUITurnRenderContext & {
        item: AgentUIMessageItem;
        section: "process" | "answer";
    }) => ReactNode;
    renderThought?: (input: AgentUITurnRenderContext & {
        item: AgentUIMessageItem;
    }) => ReactNode;
    renderTool: (input: AgentUITurnRenderContext & {
        tool: AgentUIToolItem;
    }) => ReactNode;
    renderRaw?: (input: AgentUITurnRenderContext & {
        item: AgentUIRawItem;
    }) => ReactNode;
    renderError?: (input: {
        turn: AgentUITurnState;
        message: string | undefined;
    }) => ReactNode;
    projectThoughtActivity?: (input: AgentUITurnRenderContext & {
        item: AgentUIMessageItem;
    }) => ChatCollapsibleEventNode["projection"];
    projectToolActivity?: (input: AgentUITurnRenderContext & {
        tool: AgentUIToolItem;
    }) => ChatCollapsibleEventNode["projection"];
    projectToolRun?: (input: {
        turn: AgentUITurnState;
        tools: readonly AgentUIToolItem[];
        active: boolean;
    }) => ChatCollapsibleEventNode["projection"];
    renderResponseBeforeProcess?: (input: AgentUITurnRenderContext) => ReactNode;
    hasSupplementalProcess?: (input: AgentUITurnRenderContext) => boolean;
    renderProcessBefore?: (input: AgentUITurnRenderContext) => ReactNode;
    renderProcessAfter?: (input: AgentUITurnRenderContext) => ReactNode;
    renderAfterAnswer?: (input: AgentUITurnRenderContext) => ReactNode;
    renderFooter?: (input: AgentUITurnRenderContext) => ReactNode;
}
export interface AgentUITurnViewProps {
    sessionId?: string;
    turn: AgentUITurnState;
    thoughts: AgentUIThoughtPresentation;
    labels: AgentUITurnLabels;
    slots: AgentUITurnSlots;
    className?: string;
    collapsiblePrimitives?: ChatCollapsiblePrimitives;
    frameStatus?: SessionTurnStatus;
    activityTools?: "all" | "latest";
    /** Deterministic clock for tests and non-live projections. */
    now?: number;
}
export interface AgentChatViewSlots {
    empty?: ReactNode;
    composer: ReactNode;
    beforeComposer?: ReactNode;
    homeBeforeComposer?: ReactNode;
    afterComposer?: ReactNode;
    wrapConversationContent?: (children: ReactNode) => ReactNode;
    conversationContentAfter?: ReactNode;
    conversationOverlay?: ReactNode;
    emptyAfter?: ReactNode;
    renderScrollButton?: ChatConversationScrollButtonProps["renderButton"];
}
interface AgentChatViewBaseProps {
    sessionId?: string;
    phase?: "missing" | "draft" | "active";
    surface?: string;
    turns: readonly AgentUITurnState[];
    slots: AgentChatViewSlots;
    transcriptRef?: Ref<HTMLDivElement>;
    homeStyle?: CSSProperties;
    homeComposerStyle?: CSSProperties;
    className?: string;
    collapsiblePrimitives?: ChatCollapsiblePrimitives;
    activityTools?: "all" | "latest";
}
type AgentChatViewHostTurnProps = {
    renderTurn: (input: {
        turn: AgentUITurnState;
        index: number;
        last: boolean;
    }) => ReactNode;
    thoughts?: AgentUIThoughtPresentation;
    labels?: AgentUITurnLabels;
    turnSlots?: AgentUITurnSlots;
};
type AgentChatViewCommonTurnProps = {
    renderTurn?: undefined;
    thoughts: AgentUIThoughtPresentation;
    labels: AgentUITurnLabels;
    turnSlots: AgentUITurnSlots;
};
export type AgentChatViewProps = AgentChatViewBaseProps & (AgentChatViewHostTurnProps | AgentChatViewCommonTurnProps);
/** Backchat's full scroll/composer shell. Products inject content and actions,
 * but do not own the conversation geometry or turn lifecycle. */
export declare function AgentChatView({ sessionId, phase, surface, turns, thoughts, labels, turnSlots, slots, renderTurn, transcriptRef, homeStyle, homeComposerStyle, className, collapsiblePrimitives, activityTools, }: AgentChatViewProps): import("react").JSX.Element;
/** Backchat's complete turn component over the common Agent UI state shape.
 * Host products only supply content renderers and localized copy. */
export declare function AgentUITurnView({ sessionId, turn, thoughts, labels, slots, className, collapsiblePrimitives, frameStatus, activityTools, now, }: AgentUITurnViewProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=components.d.ts.map