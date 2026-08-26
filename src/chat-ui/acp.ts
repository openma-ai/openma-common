import type {
  AgentUIMessageItem,
  AgentUITimelineItem,
  AgentUIToolItem,
  AgentUITurnState,
} from "../agent-ui/index.js";
import {
  reduceTurn,
  parseAcpEvent,
  type ToolEntry,
  type TurnRender,
} from "../session-events/acp.js";
import type { ToolStatus } from "../session-events/openma.js";

export type AcpChatTurnStatus =
  | "queued"
  | "running"
  | "complete"
  | "error"
  | "cancelled"
  | "unknown";

export interface AcpChatTurnInput {
  id: string;
  promptText: string;
  attachments?: unknown[];
  events: readonly { payload: unknown; receivedAt?: number }[];
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
export function projectAcpChatTurn(
  input: AcpChatTurnInput,
  options: ProjectAcpChatTurnOptions = {},
): AgentUITurnState {
  const rendered = options.rendered ?? reduceTurn(input.events);
  const projectedEndedAt = input.endedAt ?? (
    input.status === "running"
      ? undefined
      : input.events.at(-1)?.receivedAt ?? input.startedAt
  );
  const toolsById = new Map(
    rendered.tools.map((tool) => [tool.toolCallId, tool] as const),
  );
  const thoughtDurations = projectThoughtDurations(input);
  const items: AgentUITimelineItem[] = [];

  if (input.promptText || input.attachments?.length) {
    items.push({
      id: `${input.id}:prompt`,
      kind: "message",
      role: "user",
      text: input.promptText,
      status: "complete",
      ...(input.attachments?.length
        ? { content: { attachments: input.attachments } }
        : {}),
    });
  }

  rendered.timeline.forEach((entry, index) => {
    if (entry.kind === "assistant_text") {
      items.push({
        id: `${input.id}:assistant:${index}`,
        kind: "message",
        role: "assistant",
        text: entry.text,
        status:
          input.status === "running" && index === rendered.timeline.length - 1
            ? "streaming"
            : "complete",
        ...(entry.phase ? { phase: entry.phase } : {}),
        content: { timelineIndex: index },
      });
      return;
    }
    if (entry.kind === "thought") {
      items.push({
        id: entry.messageId
          ? `${input.id}:thought:${entry.messageId}`
          : `${input.id}:thought:${index}`,
        ...(entry.messageId ? { messageId: entry.messageId } : {}),
        kind: "thinking",
        role: "assistant",
        text: entry.text,
        status:
          input.status === "running" && index === rendered.timeline.length - 1
            ? "streaming"
            : "complete",
        content: {
          timelineIndex: index,
          durationSeconds:
            thoughtDurations.get(thoughtTimingKey(entry.messageId)) ?? 0,
        },
      });
      return;
    }
    if (options.omitToolIds?.has(entry.toolCallId)) return;
    const tool = toolsById.get(entry.toolCallId);
    if (tool) items.push(projectAcpTool(tool, input.status));
  });

  const hasAssistantTimeline = rendered.timeline.some(
    (entry) => entry.kind === "assistant_text",
  );
  if (!hasAssistantTimeline && input.assistantText) {
    items.push({
      id: `${input.id}:assistant:replay`,
      kind: "message",
      role: "assistant",
      text: input.assistantText,
      phase: "final_answer",
      status: input.status === "running" ? "streaming" : "complete",
      content: { replay: true },
    });
  }

  return {
    id: input.id,
    status: projectTurnStatus(input.status),
    items,
    ...(input.errorMessage ? { error: input.errorMessage } : {}),
    ...(toTimestamp(input.startedAt) ? { startedAt: toTimestamp(input.startedAt) } : {}),
    ...(toTimestamp(projectedEndedAt)
      ? { endedAt: toTimestamp(projectedEndedAt) }
      : {}),
  };
}

function projectAcpTool(
  tool: ToolEntry,
  turnStatus: AcpChatTurnStatus,
): AgentUIToolItem {
  return {
    id: tool.toolCallId,
    kind: "tool",
    ...(tool.toolName ? { name: tool.toolName } : {}),
    ...(tool.title ? { title: tool.title } : {}),
    ...(tool.kind ? { toolKind: tool.kind } : {}),
    status: projectToolStatus(tool.status, turnStatus),
    ...(tool.rawInput !== undefined ? { rawInput: tool.rawInput } : {}),
    ...(tool.rawOutput !== undefined ? { rawOutput: tool.rawOutput } : {}),
    ...(tool.content ? { content: tool.content } : {}),
    ...(tool.locations ? { locations: tool.locations } : {}),
    ...(tool.meta ? { adapterMeta: tool.meta } : {}),
    outputs: [],
  };
}

function projectToolStatus(
  status: ToolEntry["status"],
  turnStatus: AcpChatTurnStatus,
): ToolStatus {
  if (
    status === "pending" ||
    status === "in_progress" ||
    status === "completed" ||
    status === "failed" ||
    status === "cancelled"
  ) {
    if (
      turnStatus !== "running" &&
      (status === "pending" || status === "in_progress")
    ) {
      return "cancelled";
    }
    return status;
  }
  return turnStatus === "running" ? "in_progress" : "cancelled";
}

function projectTurnStatus(
  status: AcpChatTurnStatus,
): AgentUITurnState["status"] {
  if (status === "complete") return "completed";
  if (status === "error") return "failed";
  return status;
}

function toTimestamp(value: number | string | undefined): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return new Date(value).toISOString();
  return undefined;
}

function thoughtTimingKey(messageId?: string): string {
  return messageId ? `message:${messageId}` : "anonymous";
}

function projectThoughtDurations(
  input: AcpChatTurnInput,
): ReadonlyMap<string, number> {
  const spans = new Map<string, { startedAt: number; lastIndex: number }>();
  input.events.forEach((event, index) => {
    const parsed = parseAcpEvent(event.payload);
    if (parsed.kind !== "thought" || event.receivedAt === undefined) return;
    const key = thoughtTimingKey(parsed.messageId);
    const span = spans.get(key);
    if (span) span.lastIndex = index;
    else spans.set(key, { startedAt: event.receivedAt, lastIndex: index });
  });
  const endedAt = timestampMillis(input.endedAt);
  return new Map(
    [...spans].map(([key, span]) => {
      const nextAt = input.events[span.lastIndex + 1]?.receivedAt;
      const lastAt = input.events.at(-1)?.receivedAt;
      const end = nextAt ?? endedAt ?? lastAt ?? span.startedAt;
      return [
        key,
        Math.max(1, Math.ceil((end - span.startedAt) / 1_000)),
      ] as const;
    }),
  );
}

function timestampMillis(value: number | string | undefined): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
