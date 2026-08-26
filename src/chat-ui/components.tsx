"use client";

import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import { ArrowDownIcon, BrainIcon, ChevronRightIcon } from "lucide-react";
import type {
  ComponentProps,
  CSSProperties,
  ReactNode,
  Ref,
} from "react";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";

import type {
  AgentUIMessageItem,
  AgentUIRawItem,
  AgentUITimelineItem,
  AgentUIToolItem,
  AgentUITurnState,
} from "../agent-ui/index.js";
import {
  agentUIProcessEndIndex,
  agentUITurnElapsedSeconds,
  projectAgentUITurnItems,
  type AgentUIThoughtPresentation,
} from "../agent-ui/presentation.js";
import {
  SessionTurnFrame,
  type SessionTurnStatus,
} from "../session-ui/index.js";
import {
  groupAgentUIActivityEvents,
  isAgentUIToolRunning,
  projectAgentUIActivityTools,
} from "./presentation.js";
import { chatClassNames, preserveChatScrollAnchor } from "./utils.js";

type ChatScrollAnchorValue = ReturnType<typeof useStickToBottomContext>;

const FALLBACK_CHAT_SCROLL_ANCHOR = {
  contentRef: { current: null as HTMLElement | null },
  scrollRef: { current: null as HTMLElement | null },
  isAtBottom: true,
  scrollToBottom: () => false,
  stopScroll: () => {},
} as ChatScrollAnchorValue;

const ChatScrollAnchorContext = createContext<ChatScrollAnchorValue | null>(
  null,
);

function useOptionalChatStickToBottom() {
  return useContext(ChatScrollAnchorContext) ?? FALLBACK_CHAT_SCROLL_ANCHOR;
}

function ChatScrollAnchorBridge({ children }: { children: ReactNode }) {
  const stick = useStickToBottomContext();
  return (
    <ChatScrollAnchorContext.Provider value={stick}>
      {children}
    </ChatScrollAnchorContext.Provider>
  );
}

function useChatControllableState<T>({
  prop,
  defaultProp,
  onChange,
}: {
  prop: T | undefined;
  defaultProp: T;
  onChange?: (value: T) => void;
}): [T, (next: T | ((previous: T) => T)) => void] {
  const [uncontrolled, setUncontrolled] = useState(defaultProp);
  const controlled = prop !== undefined;
  const value = controlled ? prop : uncontrolled;
  const setValue = useCallback(
    (next: T | ((previous: T) => T)) => {
      const resolved =
        typeof next === "function"
          ? (next as (previous: T) => T)(value)
          : next;
      if (!controlled) setUncontrolled(resolved);
      if (!Object.is(resolved, value)) onChange?.(resolved);
    },
    [controlled, onChange, value],
  );
  return [value, setValue];
}

export const ChatCollapsible = CollapsiblePrimitive.Root;
export const ChatCollapsibleTrigger = CollapsiblePrimitive.Trigger;
export const ChatCollapsibleContent = CollapsiblePrimitive.Content;

export interface ChatCollapsiblePrimitives {
  /** Adapter boundary: never leak the common checkout's React/Radix types. */
  Root: (props: any) => any;
  Trigger: (props: any) => any;
  Content: (props: any) => any;
}

export const defaultChatCollapsiblePrimitives: ChatCollapsiblePrimitives = {
  Root: ChatCollapsible,
  Trigger: ChatCollapsibleTrigger,
  Content: ChatCollapsibleContent,
};

export const CHAT_COMPOSER_FRAME_CLASS =
  "chat-composer-frame mx-auto w-full max-w-3xl min-w-0";
export const CHAT_TURN_FRAME_CLASS =
  "chat-turn-frame mx-auto w-full max-w-3xl min-w-0";

export type ChatConversationProps = Omit<
  ComponentProps<typeof StickToBottom>,
  "children"
> & { children?: ReactNode };

export function ChatConversation({
  className,
  children,
  ...props
}: ChatConversationProps) {
  return (
    <StickToBottom
      className={chatClassNames(
        "relative flex-1 overflow-y-hidden",
        className,
      )}
      initial={false}
      resize="smooth"
      role="log"
      {...props}
    >
      <ChatScrollAnchorBridge>{children}</ChatScrollAnchorBridge>
    </StickToBottom>
  );
}

