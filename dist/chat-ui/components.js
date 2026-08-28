"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import { ArrowDownIcon, BrainIcon, ChevronRightIcon } from "lucide-react";
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import { agentUIProcessEndIndex, agentUITurnElapsedSeconds, projectAgentUITurnItems, } from "../agent-ui/presentation.js";
import { SessionTurnFrame, } from "../session-ui/index.js";
import { groupAgentUIActivityEvents, isAgentUIToolRunning, projectAgentUIActivityTools, } from "./presentation.js";
import { chatClassNames, preserveChatScrollAnchor } from "./utils.js";
const FALLBACK_CHAT_SCROLL_ANCHOR = {
    contentRef: { current: null },
    scrollRef: { current: null },
    isAtBottom: true,
    scrollToBottom: () => false,
    stopScroll: () => { },
};
const ChatScrollAnchorContext = createContext(null);
function useOptionalChatStickToBottom() {
    return useContext(ChatScrollAnchorContext) ?? FALLBACK_CHAT_SCROLL_ANCHOR;
}
function ChatScrollAnchorBridge({ children }) {
    const stick = useStickToBottomContext();
    return (_jsx(ChatScrollAnchorContext.Provider, { value: stick, children: children }));
}
function useChatControllableState({ prop, defaultProp, onChange, }) {
    const [uncontrolled, setUncontrolled] = useState(defaultProp);
    const controlled = prop !== undefined;
    const value = controlled ? prop : uncontrolled;
    const setValue = useCallback((next) => {
        const resolved = typeof next === "function"
            ? next(value)
            : next;
        if (!controlled)
            setUncontrolled(resolved);
        if (!Object.is(resolved, value))
            onChange?.(resolved);
    }, [controlled, onChange, value]);
    return [value, setValue];
}
export const ChatCollapsible = CollapsiblePrimitive.Root;
export const ChatCollapsibleTrigger = CollapsiblePrimitive.Trigger;
export const ChatCollapsibleContent = CollapsiblePrimitive.Content;
export const defaultChatCollapsiblePrimitives = {
    Root: ChatCollapsible,
    Trigger: ChatCollapsibleTrigger,
    Content: ChatCollapsibleContent,
};
export const CHAT_COMPOSER_FRAME_CLASS = "chat-composer-frame mx-auto w-full max-w-3xl min-w-0";
export const CHAT_TURN_FRAME_CLASS = "chat-turn-frame mx-auto w-full max-w-3xl min-w-0";
export function ChatConversation({ className, children, ...props }) {
    return (_jsx(StickToBottom, { className: chatClassNames("relative flex-1 overflow-y-hidden", className), initial: false, resize: "smooth", role: "log", ...props, children: _jsx(ChatScrollAnchorBridge, { children: children }) }));
}
export function ChatConversationContent({ className, ...props }) {
    return (_jsx(StickToBottom.Content, { className: chatClassNames("flex flex-col gap-8 p-4", className), scrollClassName: "chat-scrollbar", ...props }));
}
export function ChatConversationScrollButton({ className, icon = _jsx(ArrowDownIcon, { className: "size-4" }), renderButton, ...props }) {
    const { isAtBottom, scrollToBottom } = useOptionalChatStickToBottom();
    const handleScrollToBottom = useCallback(() => {
        void scrollToBottom();
    }, [scrollToBottom]);
    if (isAtBottom)
        return null;
    const resolvedClassName = chatClassNames("absolute bottom-4 left-[50%] translate-x-[-50%] rounded-full dark:bg-background dark:hover:bg-muted", className);
    if (renderButton) {
        return renderButton({
            onClick: handleScrollToBottom,
            className: resolvedClassName,
            icon,
        });
    }
    return (_jsx("button", { type: "button", "aria-label": "Scroll to bottom", className: resolvedClassName, onClick: handleScrollToBottom, ...props, children: icon }));
}
export function ChatDisclosureChevron({ open, className, }) {
    return (_jsx("span", { className: chatClassNames("activity-disclosure-chevron", className), "data-disclosure-chevron-slot": "true", "aria-hidden": "true", children: _jsx(ChevronRightIcon, { className: chatClassNames("size-3.5 text-fg-subtle transition-transform", open && "rotate-90") }) }));
}
export function projectChatThoughtEvent({ text, live, liveFallback, completedLabel, renderLiveSummary, }) {
    if (live) {
        const fallback = text.trim() || liveFallback;
        return {
            multiline: true,
            summary: renderLiveSummary?.(fallback) ?? fallback,
        };
    }
    return {
        leading: (_jsx(BrainIcon, { className: "chat-activity-icon shrink-0 text-fg-muted", "aria-hidden": "true" })),
        summary: completedLabel,
    };
}
export function ChatThoughtEventRow({ live, text, liveFallback, completedLabel, projection, renderLiveSummary, renderBody, }) {
    const [open, setOpen] = useState(false);
    const stick = useOptionalChatStickToBottom();
    const triggerRef = useRef(null);
    const resolvedProjection = projection ??
        projectChatThoughtEvent({
            text,
            live,
            liveFallback,
            completedLabel,
            renderLiveSummary,
        });
    const toggleOpen = () => {
        preserveChatScrollAnchor({
            scrollElement: stick.scrollRef.current,
            anchorElement: triggerRef.current,
            contentElement: stick.contentRef.current,
            update: () => setOpen((value) => !value),
            stopScroll: stick.stopScroll,
        });
    };
    return (_jsxs("div", { className: "py-0.5", "data-thought-block": "true", "data-thought-live": live, children: [_jsxs("button", { ref: triggerRef, type: "button", "aria-expanded": open, onClick: toggleOpen, className: "activity-disclosure-row min-h-6 text-[13px]", children: [resolvedProjection.leading && (_jsx("span", { className: "grid size-[var(--chat-activity-icon-size)] shrink-0 place-items-center", children: resolvedProjection.leading })), _jsx("span", { className: chatClassNames("min-w-0 flex-1 text-left text-fg-muted", !resolvedProjection.multiline && "truncate"), children: resolvedProjection.summary }), _jsx(ChatDisclosureChevron, { open: open })] }), _jsx("div", { "data-thought-stream-body": "true", hidden: !open, "aria-hidden": open ? undefined : true, inert: open ? undefined : true, className: "ml-5 mt-1 min-w-0", children: renderBody({ live }) })] }));
}
const ChatReasoningContext = createContext(null);
function useChatReasoning() {
    const context = useContext(ChatReasoningContext);
    if (!context) {
        throw new Error("Reasoning components must be used within ChatReasoning");
    }
    return context;
}
export const ChatReasoning = memo(function ChatReasoning({ className, isStreaming = false, open, defaultOpen, onOpenChange, duration: durationProp, primitives = defaultChatCollapsiblePrimitives, children, ...props }) {
    const stick = useOptionalChatStickToBottom();
    const resolvedDefaultOpen = defaultOpen ?? isStreaming;
    const isExplicitlyClosed = defaultOpen === false;
    const [isOpen, setIsOpen] = useChatControllableState({
        defaultProp: resolvedDefaultOpen,
        onChange: onOpenChange,
        prop: open,
    });
    const [duration, setDuration] = useChatControllableState({
        defaultProp: undefined,
        prop: durationProp,
    });
    const triggerRef = useRef(null);
    const startTimeRef = useRef(null);
    useEffect(() => {
        if (isStreaming) {
            if (startTimeRef.current === null)
                startTimeRef.current = Date.now();
        }
        else if (startTimeRef.current !== null) {
            setDuration(Math.ceil((Date.now() - startTimeRef.current) / 1_000));
            startTimeRef.current = null;
        }
    }, [isStreaming, setDuration]);
    useEffect(() => {
        if (isStreaming && !isOpen && !isExplicitlyClosed)
            setIsOpen(true);
    }, [isExplicitlyClosed, isOpen, isStreaming, setIsOpen]);
    const handleOpenChange = useCallback((newOpen) => {
        preserveChatScrollAnchor({
            scrollElement: stick.scrollRef.current,
            anchorElement: triggerRef.current,
            contentElement: stick.contentRef.current,
            update: () => setIsOpen(newOpen),
            stopScroll: stick.stopScroll,
        });
    }, [setIsOpen, stick.contentRef, stick.scrollRef, stick.stopScroll]);
    const contextValue = useMemo(() => ({
        collapsible: primitives,
        duration,
        isOpen,
        isStreaming,
        setIsOpen,
        triggerRef,
    }), [duration, isOpen, isStreaming, primitives, setIsOpen]);
    const CollapsibleRoot = primitives.Root;
    return (_jsx(ChatReasoningContext.Provider, { value: contextValue, children: _jsx(CollapsibleRoot, { className: chatClassNames("not-prose mb-2", className), onOpenChange: handleOpenChange, open: isOpen, ...props, children: children }) }));
});
const defaultThinkingMessage = (isStreaming, duration) => {
    if (isStreaming || duration === 0) {
        return _jsx("span", { className: "text-fg-muted", children: "Thinking\u2026" });
    }
    if (duration === undefined)
        return _jsx("p", { children: "Thought for a few seconds" });
    return _jsxs("p", { children: ["Thought for ", duration, " seconds"] });
};
export const ChatReasoningTrigger = memo(function ChatReasoningTrigger({ className, children, getThinkingMessage = defaultThinkingMessage, showIcon = true, ...props }) {
    const { collapsible, isStreaming, isOpen, duration, triggerRef } = useChatReasoning();
    const CollapsibleTrigger = collapsible.Trigger;
    return (_jsx(CollapsibleTrigger, { ref: triggerRef, className: chatClassNames("flex w-full select-none items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground", className), ...props, children: children ?? (_jsxs(_Fragment, { children: [showIcon && _jsx(BrainIcon, { className: "size-4" }), getThinkingMessage(isStreaming, duration), _jsx(ChatDisclosureChevron, { open: isOpen })] })) }));
});
export const ChatReasoningContent = memo(function ChatReasoningContent({ className, children, ...props }) {
    const { collapsible, isOpen } = useChatReasoning();
    const CollapsibleContent = collapsible.Content;
    return (_jsx(CollapsibleContent, { forceMount: true, "aria-hidden": isOpen ? undefined : true, inert: isOpen ? undefined : true, className: "reasoning-collapse text-fg-muted outline-none", ...props, children: _jsx("div", { className: "reasoning-collapse-inner", children: _jsx("div", { className: chatClassNames("pt-2 text-[13px] leading-6", className), children: children }) }) }));
});
export function ChatCollapsibleEventSequence({ nodes, active, forceGroup = false, completedProjection, }) {
    if (nodes.length === 1 && !forceGroup)
        return nodes[0]?.content ?? null;
    return (_jsx(ChatCollapsibleEventSequenceGroup, { nodes: nodes, active: active, completedProjection: completedProjection }));
}
function ChatCollapsibleEventSequenceGroup({ nodes, active, completedProjection, }) {
    const [manualOpen, setManualOpen] = useState(null);
    const stick = useOptionalChatStickToBottom();
    const triggerRef = useRef(null);
    const open = manualOpen ?? active;
    const projected = active ? nodes.at(-1)?.projection : completedProjection;
    if (!projected)
        return null;
    const toggleOpen = () => {
        preserveChatScrollAnchor({
            scrollElement: stick.scrollRef.current,
            anchorElement: triggerRef.current,
            contentElement: stick.contentRef.current,
            update: () => setManualOpen((value) => !(value ?? active)),
            stopScroll: stick.stopScroll,
        });
    };
    return (_jsxs("div", { className: "py-0.5", "data-collapsible-event-count": nodes.length, "data-tool-group-size": nodes.length, children: [_jsxs("button", { ref: triggerRef, type: "button", "aria-expanded": open, onClick: toggleOpen, className: "activity-disclosure-row min-h-6 text-[13px]", children: [projected.leading && (_jsx("span", { className: "grid size-[var(--chat-activity-icon-size)] shrink-0 place-items-center", children: projected.leading })), _jsx("span", { className: chatClassNames("min-w-0 flex-1 text-fg-muted", !projected.multiline && "truncate"), children: projected.summary }), _jsx(ChatDisclosureChevron, { open: open })] }), _jsx("div", { hidden: !open, "aria-hidden": open ? undefined : true, inert: open ? undefined : true, className: "ml-4 mt-1 border-l border-border/40 pl-2", children: _jsx("div", { className: "space-y-1", children: nodes.map((node) => (_jsx("div", { children: node.content }, node.key))) }) })] }));
}
/** Backchat's full scroll/composer shell. Products inject content and actions,
 * but do not own the conversation geometry or turn lifecycle. */
