import { renderToStaticMarkup } from "react-dom/server";
import type { CSSProperties } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  AgentChatView,
  AgentUITurnView,
  ChatCollapsibleEventSequence,
  ChatReasoning,
  ChatReasoningContent,
  ChatReasoningTrigger,
  ChatThoughtEventRow,
} from "../src/chat-ui/components.js";
import type {
  AgentUIMessageItem,
  AgentUIToolItem,
  AgentUITurnState,
} from "../src/agent-ui/index.js";

vi.mock("use-stick-to-bottom", () => ({
  StickToBottom: Object.assign(
    ({ children, ...props }: React.ComponentProps<"div">) => (
      <div {...props}>{children}</div>
    ),
    {
      Content: ({ children, ...props }: React.ComponentProps<"div">) => (
        <div {...props}>{children}</div>
      ),
    },
  ),
  useStickToBottom: () => ({
    contentRef: { current: null },
    scrollRef: { current: null },
    isAtBottom: true,
  }),
  useStickToBottomContext: () => ({
    contentRef: { current: null },
    scrollRef: { current: null },
    stopScroll: vi.fn(),
  }),
}));

describe("Backchat main chat disclosures", () => {
  const nodes = [
    {
      key: "read",
      projection: { summary: "Read files" },
      content: <span>Read files body</span>,
    },
    {
      key: "run",
      projection: { summary: "Run tests" },
      content: <span>Run tests body</span>,
    },
  ];

  it("opens a running event sequence so its timeline is immediately visible", () => {
    const html = renderToStaticMarkup(
      <ChatCollapsibleEventSequence
        nodes={nodes}
        active
        completedProjection={{ summary: "Ran commands" }}
      />,
    );

    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("Read files body");
    expect(html).toContain("Run tests body");
  });

  it("keeps a completed event sequence hidden without discarding its state", () => {
    const html = renderToStaticMarkup(
      <ChatCollapsibleEventSequence
        nodes={nodes}
        active={false}
        completedProjection={{ summary: "Ran commands" }}
      />,
    );

    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Ran commands");
    expect(html).toContain('hidden="" aria-hidden="true" inert=""');
    expect(html).toContain("Read files body");
  });

  it("keeps a single atomic event out of an unnecessary second disclosure", () => {
    const html = renderToStaticMarkup(
      <ChatCollapsibleEventSequence
        nodes={[nodes[0]!]}
        active={false}
        completedProjection={{ summary: "Read files" }}
      />,
    );

    expect(html).toContain("Read files body");
    expect(html).not.toContain("data-collapsible-event-count");
  });

  it("puts process and event chevrons in the same trailing slot", () => {
    const processHtml = renderToStaticMarkup(
      <ChatReasoning isStreaming={false} open={false}>
        <ChatReasoningTrigger getThinkingMessage={() => "Worked for 4s"} />
        <ChatReasoningContent>Process</ChatReasoningContent>
      </ChatReasoning>,
    );
    const eventHtml = renderToStaticMarkup(
      <ChatCollapsibleEventSequence
        nodes={nodes}
        active={false}
        completedProjection={{ summary: "Ran commands" }}
      />,
    );

    expect(processHtml).toContain('data-disclosure-chevron-slot="true"');
    expect(eventHtml).toContain('data-disclosure-chevron-slot="true"');
  });

  it("keeps an atomic completed thought behind its own disclosure", () => {
    const html = renderToStaticMarkup(
      <ChatThoughtEventRow
        live={false}
        text="Inspecting the repository"
        liveFallback="Thinking"
        completedLabel="Thought for 2s"
        renderBody={() => <p>Inspecting the repository</p>}
      />,
    );

    expect(html).toContain('data-thought-block="true"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Thought for 2s");
    expect(html).toContain('data-thought-stream-body="true"');
    expect(html).toContain("Inspecting the repository");
  });
});

function activityTool(
  id: string,
  status: AgentUIToolItem["status"] = "completed",
): AgentUIToolItem {
  return {
    id,
    kind: "tool",
    toolKind: "execute",
    title: `Command ${id}`,
    status,
    outputs: [],
  };
}

function assistant(
  id: string,
  text: string,
  phase: AgentUIMessageItem["phase"] = "final_answer",
): AgentUIMessageItem {
  return {
    id,
    kind: "message",
    role: "assistant",
    text,
    phase,
    status: "complete",
  };
}

describe("Backchat main AgentUITurnView", () => {
  const slots = {
    renderAssistant: ({ item }: { item: AgentUIMessageItem }) => (
      <p data-assistant-item={item.id}>{item.text}</p>
    ),
    renderTool: ({ tool }: { tool: AgentUIToolItem }) => (
      <p data-tool-item={tool.id}>{tool.title}</p>
    ),
  };

  it("renders Backchat's thinking fallback while a running turn has no visible event", () => {
    const html = renderToStaticMarkup(
      <AgentUITurnView
        sessionId="session-silent"
        turn={{
          id: "turn-silent",
          status: "running",
          startedAt: "2026-08-27T00:00:00.000Z",
          items: [],
        }}
        thoughts="history"
        now={Date.parse("2026-08-27T00:00:01.000Z")}
        labels={{
          workingFor: (seconds) => `Working ${seconds}s`,
          workedFor: (seconds) => `Worked ${seconds}s`,
          thinking: "Thinking",
          toolRunSummary: () => "Ran commands",
          toolActivity: (tool) => tool.title ?? "Tool",
        }}
        slots={slots}
      />,
    );

    expect(html).toContain('data-session-process-state="running"');
    expect(html).toContain('data-thinking-fallback="true"');
    expect(html).toContain("Thinking");
  });

  it("removes the generic fallback as soon as a visible answer event arrives", () => {
    const html = renderToStaticMarkup(
      <AgentUITurnView
        sessionId="session-answering"
        turn={{
          id: "turn-answering",
          status: "running",
          items: [
            {
              ...assistant("answer-live", "Answering"),
              status: "streaming",
            },
          ],
        }}
        thoughts="history"
        labels={{
          workingFor: (seconds) => `Working ${seconds}s`,
          workedFor: (seconds) => `Worked ${seconds}s`,
          thinking: "Thinking",
          toolRunSummary: () => "Ran commands",
          toolActivity: (tool) => tool.title ?? "Tool",
        }}
        slots={slots}
      />,
    );

    expect(html).toContain("Answering");
    expect(html).not.toContain('data-thinking-fallback="true"');
  });

  it("hides the complete process while retaining nested disclosure state", () => {
    const turn: AgentUITurnState = {
      id: "turn-complete",
      status: "completed",
      items: [activityTool("one"), activityTool("two"), activityTool("three")],
    };
    const html = renderToStaticMarkup(
      <AgentUITurnView
        sessionId="session-1"
        turn={turn}
        thoughts="transient"
        labels={{
          workingFor: (seconds) => `Working ${seconds}s`,
          workedFor: (seconds) => `Worked ${seconds}s`,
          thinking: "Thinking",
          toolRunSummary: () => "Ran commands",
          toolActivity: (tool) => tool.title ?? "Tool",
        }}
        slots={slots}
      />,
    );

    expect(html).toContain('data-session-process-state="complete"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('data-state="closed"');
    expect(html).toContain('aria-hidden="true" inert=""');
    expect(html).toContain('data-tool-item="one"');
    expect(html).toContain('data-tool-item="two"');
  });

  it("opens the live activity group while its latest tool is running", () => {
    const turn: AgentUITurnState = {
      id: "turn-running",
      status: "running",
      startedAt: "2026-08-26T10:00:00.000Z",
      items: [
        activityTool("one"),
        activityTool("two", "in_progress"),
      ],
    };
    const html = renderToStaticMarkup(
      <AgentUITurnView
        sessionId="session-1"
        turn={turn}
        thoughts="transient"
        now={Date.parse("2026-08-26T10:00:01.000Z")}
        labels={{
          workingFor: (seconds) => `Working ${seconds}s`,
          workedFor: (seconds) => `Worked ${seconds}s`,
          thinking: "Thinking",
          toolRunSummary: () => "Ran commands",
          toolActivity: (tool) => tool.title ?? "Tool",
        }}
        slots={slots}
      />,
    );

    expect(html).toContain('data-session-process-state="running"');
    expect(html).toContain('data-tool-item="one"');
    expect(html).toContain('data-tool-item="two"');
  });

  it("keeps the final answer outside the process disclosure", () => {
    const turn: AgentUITurnState = {
      id: "turn-answer",
      status: "completed",
      items: [activityTool("one"), assistant("answer", "Finished.")],
    };
    const html = renderToStaticMarkup(
      <AgentUITurnView
        sessionId="session-1"
        turn={turn}
        thoughts="transient"
        labels={{
          workingFor: (seconds) => `Working ${seconds}s`,
          workedFor: (seconds) => `Worked ${seconds}s`,
          thinking: "Thinking",
          toolRunSummary: () => "Ran commands",
          toolActivity: (tool) => tool.title ?? "Tool",
        }}
        slots={slots}
      />,
    );

    expect(html).toContain('data-session-turn-answer="true"');
    expect(html).toContain("Finished.");
  });
});

describe("Backchat main AgentChatView", () => {
  const labels = {
    workingFor: (seconds: number) => `Working ${seconds}s`,
    workedFor: (seconds: number) => `Worked ${seconds}s`,
    thinking: "Thinking",
    toolRunSummary: () => "Ran commands",
    toolActivity: (tool: AgentUIToolItem) => tool.title ?? "Tool",
  };
  const turnSlots = {
    renderAssistant: ({ item }: { item: AgentUIMessageItem }) => (
      <p>{item.text}</p>
    ),
    renderTool: ({ tool }: { tool: AgentUIToolItem }) => <p>{tool.title}</p>,
  };

  it("keeps a draft on the Backchat home surface even when stale turns exist", () => {
    const html = renderToStaticMarkup(
      <AgentChatView
        phase="draft"
        turns={[{
          id: "stale-turn",
          status: "completed",
          items: [assistant("answer", "Must stay hidden")],
        }]}
        thoughts="history"
        labels={labels}
        turnSlots={turnSlots}
        slots={{ empty: <p>Home</p>, composer: <form>Composer</form> }}
      />,
    );

    expect(html).toContain("Home");
    expect(html).toContain("Composer");
    expect(html).not.toContain("Must stay hidden");
  });

  it("owns the active transcript while allowing a host turn renderer", () => {
    const html = renderToStaticMarkup(
      <AgentChatView
        phase="active"
        turns={[{
          id: "turn-1",
          status: "completed",
          items: [assistant("answer", "Projected")],
        }]}
        renderTurn={({ turn }) => (
          <article data-host-turn={turn.id}>Host turn</article>
        )}
        transcriptRef={{ current: null }}
        slots={{
          empty: <p>Home</p>,
          composer: <form>Composer</form>,
          wrapConversationContent: (children) => (
            <section data-conversation-context>{children}</section>
          ),
          conversationContentAfter: <aside>Annotations</aside>,
          conversationOverlay: <nav>Timeline</nav>,
        }}
      />,
    );

    expect(html).toContain('data-chat-column="turns"');
    expect(html).toContain('data-host-turn="turn-1"');
    expect(html).toContain("data-conversation-context");
    expect(html).toContain("Annotations");
    expect(html).toContain("Timeline");
    expect(html).not.toContain("Home");
  });

  it("keeps an active queued-only session off the home surface", () => {
    const html = renderToStaticMarkup(
      <AgentChatView
        phase="active"
        turns={[{ id: "queued", status: "queued", items: [] }]}
        thoughts="history"
        labels={labels}
        turnSlots={turnSlots}
        slots={{ empty: <p>Home</p>, composer: <form>Composer</form> }}
      />,
    );

    expect(html).toContain('data-chat-column="turns"');
    expect(html).not.toContain("Home");
  });

  it("keeps home-only slots and theme width on the empty surface", () => {
    const homeHtml = renderToStaticMarkup(
      <AgentChatView
        phase="missing"
        turns={[]}
        thoughts="history"
        labels={labels}
        turnSlots={turnSlots}
        homeStyle={{
          "--home-composer-theme-width": "720px",
        } as CSSProperties}
        homeComposerStyle={{
          "--home-composer-frame-width": "720px",
        } as CSSProperties}
        slots={{
          empty: <p>Home</p>,
          composer: <form>Composer</form>,
          homeBeforeComposer: <section>Suggestions</section>,
          emptyAfter: <div>Corner</div>,
        }}
      />,
    );

    expect(homeHtml).toContain("--home-composer-theme-width:720px");
    expect(homeHtml).toContain("--home-composer-frame-width:720px");
    expect(homeHtml).toContain("Suggestions");
    expect(homeHtml).toContain("Corner");
  });
});