export type ChatConversationContentProps = ComponentProps<
  typeof StickToBottom.Content
>;

export function ChatConversationContent({
  className,
  ...props
}: ChatConversationContentProps) {
  return (
    <StickToBottom.Content
      className={chatClassNames("flex flex-col gap-8 p-4", className)}
      scrollClassName="chat-scrollbar"
      {...props}
    />
  );
}

export interface ChatConversationScrollButtonProps
  extends Omit<ComponentProps<"button">, "children"> {
  icon?: ReactNode;
  renderButton?: (props: {
    onClick: () => void;
    className: string;
    icon: ReactNode;
  }) => ReactNode;
}

export function ChatConversationScrollButton({
  className,
  icon = <ArrowDownIcon className="size-4" />,
  renderButton,
  ...props
}: ChatConversationScrollButtonProps) {
  const { isAtBottom, scrollToBottom } = useOptionalChatStickToBottom();
  const handleScrollToBottom = useCallback(() => {
    void scrollToBottom();
  }, [scrollToBottom]);
  if (isAtBottom) return null;
  const resolvedClassName = chatClassNames(
    "absolute bottom-4 left-[50%] translate-x-[-50%] rounded-full dark:bg-background dark:hover:bg-muted",
    className,
  );
  if (renderButton) {
    return renderButton({
      onClick: handleScrollToBottom,
      className: resolvedClassName,
      icon,
    });
  }
  return (
    <button
      type="button"
      aria-label="Scroll to bottom"
      className={resolvedClassName}
      onClick={handleScrollToBottom}
      {...props}
    >
      {icon}
    </button>
  );
}

export function ChatDisclosureChevron({
  open,
  className,
}: {
  open: boolean;
  className?: string;
}) {
  return (
    <span
      className={chatClassNames("activity-disclosure-chevron", className)}
      data-disclosure-chevron-slot="true"
      aria-hidden="true"
    >
      <ChevronRightIcon
        className={chatClassNames(
          "size-3.5 text-fg-subtle transition-transform",
          open && "rotate-90",
        )}
      />
    </span>
  );
}

export interface ChatThoughtEventProjection {
  leading?: ReactNode;
  multiline?: boolean;
  summary: ReactNode;
}

export function projectChatThoughtEvent({
  text,
  live,
  liveFallback,
  completedLabel,
  renderLiveSummary,
}: {
  text: string;
  live: boolean;
  liveFallback: ReactNode;
  completedLabel: ReactNode;
  renderLiveSummary?: (fallback: ReactNode) => ReactNode;
}): ChatThoughtEventProjection {
  if (live) {
    const fallback = text.trim() || liveFallback;
    return {
      multiline: true,
      summary: renderLiveSummary?.(fallback) ?? fallback,
    };
  }
  return {
    leading: (
      <BrainIcon
        className="chat-activity-icon shrink-0 text-fg-muted"
        aria-hidden="true"
      />
    ),
    summary: completedLabel,
  };
}