export function AgentChatView({ sessionId, phase = "active", surface = "main", turns, thoughts, labels, turnSlots, slots, renderTurn, transcriptRef, homeStyle, homeComposerStyle, className, collapsiblePrimitives, activityTools, }) {
    const transcriptTurns = turns.filter((turn) => turn.status !== "queued");
    const isEmpty = phase !== "active" || turns.length === 0;
    return (_jsx("div", { className: chatClassNames("flex h-full min-h-0 flex-col", className), "data-chat-surface": surface, children: isEmpty ? (_jsxs("div", { className: "home-empty-stage flex h-full min-h-0 flex-col", style: homeStyle, children: [_jsx("div", { className: "home-empty-content flex min-h-0 w-full flex-1 items-center justify-center overflow-y-auto px-4", children: _jsx("div", { className: "home-empty-stack flex w-full max-w-[1120px] flex-col items-center gap-6", children: slots.empty }) }), _jsx(ChatComposerFrame, { slots: slots, home: true, style: homeComposerStyle }), slots.emptyAfter] })) : (_jsxs(_Fragment, { children: [_jsxs(ChatConversation, { className: "flex-1 min-h-0", children: [_jsx(ChatConversationContent, { className: "w-full px-0 py-6 flex min-h-full flex-col", children: wrapAgentChatConversationContent(slots, (_jsxs(_Fragment, { children: [_jsx("div", { ref: transcriptRef, className: CHAT_TURN_FRAME_CLASS, "data-chat-column": "turns", children: transcriptTurns.map((turn, index) => renderTurn ? (_jsx("div", { className: "contents", children: renderTurn({
                                                turn,
                                                index,
                                                last: index === transcriptTurns.length - 1,
                                            }) }, turn.id)) : (_jsx(AgentUITurnView, { sessionId: sessionId, turn: turn, thoughts: thoughts, labels: labels, slots: turnSlots, collapsiblePrimitives: collapsiblePrimitives, activityTools: activityTools }, turn.id))) }), slots.conversationContentAfter] }))) }), _jsx(ChatConversationScrollButton, { renderButton: slots.renderScrollButton }), slots.conversationOverlay] }, sessionId ?? "none"), _jsx(ChatComposerFrame, { slots: slots })] })) }));
}
function wrapAgentChatConversationContent(slots, children) {
    return slots.wrapConversationContent?.(children) ?? children;
}
function ChatComposerFrame({ slots, home = false, style, }) {
    return (_jsxs("div", { "data-chat-column": "composer", className: chatClassNames(CHAT_COMPOSER_FRAME_CLASS, "space-y-2", home && "relative home-composer-stack"), style: style, children: [home ? slots.homeBeforeComposer : null, slots.beforeComposer, slots.composer, slots.afterComposer] }));
}
/** Backchat's complete turn component over the common Agent UI state shape.
 * Host products only supply content renderers and localized copy. */