export function ChatThoughtEventRow({
  live,
  text,
  liveFallback,
  completedLabel,
  projection,
  renderLiveSummary,
  renderBody,
}: {
  live: boolean;
  text: string;
  liveFallback: ReactNode;
  completedLabel: ReactNode;
  projection?: ChatThoughtEventProjection;
  renderLiveSummary?: (fallback: ReactNode) => ReactNode;
  renderBody: (input: { live: boolean }) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const stick = useOptionalChatStickToBottom();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const resolvedProjection =
    projection ??
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

  return (
    <div className="py-0.5" data-thought-block="true" data-thought-live={live}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        onClick={toggleOpen}
        className="activity-disclosure-row min-h-6 text-[13px]"
      >
        {resolvedProjection.leading && (
          <span className="grid size-[var(--chat-activity-icon-size)] shrink-0 place-items-center">
            {resolvedProjection.leading}
          </span>
        )}
        <span
          className={chatClassNames(
            "min-w-0 flex-1 text-left text-fg-muted",
            !resolvedProjection.multiline && "truncate",
          )}
        >
          {resolvedProjection.summary}
        </span>
        <ChatDisclosureChevron open={open} />
      </button>
      <div
        data-thought-stream-body="true"
        hidden={!open}
        aria-hidden={open ? undefined : true}
        inert={open ? undefined : true}
        className="ml-5 mt-1 min-w-0"
      >
        {renderBody({ live })}
      </div>
    </div>
  );
}

interface ChatReasoningContextValue {
  isStreaming: boolean;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  duration: number | undefined;
  triggerRef: { current: HTMLButtonElement | null };
  collapsible: ChatCollapsiblePrimitives;
}

const ChatReasoningContext = createContext<ChatReasoningContextValue | null>(
  null,
);

function useChatReasoning(): ChatReasoningContextValue {
  const context = useContext(ChatReasoningContext);
  if (!context) {
    throw new Error("Reasoning components must be used within ChatReasoning");
  }
  return context;
}

export type ChatReasoningProps = ComponentProps<typeof ChatCollapsible> & {
  isStreaming?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  duration?: number;
  /** Host interaction primitives. Structure and state remain common-owned. */
  primitives?: ChatCollapsiblePrimitives;
};

export const ChatReasoning = memo(function ChatReasoning({
  className,
  isStreaming = false,
  open,
  defaultOpen,
  onOpenChange,
  duration: durationProp,
  primitives = defaultChatCollapsiblePrimitives,
  children,
  ...props
}: ChatReasoningProps) {
  const stick = useOptionalChatStickToBottom();
  const resolvedDefaultOpen = defaultOpen ?? isStreaming;
  const isExplicitlyClosed = defaultOpen === false;
  const [isOpen, setIsOpen] = useChatControllableState<boolean>({
    defaultProp: resolvedDefaultOpen,
    onChange: onOpenChange,
    prop: open,
  });
  const [duration, setDuration] = useChatControllableState<
    number | undefined
  >({
    defaultProp: undefined,
    prop: durationProp,
  });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (isStreaming) {
      if (startTimeRef.current === null) startTimeRef.current = Date.now();
    } else if (startTimeRef.current !== null) {
      setDuration(Math.ceil((Date.now() - startTimeRef.current) / 1_000));
      startTimeRef.current = null;
    }
  }, [isStreaming, setDuration]);

  useEffect(() => {
    if (isStreaming && !isOpen && !isExplicitlyClosed) setIsOpen(true);
  }, [isExplicitlyClosed, isOpen, isStreaming, setIsOpen]);

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      preserveChatScrollAnchor({
        scrollElement: stick.scrollRef.current,
        anchorElement: triggerRef.current,
        contentElement: stick.contentRef.current,
        update: () => setIsOpen(newOpen),
        stopScroll: stick.stopScroll,
      });
    },
    [setIsOpen, stick.contentRef, stick.scrollRef, stick.stopScroll],
  );

  const contextValue = useMemo(
    () => ({
      collapsible: primitives,
      duration,
      isOpen,
      isStreaming,
      setIsOpen,
      triggerRef,
    }),
    [duration, isOpen, isStreaming, primitives, setIsOpen],
  );
  const CollapsibleRoot = primitives.Root;

  return (
    <ChatReasoningContext.Provider value={contextValue}>
      <CollapsibleRoot
        className={chatClassNames("not-prose mb-2", className)}
        onOpenChange={handleOpenChange}
        open={isOpen}
        {...props}
      >
        {children}
      </CollapsibleRoot>
    </ChatReasoningContext.Provider>
  );
});

export type ChatReasoningTriggerProps = ComponentProps<
  typeof ChatCollapsibleTrigger
> & {
  getThinkingMessage?: (isStreaming: boolean, duration?: number) => ReactNode;
  showIcon?: boolean;
};

const defaultThinkingMessage = (
  isStreaming: boolean,
  duration?: number,
): ReactNode => {
  if (isStreaming || duration === 0) {
    return <span className="text-fg-muted">Thinking…</span>;
  }
  if (duration === undefined) return <p>Thought for a few seconds</p>;
  return <p>Thought for {duration} seconds</p>;
};

export const ChatReasoningTrigger = memo(function ChatReasoningTrigger({
  className,
  children,
  getThinkingMessage = defaultThinkingMessage,
  showIcon = true,
  ...props
}: ChatReasoningTriggerProps) {
  const { collapsible, isStreaming, isOpen, duration, triggerRef } =
    useChatReasoning();
  const CollapsibleTrigger = collapsible.Trigger;
  return (
    <CollapsibleTrigger
      ref={triggerRef}
      className={chatClassNames(
        "flex w-full select-none items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground",
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          {showIcon && <BrainIcon className="size-4" />}
          {getThinkingMessage(isStreaming, duration)}
          <ChatDisclosureChevron open={isOpen} />
        </>
      )}
    </CollapsibleTrigger>
  );
});

export type ChatReasoningContentProps = ComponentProps<
  typeof ChatCollapsibleContent
> & { children: ReactNode };

export const ChatReasoningContent = memo(function ChatReasoningContent({
  className,
  children,
  ...props
}: ChatReasoningContentProps) {
  const { collapsible, isOpen } = useChatReasoning();
  const CollapsibleContent = collapsible.Content;
  return (
    <CollapsibleContent
      aria-hidden={isOpen ? undefined : true}
      inert={isOpen ? undefined : true}
      className="reasoning-collapse text-fg-muted outline-none"
      {...props}
    >
      <div className="reasoning-collapse-inner">
        <div
          className={chatClassNames("pt-2 text-[13px] leading-6", className)}
        >
          {children}
        </div>
      </div>
    </CollapsibleContent>
  );
});

export interface ChatCollapsibleEventNode {
  key: string;
  projection: {
    leading?: ReactNode;
    multiline?: boolean;
    summary: ReactNode;
  };
  content: ReactNode;
}

export function ChatCollapsibleEventSequence({
  nodes,
  active,
  completedProjection,
}: {
  nodes: ChatCollapsibleEventNode[];
  active: boolean;
  completedProjection: ChatCollapsibleEventNode["projection"];
}) {
  if (nodes.length === 1) return nodes[0]?.content ?? null;
  return (
    <ChatCollapsibleEventSequenceGroup
      nodes={nodes}
      active={active}
      completedProjection={completedProjection}
    />
  );
}