export function AgentUITurnView({ sessionId, turn, thoughts, labels, slots, className, collapsiblePrimitives, frameStatus, activityTools = "latest", now, }) {
    const isStreaming = turn.status === "running";
    const [processOpen, setProcessOpen] = useState(isStreaming);
    const elapsedSeconds = useAgentUITurnElapsedSeconds(turn, isStreaming, now);
    useEffect(() => {
        setProcessOpen(isStreaming);
    }, [isStreaming]);
    const prompt = turn.items.find((item) => item.kind === "message" && item.role === "user");
    const items = projectAgentUITurnItems(turn, { thoughts }).filter((item) => item.kind !== "message" || item.role !== "user");
    const processEndIndex = agentUIProcessEndIndex(items);
    const rawProcessItems = items.filter((_, index) => index <= processEndIndex);
    const answerItems = items.filter((_, index) => index > processEndIndex);
    const assistantPrefixes = streamPrefixes(items, "assistant");
    const thoughtPrefixes = streamPrefixes(items, "thought");
    const toolProjection = activityTools === "latest"
        ? projectAgentUIActivityTools(turn, isStreaming)
        : undefined;
    const processItems = toolProjection
        ? rawProcessItems.filter((item) => item.kind !== "tool" ||
            toolProjection.visibleToolIds.has(item.id) ||
            toolProjection.activeTool?.id === item.id)
        : rawProcessItems;
    const toolsById = new Map(processItems.flatMap((item) => item.kind === "tool" ? [[item.id, item]] : []));
    const activityGroups = groupAgentUIActivityEvents(processItems, {
        toolsById,
    });
    const renderContext = {
        turn,
        live: isStreaming,
        prefixSkip: 0,
    };
    const hasSupplementalProcess = slots.hasSupplementalProcess?.(renderContext) ?? false;
    const hasProcess = processItems.length > 0 ||
        hasSupplementalProcess ||
        (isStreaming && answerItems.length === 0);
    const finalItem = items.at(-1);
    let finalActivityItem;
    for (let index = items.length - 1; index >= 0; index -= 1) {
        const item = items[index];
        if (item &&
            (item.kind === "message" ||
                item.kind === "thinking" ||
                item.kind === "tool")) {
            finalActivityItem = item;
            break;
        }
    }
    return (_jsxs(_Fragment, { children: [slots.renderBeforeTurn?.({ turn }), _jsxs(SessionTurnFrame, { turnId: turn.id, sessionId: sessionId, status: frameStatus ?? sessionTurnStatus(turn), errorMessage: turn.error, className: chatClassNames("!mb-8 !space-y-4 [&_[data-session-turn-prompt]>div]:!px-3 [&_[data-session-turn-prompt]>div]:!py-2", className), promptNode: prompt && slots.renderPrompt
                    ? slots.renderPrompt({ item: prompt, turn })
                    : undefined, promptText: prompt && !slots.renderPrompt ? prompt.text : undefined, errorNotice: turn.status === "failed" && slots.renderError
                    ? slots.renderError({ turn, message: turn.error })
                    : undefined, children: [slots.renderResponseBeforeProcess?.(renderContext), hasProcess ? (_jsxs(ChatReasoning, { isStreaming: isStreaming, open: processOpen, onOpenChange: (open) => {
                            if (!isStreaming)
                                setProcessOpen(open);
                        }, "data-session-process-state": isStreaming ? "running" : "complete", primitives: collapsiblePrimitives, children: [_jsx(ChatReasoningTrigger, { disabled: isStreaming, "aria-disabled": isStreaming, showIcon: false, getThinkingMessage: () => (_jsx("span", { className: "min-w-0 flex-1 truncate text-left text-fg-muted", children: isStreaming
                                        ? labels.workingFor(elapsedSeconds)
                                        : labels.workedFor(elapsedSeconds) })) }), _jsx(ChatReasoningContent, { children: _jsxs("div", { className: "space-y-1", children: [slots.renderProcessBefore?.(renderContext), processItems.map((item, index) => {
                                            if (item.kind === "message") {
                                                if (item.role !== "assistant")
                                                    return null;
                                                return (_jsx("div", { className: "min-w-0", children: slots.renderAssistant({
                                                        item,
                                                        turn,
                                                        section: "process",
                                                        live: isStreaming && item === finalItem,
                                                        prefixSkip: assistantPrefixes.get(item.id) ?? 0,
                                                    }) }, item.id));
                                            }
                                            const group = activityGroups.get(index);
                                            if (!group)
                                                return null;
                                            const groupTools = group.flatMap((child) => "tool" in child ? [child.tool] : []);
                                            const lastGroupChild = group.at(-1);
                                            const active = isStreaming && lastGroupChild?.item === finalActivityItem;
                                            const forceGroup = active &&
                                                lastGroupChild !== undefined &&
                                                "tool" in lastGroupChild &&
                                                !isAgentUIToolRunning(lastGroupChild.tool.status);
                                            const nodes = group.map((child) => {
                                                if (!("tool" in child)) {
                                                    const live = active && child === lastGroupChild;
                                                    const prefixSkip = thoughtPrefixes.get(child.item.id) ?? 0;
                                                    return {
                                                        key: child.item.id,
                                                        projection: slots.projectThoughtActivity?.({
                                                            item: child.item,
                                                            turn,
                                                            live,
                                                            prefixSkip,
                                                        }) ?? {
                                                            leading: live ? undefined : (_jsx(BrainIcon, { className: "chat-activity-icon shrink-0 text-fg-muted", "aria-hidden": "true" })),
                                                            multiline: live,
                                                            summary: live
                                                                ? labels.thinking
                                                                : (labels.thoughtFor?.(0) ?? labels.thinking),
                                                        },
                                                        content: slots.renderThought?.({
                                                            item: child.item,
                                                            turn,
                                                            live,
                                                            prefixSkip,
                                                        }) ?? child.item.text,
                                                    };
                                                }
                                                const projectionLive = active && child === lastGroupChild;
                                                const contentLive = projectionLive && isAgentUIToolRunning(child.tool.status);
                                                return {
                                                    key: child.tool.id,
                                                    projection: slots.projectToolActivity?.({
                                                        tool: child.tool,
                                                        turn,
                                                        live: projectionLive,
                                                        prefixSkip: 0,
                                                    }) ?? {
                                                        summary: labels.toolActivity(child.tool),
                                                    },
                                                    content: slots.renderTool({
                                                        tool: child.tool,
                                                        turn,
                                                        live: contentLive,
                                                        prefixSkip: 0,
                                                    }),
                                                };
                                            });
                                            return (_jsx(ChatCollapsibleEventSequence, { nodes: nodes, active: active, forceGroup: forceGroup, completedProjection: slots.projectToolRun?.({
                                                    turn,
                                                    tools: groupTools,
                                                    active,
                                                }) ?? {
                                                    summary: labels.toolRunSummary(groupTools),
                                                } }, `event-sequence-${index}`));
                                        }), isStreaming && processItems.length === 0 ? (_jsx("p", { className: "min-h-6 truncate text-left font-chat text-[13px] leading-6 text-fg-muted", "aria-live": "polite", "data-thinking-fallback": "true", children: labels.thinking })) : null, slots.renderProcessAfter?.(renderContext)] }) })] })) : null, answerItems.map((item) => {
                        const live = isStreaming && item === finalItem;
                        if (item.kind === "message" && item.role === "assistant") {
                            return (_jsx("div", { className: "min-w-0", "data-session-turn-answer": "true", children: slots.renderAssistant({
                                    item,
                                    turn,
                                    section: "answer",
                                    live,
                                    prefixSkip: assistantPrefixes.get(item.id) ?? 0,
                                }) }, item.id));
                        }
                        if (item.kind === "raw" && slots.renderRaw) {
                            return slots.renderRaw({
                                item,
                                turn,
                                live,
                                prefixSkip: 0,
                            });
                        }
                        return null;
                    }), slots.renderAfterAnswer?.(renderContext), slots.renderFooter?.(renderContext)] })] }));
}
function useAgentUITurnElapsedSeconds(turn, isStreaming, fixedNow) {
    const [clock, setClock] = useState(() => fixedNow ?? Date.now());
    useEffect(() => {
        if (!isStreaming || fixedNow !== undefined)
            return;
        setClock(Date.now());
        const timer = window.setInterval(() => setClock(Date.now()), 1_000);
        return () => window.clearInterval(timer);
    }, [fixedNow, isStreaming]);
    return agentUITurnElapsedSeconds(turn, fixedNow ?? clock);
}
function streamPrefixes(items, kind) {
    const prefixes = new Map();
    let total = 0;
    for (const item of items) {
        if (kind === "thought" && item.kind !== "thinking")
            continue;
        if (kind === "assistant" &&
            (item.kind !== "message" || item.role !== "assistant")) {
            continue;
        }
        if (item.kind !== "thinking" && item.kind !== "message")
            continue;
        prefixes.set(item.id, total);
        total += item.text.length;
    }
    return prefixes;
}
function sessionTurnStatus(turn) {
    if (turn.status === "failed")
        return "error";
    if (turn.status === "completed")
        return "completed";
    return turn.status;
}
//# sourceMappingURL=components.js.map