function ChatCollapsibleEventSequenceGroup({
  nodes,
  active,
  completedProjection,
}: {
  nodes: ChatCollapsibleEventNode[];
  active: boolean;
  completedProjection: ChatCollapsibleEventNode["projection"];
}) {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const stick = useOptionalChatStickToBottom();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const open = manualOpen ?? active;
  const projected = active ? nodes.at(-1)?.projection : completedProjection;
  if (!projected) return null;

  const toggleOpen = () => {
    preserveChatScrollAnchor({
      scrollElement: stick.scrollRef.current,
      anchorElement: triggerRef.current,
      contentElement: stick.contentRef.current,
      update: () => setManualOpen((value) => !(value ?? active)),
      stopScroll: stick.stopScroll,
    });
  };

  return (
    <div
      className="py-0.5"
      data-collapsible-event-count={nodes.length}
      data-tool-group-size={nodes.length}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        onClick={toggleOpen}
        className="activity-disclosure-row min-h-6 text-[13px]"
      >
        {projected.leading && (
          <span className="grid size-[var(--chat-activity-icon-size)] shrink-0 place-items-center">
            {projected.leading}
          </span>
        )}
        <span
          className={chatClassNames(
            "min-w-0 flex-1 text-fg-muted",
            !projected.multiline && "truncate",
          )}
        >
          {projected.summary}
        </span>
        <ChatDisclosureChevron open={open} />
      </button>
      {open && (
        <div className="ml-4 mt-1 border-l border-border/40 pl-2">
          <div className="space-y-1">
            {nodes.map((node) => (
              <div key={node.key}>{node.content}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

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
  renderBeforeTurn?: (input: { turn: AgentUITurnState }) => ReactNode;
  renderPrompt?: (input: {
    item: AgentUIMessageItem;
    turn: AgentUITurnState;
  }) => ReactNode;
  renderAssistant: (
    input: AgentUITurnRenderContext & {
      item: AgentUIMessageItem;
      section: "process" | "answer";
    },
  ) => ReactNode;
  renderThought?: (
    input: AgentUITurnRenderContext & { item: AgentUIMessageItem },
  ) => ReactNode;
  renderTool: (
    input: AgentUITurnRenderContext & { tool: AgentUIToolItem },
  ) => ReactNode;
  renderRaw?: (
    input: AgentUITurnRenderContext & { item: AgentUIRawItem },
  ) => ReactNode;
  renderError?: (input: {
    turn: AgentUITurnState;
    message: string | undefined;
  }) => ReactNode;
  projectThoughtActivity?: (
    input: AgentUITurnRenderContext & { item: AgentUIMessageItem },
  ) => ChatCollapsibleEventNode["projection"];
  projectToolActivity?: (
    input: AgentUITurnRenderContext & { tool: AgentUIToolItem },
  ) => ChatCollapsibleEventNode["projection"];
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

export type AgentChatViewProps = AgentChatViewBaseProps &
  (AgentChatViewHostTurnProps | AgentChatViewCommonTurnProps);

/** Backchat's full scroll/composer shell. Products inject content and actions,
 * but do not own the conversation geometry or turn lifecycle. */
export function AgentChatView({
  sessionId,
  phase = "active",
  surface = "main",
  turns,
  thoughts,
  labels,
  turnSlots,
  slots,
  renderTurn,
  transcriptRef,
  homeStyle,
  homeComposerStyle,
  className,
  collapsiblePrimitives,
  activityTools,
}: AgentChatViewProps) {
  const transcriptTurns = turns.filter((turn) => turn.status !== "queued");
  const isEmpty = phase !== "active" || turns.length === 0;
  return (
    <div
      className={chatClassNames("flex h-full min-h-0 flex-col", className)}
      data-chat-surface={surface}
    >
      {isEmpty ? (
        <div
          className="home-empty-stage flex h-full min-h-0 flex-col"
          style={homeStyle}
        >
          <div className="home-empty-content flex min-h-0 w-full flex-1 items-center justify-center overflow-y-auto px-4">
            <div className="home-empty-stack flex w-full max-w-[1120px] flex-col items-center gap-6">
              {slots.empty}
            </div>
          </div>
          <ChatComposerFrame
            slots={slots}
            home
            style={homeComposerStyle}
          />
          {slots.emptyAfter}
        </div>
      ) : (
        <>
          <ChatConversation key={sessionId ?? "none"} className="flex-1 min-h-0">
            <ChatConversationContent className="w-full px-0 py-6 flex min-h-full flex-col">
              {wrapAgentChatConversationContent(slots, (
                <>
                  <div
                    ref={transcriptRef}
                    className={CHAT_TURN_FRAME_CLASS}
                    data-chat-column="turns"
                  >
                    {transcriptTurns.map((turn, index) =>
                      renderTurn ? (
                        <div key={turn.id} className="contents">
                          {renderTurn({
                            turn,
                            index,
                            last: index === transcriptTurns.length - 1,
                          })}
                        </div>
                      ) : (
                        <AgentUITurnView
                          key={turn.id}
                          sessionId={sessionId}
                          turn={turn}
                          thoughts={thoughts!}
                          labels={labels!}
                          slots={turnSlots!}
                          collapsiblePrimitives={collapsiblePrimitives}
                          activityTools={activityTools}
                        />
                      ),
                    )}
                  </div>
                  {slots.conversationContentAfter}
                </>
              ))}
            </ChatConversationContent>
            <ChatConversationScrollButton
              renderButton={slots.renderScrollButton}
            />
            {slots.conversationOverlay}
          </ChatConversation>
          <ChatComposerFrame slots={slots} />
        </>
      )}
    </div>
  );
}

function wrapAgentChatConversationContent(
  slots: AgentChatViewSlots,
  children: ReactNode,
) {
  return slots.wrapConversationContent?.(children) ?? children;
}

function ChatComposerFrame({
  slots,
  home = false,
  style,
}: {
  slots: AgentChatViewSlots;
  home?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div
      data-chat-column="composer"
      className={chatClassNames(
        CHAT_COMPOSER_FRAME_CLASS,
        "space-y-2",
        home && "relative home-composer-stack",
      )}
      style={style}
    >
      {home ? slots.homeBeforeComposer : null}
      {slots.beforeComposer}
      {slots.composer}
      {slots.afterComposer}
    </div>
  );
}

/** Backchat's complete turn component over the common Agent UI state shape.
 * Host products only supply content renderers and localized copy. */
export function AgentUITurnView({
  sessionId,
  turn,
  thoughts,
  labels,
  slots,
  className,
  collapsiblePrimitives,
  frameStatus,
  activityTools = "latest",
  now,
}: AgentUITurnViewProps) {
  const isStreaming = turn.status === "running";
  const [processOpen, setProcessOpen] = useState(isStreaming);
  const elapsedSeconds = useAgentUITurnElapsedSeconds(turn, isStreaming, now);
  useEffect(() => {
    setProcessOpen(isStreaming);
  }, [isStreaming]);

  const prompt = turn.items.find(
    (item): item is AgentUIMessageItem =>
      item.kind === "message" && item.role === "user",
  );
  const items = projectAgentUITurnItems(turn, { thoughts }).filter(
    (item) => item.kind !== "message" || item.role !== "user",
  );
  const processEndIndex = agentUIProcessEndIndex(items);
  const rawProcessItems = items.filter((_, index) => index <= processEndIndex);
  const answerItems = items.filter((_, index) => index > processEndIndex);
  const assistantPrefixes = streamPrefixes(items, "assistant");
  const thoughtPrefixes = streamPrefixes(items, "thought");
  const toolProjection = activityTools === "latest"
    ? projectAgentUIActivityTools(turn, isStreaming)
    : undefined;
  const processItems = toolProjection
    ? rawProcessItems.filter(
        (item) =>
          item.kind !== "tool" ||
          toolProjection.visibleToolIds.has(item.id) ||
          toolProjection.activeTool?.id === item.id,
      )
    : rawProcessItems;
  const toolsById = new Map(
    processItems.flatMap((item) =>
      item.kind === "tool" ? [[item.id, item] as const] : [],
    ),
  );
  const activityGroups = groupAgentUIActivityEvents(processItems, {
    toolsById,
  });
  const renderContext: AgentUITurnRenderContext = {
    turn,
    live: isStreaming,
    prefixSkip: 0,
  };
  const hasSupplementalProcess =
    slots.hasSupplementalProcess?.(renderContext) ?? false;
  const hasProcess =
    processItems.length > 0 ||
    hasSupplementalProcess ||
    (isStreaming && answerItems.length === 0);
  const finalItem = items.at(-1);

  return (
    <>
      {slots.renderBeforeTurn?.({ turn })}
      <SessionTurnFrame
      turnId={turn.id}
      sessionId={sessionId}
      status={frameStatus ?? sessionTurnStatus(turn)}
      errorMessage={turn.error}
      className={chatClassNames(
        "!mb-8 !space-y-4 [&_[data-session-turn-prompt]>div]:!px-3 [&_[data-session-turn-prompt]>div]:!py-2",
        className,
      )}
      promptNode={
        prompt && slots.renderPrompt
          ? slots.renderPrompt({ item: prompt, turn })
          : undefined
      }
      promptText={prompt && !slots.renderPrompt ? prompt.text : undefined}
      errorNotice={
        turn.status === "failed" && slots.renderError
          ? slots.renderError({ turn, message: turn.error })
          : undefined
      }
    >
      {slots.renderResponseBeforeProcess?.(renderContext)}
      {hasProcess ? (
        <ChatReasoning
          isStreaming={isStreaming}
          open={processOpen}
          onOpenChange={(open) => {
            if (!isStreaming) setProcessOpen(open);
          }}
          data-session-process-state={isStreaming ? "running" : "complete"}
          primitives={collapsiblePrimitives}
        >
          <ChatReasoningTrigger
            disabled={isStreaming}
            aria-disabled={isStreaming}
            showIcon={false}
            getThinkingMessage={() => (
              <span className="min-w-0 flex-1 truncate text-left text-fg-muted">
                {isStreaming
                  ? labels.workingFor(elapsedSeconds)
                  : labels.workedFor(elapsedSeconds)}
              </span>
            )}
          />
          <ChatReasoningContent>
            <div className="space-y-1">
              {slots.renderProcessBefore?.(renderContext)}
              {processItems.map((item, index) => {
                if (item.kind === "message") {
                  if (item.role !== "assistant") return null;
                  return (
                    <div key={item.id} className="min-w-0">
                      {slots.renderAssistant({
                        item,
                        turn,
                        section: "process",
                        live: isStreaming && item === finalItem,
                        prefixSkip: assistantPrefixes.get(item.id) ?? 0,
                      })}
                    </div>
                  );
                }
                const group = activityGroups.get(index);
                if (!group) return null;
                const groupTools = group.flatMap((child) =>
                  "tool" in child ? [child.tool] : [],
                );
                let active = false;
                const nodes: ChatCollapsibleEventNode[] = group.map((child) => {
                  if (!("tool" in child)) {
                    const live = isStreaming && child.item === finalItem;
                    active ||= live;
                    const prefixSkip = thoughtPrefixes.get(child.item.id) ?? 0;
                    return {
                      key: child.item.id,
                      projection: slots.projectThoughtActivity?.({
                        item: child.item,
                        turn,
                        live,
                        prefixSkip,
                      }) ?? {
                        leading: live ? undefined : (
                          <BrainIcon
                            className="chat-activity-icon shrink-0 text-fg-muted"
                            aria-hidden="true"
                          />
                        ),
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
                  const live =
                    isStreaming &&
                    child.item === finalItem &&
                    isAgentUIToolRunning(child.tool.status);
                  active ||= live;
                  return {
                    key: child.tool.id,
                    projection: slots.projectToolActivity?.({
                      tool: child.tool,
                      turn,
                      live,
                      prefixSkip: 0,
                    }) ?? {
                      summary: labels.toolActivity(child.tool),
                    },
                    content: slots.renderTool({
                      tool: child.tool,
                      turn,
                      live,
                      prefixSkip: 0,
                    }),
                  };
                });
                return (
                  <ChatCollapsibleEventSequence
                    key={`event-sequence-${index}`}
                    nodes={nodes}
                    active={active}
                    completedProjection={slots.projectToolRun?.({
                      turn,
                      tools: groupTools,
                      active,
                    }) ?? {
                      summary: labels.toolRunSummary(groupTools),
                    }}
                  />
                );
              })}
              {isStreaming && processItems.length === 0 ? (
                <p
                  className="min-h-6 truncate text-left font-chat text-[13px] leading-6 text-fg-muted"
                  aria-live="polite"
                  data-thinking-fallback="true"
                >
                  {labels.thinking}
                </p>
              ) : null}
              {slots.renderProcessAfter?.(renderContext)}
            </div>
          </ChatReasoningContent>
        </ChatReasoning>
      ) : null}

      {answerItems.map((item) => {
        const live = isStreaming && item === finalItem;
        if (item.kind === "message" && item.role === "assistant") {
          return (
            <div
              key={item.id}
              className="min-w-0"
              data-session-turn-answer="true"
            >
              {slots.renderAssistant({
                item,
                turn,
                section: "answer",
                live,
                prefixSkip: assistantPrefixes.get(item.id) ?? 0,
              })}
            </div>
          );
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
      })}
      {slots.renderAfterAnswer?.(renderContext)}
      {slots.renderFooter?.(renderContext)}
      </SessionTurnFrame>
    </>
  );
}

function useAgentUITurnElapsedSeconds(
  turn: AgentUITurnState,
  isStreaming: boolean,
  fixedNow?: number,
): number {
  const [clock, setClock] = useState(() => fixedNow ?? Date.now());
  useEffect(() => {
    if (!isStreaming || fixedNow !== undefined) return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [fixedNow, isStreaming]);
  return agentUITurnElapsedSeconds(turn, fixedNow ?? clock);
}

function streamPrefixes(
  items: readonly AgentUITimelineItem[],
  kind: "assistant" | "thought",
): Map<string, number> {
  const prefixes = new Map<string, number>();
  let total = 0;
  for (const item of items) {
    if (kind === "thought" && item.kind !== "thinking") continue;
    if (
      kind === "assistant" &&
      (item.kind !== "message" || item.role !== "assistant")
    ) {
      continue;
    }
    if (item.kind !== "thinking" && item.kind !== "message") continue;
    prefixes.set(item.id, total);
    total += item.text.length;
  }
  return prefixes;
}

function sessionTurnStatus(turn: AgentUITurnState) {
  if (turn.status === "failed") return "error" as const;
  if (turn.status === "completed") return "completed" as const;
  return turn.status;
}
